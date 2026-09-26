-- ============================================================
-- rock: sync functions and triggers (self-hosted Postgres)
--
-- Everything between the markers is copied verbatim into
-- supabase/migrations/008_sync.sql (Task 14); a parity test enforces that.
-- So the block may only reference objects both backends have: the synced
-- tables, public.sync_seq and uuid-ossp's uuid_generate_v5 (Supabase keeps
-- it in the `extensions` schema, hence the search_path on completion_id).
--
-- Contract with the mobile client (packages/sync, apps/mobile/lib/sync):
-- * push merges each change by last-write-wins on updated_at, one change at
--   a time; a change that can't be applied (bad value, constraint, or an id
--   another account owns) is skipped, reported in the result's `skipped`
--   list, and never fails the batch. Any other error (timeouts, deadlocks, lost
--   connections) fails the whole push, so the client retries it unacked.
-- * pull pages rows by server_seq; the cursor is the last seq returned.
-- * instants are emitted as `toISOString()` strings (ms precision, 'Z').
-- ============================================================

-- >>> SYNC FUNCTIONS (keep identical to supabase/migrations/008_sync.sql)

-- Serializes every writer of one user's synced rows until its transaction ends.
-- server_seq is taken inside the row trigger, but transactions commit out of order:
-- without this, a push could commit seq 11 while another still holds seq 10
-- uncommitted, a concurrent pull would return 11 and advance the client's cursor
-- past 10, and row 10 would never be pulled. Pulls are per user, so a per-user
-- lock is enough; different users never wait on each other.
create or replace function public.sync_lock_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
end;
$$;

