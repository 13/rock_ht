-- ============================================================
-- rock: self-hosted schema (plain Postgres, no Supabase)
--
-- Same tables as supabase/migrations/001 + 005 plus the sync columns
-- (deleted_at tombstones, server_seq). No auth.users (Better Auth owns its
-- own tables, see 03_auth.sql), no RLS (the Next.js routes scope every query
-- to the session user), no realtime publication, and no streak trigger
-- (clients compute streaks with calculateStreak from @rock_ht/utils).
--
-- Loaded in file-name order by the postgres image's /docker-entrypoint-initdb.d
-- (and by CI with psql). Sync functions and triggers live in 02_sync.sql.
-- ============================================================

create extension if not exists "uuid-ossp";
create sequence public.sync_seq;

create table public.profiles (
  id uuid primary key,
  email text not null,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  theme text not null default 'dark' check (theme in ('light','dark','midnight','forest','sunset')),
  onboarding_completed boolean not null default false,
  time_format text not null default '12h' check (time_format in ('12h','24h')),
  date_format text not null default 'MM/DD/YYYY'
    check (date_format in ('DD.MM.YYYY','MM/DD/YYYY','YYYY-MM-DD','D MMM YYYY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.sync_seq')
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  icon text not null default '✨',
  color text not null default '#6366f1',
  frequency jsonb not null default '{"type":"daily"}',
  target_value integer not null default 1,
  target_unit text,
  reminder_time time,
  reminder_enabled boolean not null default false,
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.sync_seq')
);

create table public.habit_completions (
  -- No default: always public.completion_id(habit_id, completed_date) (see 02_sync.sql),
  -- the same UUIDv5 every client derives, so unique (habit_id, completed_date) never trips.
  id uuid primary key,
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_date date not null,
  value integer not null default 1,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.sync_seq'),
  unique (habit_id, completed_date)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id uuid references public.habits(id) on delete set null,
  -- No default: current_date is the server's (UTC) date. Clients always send their local date.
  entry_date date not null,
  content text not null,
  mood smallint check (mood between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.sync_seq')
);

create index habits_user_seq_idx on public.habits (user_id, server_seq);
create index completions_user_seq_idx on public.habit_completions (user_id, server_seq);
create index journal_user_seq_idx on public.journal_entries (user_id, server_seq);
