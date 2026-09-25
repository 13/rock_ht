-- ============================================================
-- rock: Functions & Triggers
-- ============================================================

-- ── Auto-create profile on signup ───────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Auto-update updated_at ───────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger habits_set_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger journal_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- ── Streak cache: recalculate from scratch ───────────────────
-- Called after any completion change. Recalculates the streak
-- for the specific habit using daily consecutive logic.
-- For times_per_week habits the frontend recalculates in JS.
create or replace function public.recalculate_streak(p_habit_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id           uuid;
  v_current_streak    integer := 0;
  v_longest_streak    integer := 0;
  v_last_date         date    := null;
  v_run               integer := 0;
  v_prev_date         date    := null;
  r                   record;
begin
  -- Fetch user_id once
  select user_id into v_user_id from public.habits where id = p_habit_id;

  -- Walk all completions in ascending date order to find longest streak
  for r in
    select completed_date
    from public.habit_completions
    where habit_id = p_habit_id
    order by completed_date asc
  loop
    if v_prev_date is null or r.completed_date = v_prev_date + interval '1 day' then
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
        -- First row: it must be today or yesterday to count
        if r.completed_date >= current_date - interval '1 day' then
          v_current_streak := 1;
          v_prev_date := r.completed_date;
        else
          exit; -- Streak is already broken
        end if;
      elsif r.completed_date = v_prev_date - interval '1 day' then
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

-- ── Trigger: on completion insert ───────────────────────────
create or replace function public.handle_completion_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.recalculate_streak(new.habit_id);
  return new;
end;
$$;

create or replace trigger on_completion_inserted
  after insert on public.habit_completions
  for each row execute function public.handle_completion_insert();

-- ── Trigger: on completion delete ───────────────────────────
create or replace function public.handle_completion_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.recalculate_streak(old.habit_id);
  return old;
end;
$$;

create or replace trigger on_completion_deleted
  after delete on public.habit_completions
  for each row execute function public.handle_completion_delete();

-- ── Realtime: enable for all relevant tables ─────────────────
alter publication supabase_realtime add table public.habits;
alter publication supabase_realtime add table public.habit_completions;
alter publication supabase_realtime add table public.habit_streaks;