-- An instant as `Date.prototype.toISOString()` prints it (`2026-09-24T20:00:00.000Z`).
-- to_jsonb would emit microseconds and a `+00:00` offset, which Hermes' Date parser
-- (React Native) doesn't reliably accept and which never string-compares equal to
-- the client's own copy.
create or replace function public.sync_ts(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- The one id a completion of p_habit on p_date may have: every client derives the
-- same UUIDv5 (`completionId` in @rock_ht/sync), so unique (habit_id, completed_date)
-- never trips on a push. Server/web writers must use this, never gen_random_uuid().
create or replace function public.completion_id(p_habit uuid, p_date date)
returns uuid language sql immutable
set search_path = public, extensions
as $$
  select uuid_generate_v5('6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'::uuid,
                          lower(p_habit::text) || ':' || to_char(p_date, 'YYYY-MM-DD'))
$$;

create or replace function public.bump_sync_seq()
returns trigger language plpgsql as $$
begin
  -- Take the user's lock before the seq (see sync_lock_user), so writers that bypass
  -- sync_push_for (the web app, SQL) can't open a cursor gap either.
  if tg_table_name = 'profiles' then
    perform public.sync_lock_user(new.id);
  else
    perform public.sync_lock_user(new.user_id);
  end if;
  new.server_seq := nextval('public.sync_seq');
  -- Web/SQL writers that don't set updated_at still advance it; sync writers set it explicitly.
  -- Millisecond precision, like every device's toISOString() instants, so the value a pull
  -- emits is exactly the value stored and last-write-wins compares like with like.
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    new.updated_at := date_trunc('milliseconds', now());
  end if;
  return new;
end;
$$;

create or replace trigger profiles_sync_seq before insert or update on public.profiles
  for each row execute function public.bump_sync_seq();
create or replace trigger habits_sync_seq before insert or update on public.habits
  for each row execute function public.bump_sync_seq();
create or replace trigger completions_sync_seq before insert or update on public.habit_completions
  for each row execute function public.bump_sync_seq();
create or replace trigger journal_sync_seq before insert or update on public.journal_entries
  for each row execute function public.bump_sync_seq();

-- Merge a device's changes (at most 500 per call) into p_user's rows.
-- Rows are always written as p_user's: a pushed user_id (or profile id) is ignored,
-- and a row id that already belongs to another user is left alone.
-- Returns `{ "skipped": [{ "tbl", "id", "reason", "detail"? }] }`: every change that was
-- not applied and never will be, so the client can tell the user instead of saying
-- "synced". reason is 'foreign_owner' (the id, or a completion's habit, is another
-- user's) or 'invalid' (bad value, constraint, missing parent; detail = the error).
-- A change that merely loses last-write-wins is not skipped: the server has newer.
-- Dropped first because an earlier version returned void (create or replace can't
-- change a return type); the only caller is the push route.
drop function if exists public.sync_push_for(uuid, jsonb);
create function public.sync_push_for(p_user uuid, p_changes jsonb)
returns jsonb language plpgsql as $$
declare
  c jsonb;
  r jsonb;
  v_updated timestamptz;
  v_onboarded boolean;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform public.sync_lock_user(p_user);
  -- Every synced row references the profile. If the sign-up hook failed and this push
  -- carries no profile change, create a minimal one (dated just after the epoch, so any
  -- device's profile push still wins it); otherwise every habit would fail its foreign key.
  insert into public.profiles (id, email, updated_at)
  values (p_user, '', '1970-01-01T00:00:00.001Z')
  on conflict (id) do nothing;
  for c in select value from jsonb_array_elements(p_changes) loop
    -- One subtransaction per change: a change that can't be applied (malformed value,
    -- constraint, unknown table, missing parent) is skipped with a warning. Raising instead
    -- would fail the whole push, and the client would retry the same outbox head forever.
    -- Only those errors are skipped: anything else (lock/statement timeout, deadlock,
    -- serialization failure, admin shutdown) propagates and fails the push, so the client
    -- retries it rather than acking changes that were never written.
    begin
      r := c->'row';
      v_updated := (r->>'updated_at')::timestamptz;
      if v_updated is null then
        raise exception 'missing updated_at';
      end if;
      case c->>'table'
      when 'profiles' then
        v_onboarded := coalesce((r->>'onboarding_completed')::boolean, false);
        -- Upsert, not update: if the sign-up hook failed there is no row yet, and every
        -- habit push would then fail its foreign key.
        insert into public.profiles as p (id, email, display_name, avatar_url, timezone, theme,
          onboarding_completed, time_format, date_format, created_at, updated_at)
        values (p_user, coalesce(r->>'email', ''), r->>'display_name', r->>'avatar_url',
          coalesce(r->>'timezone', 'UTC'), coalesce(r->>'theme', 'dark'),
          coalesce((r->>'onboarding_completed')::boolean, false),
          coalesce(r->>'time_format', '12h'), coalesce(r->>'date_format', 'MM/DD/YYYY'),
          coalesce((r->>'created_at')::timestamptz, now()), v_updated)
        on conflict (id) do update set
          -- coalesce: a fresh device's claim() pushes display_name/avatar_url = null
          -- and must not wipe what the account already has. email is the account's; a
          -- device only fills it in on the placeholder row created above.
          email = coalesce(nullif(p.email, ''), nullif(r->>'email', ''), p.email),
          display_name = coalesce(r->>'display_name', p.display_name),
          avatar_url = coalesce(r->>'avatar_url', p.avatar_url),
          timezone = coalesce(r->>'timezone', p.timezone),
          theme = coalesce(r->>'theme', p.theme),
          -- Onboarding only ever completes: an onboarded device must never be sent back.
          onboarding_completed = p.onboarding_completed or v_onboarded,
          time_format = coalesce(r->>'time_format', p.time_format),
          date_format = coalesce(r->>'date_format', p.date_format),
          -- Won, but the flag stays true against the push's false: the stored row differs
          -- from the pusher's copy, so date it 1 ms later and the pusher pulls it back.
          updated_at = case when p.onboarding_completed and not v_onboarded
                            then excluded.updated_at + interval '1 millisecond'
                            else excluded.updated_at end
        where p.updated_at < excluded.updated_at;
        -- Lost last-write-wins but says onboarded: take just that flag, 1 ms newer than the
        -- current row (the minimal bump, not now(), which would beat any later device edit
        -- made on a clock behind the server's), so every device pulls the merged row.
        if v_onboarded then
          update public.profiles
          set onboarding_completed = true, updated_at = updated_at + interval '1 millisecond'
          where id = p_user and not onboarding_completed;
        end if;
      when 'habits' then
        insert into public.habits as t (id, user_id, title, description, icon, color, frequency,
          target_value, target_unit, reminder_time, reminder_enabled, is_archived, sort_order,
          created_at, updated_at, deleted_at)
        values ((r->>'id')::uuid, p_user, r->>'title', r->>'description', r->>'icon', r->>'color',
          r->'frequency', (r->>'target_value')::int, r->>'target_unit', (r->>'reminder_time')::time,
          (r->>'reminder_enabled')::boolean, (r->>'is_archived')::boolean, (r->>'sort_order')::int,
          (r->>'created_at')::timestamptz, v_updated, (r->>'deleted_at')::timestamptz)
        on conflict (id) do update set
          title = excluded.title, description = excluded.description, icon = excluded.icon,
          color = excluded.color, frequency = excluded.frequency, target_value = excluded.target_value,
          target_unit = excluded.target_unit, reminder_time = excluded.reminder_time,
          reminder_enabled = excluded.reminder_enabled, is_archived = excluded.is_archived,
          sort_order = excluded.sort_order, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
        where t.user_id = p_user and t.updated_at < excluded.updated_at;
        if not found and exists (select 1 from public.habits h
                                 where h.id = (r->>'id')::uuid and h.user_id <> p_user) then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'tbl', c->>'table', 'id', r->>'id', 'reason', 'foreign_owner'));
        end if;
      when 'habit_completions' then
        -- A completion of another user's habit is dropped and reported (the client acks it).
        -- A missing habit is skipped with a warning (outbox order pushes parent habits
        -- first, so this is a bug).
        if exists (select 1 from public.habits h
                   where h.id = (r->>'habit_id')::uuid and h.user_id <> p_user) then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'tbl', c->>'table', 'id', r->>'id', 'reason', 'foreign_owner'));
          continue;
        end if;
        -- Ownership is checked again inside the insert: another user's habit with this id
        -- may commit between the check above and the foreign-key check, which would accept it.
        insert into public.habit_completions as t (id, habit_id, user_id, completed_date, value, note,
          created_at, updated_at, deleted_at)
        select (r->>'id')::uuid, (r->>'habit_id')::uuid, p_user, (r->>'completed_date')::date,
          (r->>'value')::int, r->>'note', (r->>'created_at')::timestamptz,
          v_updated, (r->>'deleted_at')::timestamptz
        where exists (select 1 from public.habits h
                      where h.id = (r->>'habit_id')::uuid and h.user_id = p_user)
        on conflict (id) do update set
          value = excluded.value, note = excluded.note,
          updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
        where t.user_id = p_user and t.updated_at < excluded.updated_at;
        if not found and not exists (select 1 from public.habits h
                                     where h.id = (r->>'habit_id')::uuid and h.user_id = p_user) then
          raise exception 'habit % of completion % is missing or not the user''s',
            r->>'habit_id', r->>'id' using errcode = 'foreign_key_violation';
        end if;
        if not found and exists (select 1 from public.habit_completions t
                                 where t.id = (r->>'id')::uuid and t.user_id <> p_user) then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'tbl', c->>'table', 'id', r->>'id', 'reason', 'foreign_owner'));
        end if;
      when 'journal_entries' then
        -- The linked habit is optional: a missing one, or one owned by someone else,
        -- is written as null instead of failing (or leaking a foreign reference). The
        -- ownership lookup is part of the insert, so it can't go stale before it.
        insert into public.journal_entries as t (id, user_id, habit_id, entry_date, content, mood,
          created_at, updated_at, deleted_at)
        values ((r->>'id')::uuid, p_user,
          (select h.id from public.habits h
            where h.id = (r->>'habit_id')::uuid and h.user_id = p_user),
          (r->>'entry_date')::date,
          r->>'content', (r->>'mood')::smallint, (r->>'created_at')::timestamptz,
          v_updated, (r->>'deleted_at')::timestamptz)
        on conflict (id) do update set
          habit_id = excluded.habit_id, entry_date = excluded.entry_date, content = excluded.content,
          mood = excluded.mood, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
        where t.user_id = p_user and t.updated_at < excluded.updated_at;
        if not found and exists (select 1 from public.journal_entries t
                                 where t.id = (r->>'id')::uuid and t.user_id <> p_user) then
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'tbl', c->>'table', 'id', r->>'id', 'reason', 'foreign_owner'));
        end if;
      else
        raise exception 'unknown sync table %', c->>'table';
      end case;
    -- Class 22 (data_exception: bad uuid/int/date/json values), class 23
    -- (integrity_constraint_violation: not null, check, unique, foreign key) and P0001
    -- (raise_exception: the explicit rejections above).
    exception when data_exception or integrity_constraint_violation or raise_exception then
      raise warning 'sync_push_for(%): skipped % %: % (%)',
        p_user, c->>'table', c->'row'->>'id', sqlerrm, sqlstate;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'tbl', c->>'table', 'id', c->'row'->>'id', 'reason', 'invalid',
        'detail', sqlerrm || ' (' || sqlstate || ')'));
    end;
  end loop;
  return jsonb_build_object('skipped', v_skipped);
