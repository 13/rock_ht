-- ============================================================
-- rock: Initial Schema
-- ============================================================

-- Profiles extending auth.users
create table public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  email        text not null,
  display_name text,
  avatar_url   text,
  timezone     text not null default 'UTC',
  theme        text not null default 'dark'
               check (theme in ('light', 'dark', 'midnight', 'forest', 'sunset')),
  onboarding_completed boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'User profiles, one per auth.users row.';

-- Habits
create table public.habits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.profiles(id) on delete cascade not null,
  title            text not null,
  description      text,
  icon             text not null default '✨',
  color            text not null default '#6366f1',
  -- frequency JSONB: { type: 'daily' }
  --                | { type: 'specific_days', days: number[] }
  --                | { type: 'times_per_week', count: number }
  frequency        jsonb not null default '{"type":"daily"}',
  target_value     integer not null default 1,
  target_unit      text,
  reminder_time    time,
  reminder_enabled boolean not null default false,
  is_archived      boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index habits_user_id_idx on public.habits(user_id);
create index habits_user_id_archived_idx on public.habits(user_id, is_archived);

comment on table public.habits is 'Habit definitions created by users.';
comment on column public.habits.frequency is 'JSON: { type: daily|specific_days|times_per_week, ... }';

-- Habit completions
create table public.habit_completions (
  id             uuid primary key default gen_random_uuid(),
  habit_id       uuid references public.habits(id) on delete cascade not null,
  user_id        uuid references public.profiles(id) on delete cascade not null,
  completed_date date not null,
  value          integer not null default 1,
  note           text,
  created_at     timestamptz not null default now(),
  -- Enforce one completion per habit per day
  unique (habit_id, completed_date)
);

create index completions_habit_id_idx on public.habit_completions(habit_id);
create index completions_user_id_date_idx on public.habit_completions(user_id, completed_date);
create index completions_habit_date_idx on public.habit_completions(habit_id, completed_date desc);

comment on table public.habit_completions is 'Daily completion records for habits.';

-- Habit streaks (cached, maintained by triggers)
create table public.habit_streaks (
  habit_id            uuid references public.habits(id) on delete cascade primary key,
  user_id             uuid references public.profiles(id) on delete cascade not null,
  current_streak      integer not null default 0,
  longest_streak      integer not null default 0,
  last_completed_date date,
  updated_at          timestamptz not null default now()
);

create index streaks_user_id_idx on public.habit_streaks(user_id);

comment on table public.habit_streaks is 'Cached streak counts, updated by triggers on habit_completions.';

-- Journal entries (optional)
create table public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  habit_id   uuid references public.habits(id) on delete set null,
  entry_date date not null default current_date,
  content    text not null,
  mood       smallint check (mood between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index journal_user_id_date_idx on public.journal_entries(user_id, entry_date desc);

comment on table public.journal_entries is 'Optional daily journal entries, optionally linked to a habit.';
