-- ============================================================
-- rock: timezone-aware streak recalculation (roadmap #16)
-- ============================================================
-- 003_functions_triggers.sql judges "today" with `current_date`, which is
-- the database server's UTC date. For a user west of UTC, in the evening
-- after UTC midnight but before their own local midnight, un-toggling
-- today's completion can zero out a live streak because the server
-- already thinks "today" is tomorrow. This replaces recalculate_streak so
-- "today" is computed in the user's own IANA time zone (profiles.timezone),
-- falling back to UTC when it's empty or not a time zone Postgres knows
-- about. For users already on 'UTC' (the column default), the result is
-- identical to the previous UTC-`current_date` behaviour.

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
  -- Fetch user_id + the profile's raw timezone once.
  select h.user_id, coalesce(nullif(p.timezone, ''), 'UTC')
    into v_user_id, v_timezone
    from public.habits h
    left join public.profiles p on p.id = h.user_id
   where h.id = p_habit_id;

  -- The habit may already be gone (this function is also called from the
  -- on_completion_deleted trigger, which fires after a parent-first habit
  -- delete has removed the habits row via the completions' own ON DELETE
  -- CASCADE). With no habit left, v_user_id is null and there is nothing
  -- to recalculate — upserting here would violate habit_streaks' NOT NULL
  -- user_id (and its FK to habits, which is also gone). Bail out.
  if v_user_id is null then
    return;
  end if;

  -- Resolve "today" in the user's timezone. `at time zone` raises for a
  -- name Postgres doesn't recognize (SQLSTATE 22023,
  -- invalid_parameter_value); catch just that instead of paying for a
  -- pg_timezone_names scan (which enumerates all tzdata entries) on every
  -- completion insert/delete.
  begin
    v_today := (now() at time zone v_timezone)::date;
  exception when invalid_parameter_value then
    v_today := (now() at time zone 'UTC')::date;
  end;

  -- Walk all completions in ascending date order to find longest streak
  for r in
    select completed_date
    from public.habit_completions
    where habit_id = p_habit_id
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

  -- Current streak: walk backwards from latest completion
  if v_last_date is not null then
    -- Reset and recount from the end
    v_current_streak := 0;
    v_prev_date := null;

    for r in
      select completed_date
      from public.habit_completions
      where habit_id = p_habit_id
      order by completed_date desc
    loop
      if v_prev_date is null then
        -- First row: it must be today or yesterday (the user's local
        -- date) to count
        if r.completed_date >= v_today - 1 then
          v_current_streak := 1;
          v_prev_date := r.completed_date;
        else
          exit; -- Streak is already broken
        end if;
      elsif r.completed_date = v_prev_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_prev_date := r.completed_date;
      else
        exit; -- Gap found
      end if;
    end loop;
  end if;

  -- Upsert the streak record
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

-- One-off refresh: re-run the (now timezone-aware) function over every
-- existing habit so cached streaks reflect the fix immediately, rather
-- than waiting for the next completion insert/delete.
do $$
declare
  h record;
begin
  for h in select id from public.habits loop
    perform public.recalculate_streak(h.id);
  end loop;
end;
$$;