end;
$$;

create or replace function public.sync_pull_for(p_user uuid, p_cursor bigint, p_limit int)
returns jsonb language sql stable as $$
  with rows as (
    select 'profiles' as tbl, server_seq, to_jsonb(p) as row, created_at, updated_at, deleted_at
      from public.profiles p where p.id = p_user and p.server_seq > p_cursor
    union all
    select 'habits', server_seq, to_jsonb(h), created_at, updated_at, deleted_at
      from public.habits h where h.user_id = p_user and h.server_seq > p_cursor
    union all
    select 'habit_completions', server_seq, to_jsonb(c), created_at, updated_at, deleted_at
      from public.habit_completions c where c.user_id = p_user and c.server_seq > p_cursor
    union all
    select 'journal_entries', server_seq, to_jsonb(j), created_at, updated_at, deleted_at
      from public.journal_entries j where j.user_id = p_user and j.server_seq > p_cursor
  ),
  page as (select * from rows order by server_seq limit p_limit + 1),
  head as (select * from page order by server_seq limit p_limit)
  select jsonb_build_object(
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('table', tbl, 'row',
               (row - 'server_seq') || jsonb_build_object(
                 'created_at', public.sync_ts(created_at),
                 'updated_at', public.sync_ts(updated_at),
                 'deleted_at', public.sync_ts(deleted_at)))
             order by server_seq)
        from head), '[]'::jsonb),
    'cursor', (select max(server_seq)::text from head),
    'hasMore', (select count(*) > p_limit from page)
  );
$$;
-- <<< SYNC FUNCTIONS
