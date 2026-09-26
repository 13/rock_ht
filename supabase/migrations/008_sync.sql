-- ============================================================
-- rock: offline sync (tombstones, LWW timestamps, server_seq)
-- ============================================================
-- Brings the Supabase schema to the self-hosted one (db/selfhost/init/01_schema.sql) and installs
-- the same sync functions (the marked block below is copied verbatim from
-- db/selfhost/init/02_sync.sql; packages/sync/src/__tests__/sql-parity.test.ts enforces it).
--
-- Differences from self-host, all outside the shared block:
-- * the block's sync_push_for/sync_pull_for take the user id as a parameter, so PostgREST must never
--   expose them: they are revoked from every API role and reached only through the auth.uid()-bound
--   wrappers sync_push/sync_pull at the end of this file (security definer, like the self-host
--   routes' database user, so ownership checks and `skipped` reporting see every row, as there);
-- * RLS stays on for the web app's direct table access. Deletes of synced rows are soft
--   (deleted_at), and the API roles lose their delete policies, so a stale web bundle can't
--   hard-delete a row (a hard delete never reaches offline devices). Account deletion still
--   cascades from auth.users (foreign-key actions aren't subject to RLS);
-- * a before-insert trigger gives every completion its deterministic id, whatever the writer sent.
--
-- Verify locally (never against the hosted project): `npm run db:start && npx supabase db reset`,
-- then `npm run test:supabase --workspace=apps/web`.
-- ============================================================
create extension if not exists "uuid-ossp" with schema extensions;
create sequence if not exists public.sync_seq;
-- The bump_sync_seq trigger (below) calls nextval as the writer: for the web app, PostgREST's
-- `authenticated` role.
grant usage on sequence public.sync_seq to authenticated;

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.habits
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.habit_completions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.journal_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');

-- Completions get deterministic ids so offline devices agree (`completionId` in @rock_ht/sync).
-- Same expression as public.completion_id (defined in the shared block below); inlined because this
-- has to run before the block installs its triggers: otherwise every re-keyed row would take its
-- user's advisory lock (one per user, all held until the migration commits) and recalculate streaks.
update public.habit_completions
  set id = extensions.uuid_generate_v5('6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'::uuid,
                                       lower(habit_id::text) || ':' || to_char(completed_date, 'YYYY-MM-DD'))
  where id is distinct from extensions.uuid_generate_v5('6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'::uuid,
                                       lower(habit_id::text) || ':' || to_char(completed_date, 'YYYY-MM-DD'));
-- No default: writers must use public.completion_id(habit_id, completed_date), never a random id.
alter table public.habit_completions alter column id drop default;

-- The 003 set_updated_at triggers overwrite the device's updated_at with now() on every write and
-- break last-write-wins. bump_sync_seq (shared block) advances updated_at only for writers that
-- don't set it.
drop trigger if exists habits_set_updated_at on public.habits;
drop trigger if exists profiles_set_updated_at on public.profiles;
drop trigger if exists journal_set_updated_at on public.journal_entries;

create index if not exists habits_user_seq_idx on public.habits (user_id, server_seq);
create index if not exists completions_user_seq_idx on public.habit_completions (user_id, server_seq);
create index if not exists journal_user_seq_idx on public.journal_entries (user_id, server_seq);

-- Sign-up profile: dated just after the epoch (as the self-hosted `user.create.after` hook does),
-- so the signing-up device's first profile push wins last-write-wins even when its clock is behind
-- the server's. Not exactly the epoch: `claim()` floors a signed-in device's placeholder profile to
-- the epoch and the client's `isNewer` is strict, so the server profile must be newer than that.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, updated_at)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    '1970-01-01T00:00:00.001Z'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Streak cache: skip tombstoned completions, and judge "today" in the user's timezone
-- (profiles.timezone) as 007 does. Mobile doesn't read this table (it computes streaks locally).
create or replace function public.recalculate_streak(p_habit_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id           uuid;
  v_timezone          text;
  v_today             date;
  v_current_streak    integer := 0;
  v_longest_streak    integer := 0;
  v_last_date         date    := null;
  v_run               integer := 0;
  v_prev_date         date    := null;
  r                   record;
begin
  select h.user_id, coalesce(nullif(p.timezone, ''), 'UTC')
    into v_user_id, v_timezone
    from public.habits h
    left join public.profiles p on p.id = h.user_id
   where h.id = p_habit_id;

  -- Habit already deleted (called from the completion-delete trigger during
  -- the cascade): nothing to recalculate. Same guard as 007.
  if v_user_id is null then
    return;
  end if;

  -- Unknown zone names raise invalid_parameter_value; fall back to UTC (as 007)
  begin
    v_today := (now() at time zone v_timezone)::date;
  exception when invalid_parameter_value then
    v_today := (now() at time zone 'UTC')::date;
  end;

  for r in
    select completed_date
    from public.habit_completions
    where habit_id = p_habit_id and deleted_at is null
    order by completed_date asc
  loop
    if v_prev_date is null or r.completed_date = v_prev_date + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_longest_streak then
      v_longest_streak := v_run;
    end if;
    v_prev_date := r.completed_date;
    v_last_date := r.completed_date;
  end loop;

  if v_last_date is not null then
    v_current_streak := 0;
    v_prev_date := null;
    for r in
      select completed_date
      from public.habit_completions
      where habit_id = p_habit_id and deleted_at is null
      order by completed_date desc
    loop
      if v_prev_date is null then
        -- First row: it must be today or yesterday (user's local date) to count
        if r.completed_date >= v_today - 1 then
          v_current_streak := 1;
          v_prev_date := r.completed_date;
        else
          exit;
        end if;
      elsif r.completed_date = v_prev_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_prev_date := r.completed_date;
      else
        exit;
      end if;
    end loop;
  end if;

  insert into public.habit_streaks
    (habit_id, user_id, current_streak, longest_streak, last_completed_date)
  values
    (p_habit_id, v_user_id, v_current_streak, v_longest_streak, v_last_date)
  on conflict (habit_id) do update set
    current_streak      = excluded.current_streak,
    longest_streak      = greatest(habit_streaks.longest_streak, excluded.longest_streak),
    last_completed_date = excluded.last_completed_date,
    updated_at          = now();
end;
$$;

-- Soft deletes are updates: recalculate on update too.
create or replace trigger on_completion_updated
  after update on public.habit_completions
  for each row execute function public.handle_completion_insert();

-- >>> SYNC FUNCTIONS (keep identical to supabase/migrations/008_sync.sql)

-- The per-user sync lock: pg_advisory_xact_lock(hashtextextended(<user id>::text, 0)).
-- It serializes every writer of one user's synced rows until its transaction ends.
-- server_seq is taken inside the row trigger, but transactions commit out of order:
-- without this, a push could commit seq 11 while another still holds seq 10
-- uncommitted, a concurrent pull would return 11 and advance the client's cursor
-- past 10, and row 10 would never be pulled. Pulls are per user, so a per-user
-- lock is enough; different users never wait on each other.
-- It is taken inline (bump_sync_seq, sync_push_for) rather than through a helper
-- function: on Supabase any function the writer may execute is also an RPC, and a
-- callable lock on arbitrary user ids would let one user stall another's writes.
-- An earlier version had that helper; drop it.
drop function if exists public.sync_lock_user(uuid);

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
  -- Take the user's sync lock (see above) before the seq, so writers that bypass
  -- sync_push_for (the web app, SQL) can't open a cursor gap either.
  if tg_table_name = 'profiles' then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
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
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
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

-- ============================================================
-- Supabase-only: the API surface
-- ============================================================

-- sync_push_for/sync_pull_for act for any p_user: only the auth-bound wrappers below may call them
-- (as this file's owner, via security definer). Supabase's default privileges grant every new
-- function to anon and authenticated, so revoke from those explicitly, not just from public.
revoke execute on function public.sync_push_for(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_pull_for(uuid, bigint, int) from public, anon, authenticated;
-- Helpers of the shared block that no client calls: sync_ts only formats pull output (which runs
-- as this file's owner); completion_id stays executable by authenticated, because the
-- completions_derive_id trigger below runs as the writer (PostgREST's authenticated role).
revoke execute on function public.sync_ts(timestamptz) from public, anon, authenticated;
revoke execute on function public.completion_id(uuid, date) from public, anon;
grant execute on function public.completion_id(uuid, date) to authenticated;

-- Hard deletes of synced rows would never reach offline devices (only tombstones sync), so the API
-- roles can't delete them at all. The auth.users -> profiles -> habits/... cascade of an account
-- deletion is unaffected: foreign-key actions aren't subject to RLS.
drop policy if exists "habits: delete own" on public.habits;
drop policy if exists "completions: delete own" on public.habit_completions;
drop policy if exists "journal: delete own" on public.journal_entries;

-- Every completion gets public.completion_id(habit_id, completed_date) as its id, whatever the writer
-- sent: a web bundle from before 008 sends none (the column has no default), and a random id would
-- make devices that derive the id collide with it on unique (habit_id, completed_date). A before
-- trigger runs ahead of the not-null, primary key and unique checks, and of the ON CONFLICT arbiter,
-- so an id-less upsert of an existing day merges into its row. sync_push_for already sends this id,
-- so the trigger changes nothing for it. Inserts only: no client moves a completion to another habit
-- or day.
create or replace function public.completion_derive_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := public.completion_id(new.habit_id, new.completed_date);
  return new;
end;
$$;
revoke execute on function public.completion_derive_id() from public, anon, authenticated;

create or replace trigger completions_derive_id before insert on public.habit_completions
  for each row execute function public.completion_derive_id();

-- Push the caller's changes (at most 500, like the self-host route). Returns
-- `{ "skipped": [{ "tbl", "id", "reason": "rejected" }] }`: as the self-host push route does, the
-- client only learns that a change was rejected. The real reason ('foreign_owner' says an id exists
-- in another account) and the SQL error detail go to the database log as a warning.
create or replace function public.sync_push(p_changes jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_skipped jsonb;
  s jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 500 then
    raise exception 'too many changes: % (max 500)', jsonb_array_length(p_changes) using errcode = '54000';
  end if;
  v_skipped := coalesce(public.sync_push_for(v_user, p_changes)->'skipped', '[]'::jsonb);
  for s in select value from jsonb_array_elements(v_skipped) loop
    raise warning 'sync_push(%): skipped %/%: %', v_user, s->>'tbl', s->>'id',
      (s->>'reason') || coalesce(' (' || (s->>'detail') || ')', '');
  end loop;
  return jsonb_build_object('skipped', coalesce(
    (select jsonb_agg(jsonb_build_object('tbl', s2->'tbl', 'id', s2->'id', 'reason', 'rejected'))
       from jsonb_array_elements(v_skipped) s2),
    '[]'::jsonb));
end;
$$;

-- Pull the caller's changes after p_cursor (server_seq), p_limit clamped to 1..500.
create or replace function public.sync_pull(p_cursor bigint, p_limit int)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return public.sync_pull_for(v_user, greatest(coalesce(p_cursor, 0), 0),
                              least(greatest(coalesce(p_limit, 200), 1), 500));
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(bigint, int) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, int) to authenticated;
