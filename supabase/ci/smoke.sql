-- ============================================================
-- CI only: runtime checks after supabase/ci/stub.sql and supabase/migrations/*.sql have been
-- applied to a plain postgres:17 (`supabase-sql-smoke` job). plpgsql bodies are only checked
-- when they run, so this fires every trigger and RPC once. Each failure raises and, with
-- ON_ERROR_STOP, fails the job. The full behavioural suite is apps/web's `test:supabase`.
-- ============================================================
\set ON_ERROR_STOP 1
begin;

-- Sign-up trigger (handle_new_user): profile dated just after the epoch.
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'a@example.com', '{"full_name":"Ann"}');

do $$
begin
  if (select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111') is distinct from 'Ann'
     or (select updated_at from public.profiles where id = '11111111-1111-4111-8111-111111111111')
        <> '1970-01-01T00:00:00.001Z'::timestamptz then
    raise exception 'handle_new_user did not create the epoch-dated profile';
  end if;
end $$;

-- From here on, act as that user through PostgREST's role, as the web app does.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.habits (id, user_id, title)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Run');

-- An id-less completion gets its deterministic id (completions_derive_id), bumps server_seq and
-- recalculates the streak cache (security-definer triggers).
insert into public.habit_completions (habit_id, user_id, completed_date)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', current_date);

do $$
begin
  if not exists (select 1 from public.habit_completions
                  where id = public.completion_id('22222222-2222-4222-8222-222222222222', current_date)) then
    raise exception 'completion id was not derived';
  end if;
  if not exists (select 1 from public.habit_streaks where habit_id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'streak cache was not recalculated';
  end if;
end $$;

-- Deletes are soft: the API roles have no delete policy.
delete from public.habits where id = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if not exists (select 1 from public.habits where id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'an authenticated hard delete went through';
  end if;
end $$;

-- The RPCs round-trip.
do $$
declare
  pushed jsonb := public.sync_push(jsonb_build_array(jsonb_build_object(
    'table', 'habits',
    'row', jsonb_build_object(
      'id', '33333333-3333-4333-8333-333333333333', 'user_id', '11111111-1111-4111-8111-111111111111',
      'title', 'Read', 'description', null, 'icon', 'book', 'color', '#6366f1',
      'frequency', '{"type":"daily"}'::jsonb, 'target_value', 1, 'target_unit', null,
      'reminder_time', null, 'reminder_enabled', false, 'is_archived', false, 'sort_order', 1,
      'created_at', '2026-01-01T00:00:00.000Z', 'updated_at', '2026-01-01T00:00:00.000Z',
      'deleted_at', null))));
  page jsonb := public.sync_pull(0, 500);
begin
  if pushed->'skipped' <> '[]'::jsonb then
    raise exception 'sync_push skipped a valid change: %', pushed;
  end if;
  if jsonb_array_length(page->'changes') < 4 then
    raise exception 'sync_pull returned too few changes: %', page;
  end if;
end $$;

-- Internal functions are not callable by the API roles.
do $$
begin
  begin
    perform public.recalculate_streak('22222222-2222-4222-8222-222222222222');
    raise exception 'authenticated could call recalculate_streak';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sync_pull_for('11111111-1111-4111-8111-111111111111', 0, 10);
    raise exception 'authenticated could call sync_pull_for';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
\echo 'supabase sql smoke: ok'
