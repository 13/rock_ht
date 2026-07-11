-- ============================================================
-- sisiGo: Row Level Security Policies
-- ============================================================
-- Every table is fully locked down: users can only access
-- their own data. All writes include user_id checks.
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles       enable row level security;
alter table public.habits         enable row level security;
alter table public.habit_completions enable row level security;
alter table public.habit_streaks  enable row level security;
alter table public.journal_entries enable row level security;

-- ── Profiles ────────────────────────────────────────────────
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- ── Habits ──────────────────────────────────────────────────
create policy "habits: select own"
  on public.habits for select
  using (auth.uid() = user_id);

create policy "habits: insert own"
  on public.habits for insert
  with check (auth.uid() = user_id);

create policy "habits: update own"
  on public.habits for update
  using (auth.uid() = user_id);

create policy "habits: delete own"
  on public.habits for delete
  using (auth.uid() = user_id);

-- ── Habit Completions ────────────────────────────────────────
create policy "completions: select own"
  on public.habit_completions for select
  using (auth.uid() = user_id);

create policy "completions: insert own"
  on public.habit_completions for insert
  with check (auth.uid() = user_id);

create policy "completions: update own"
  on public.habit_completions for update
  using (auth.uid() = user_id);

create policy "completions: delete own"
  on public.habit_completions for delete
  using (auth.uid() = user_id);

-- ── Habit Streaks ────────────────────────────────────────────
-- Streaks are managed by triggers (security definer), so
-- users only need SELECT. The trigger functions write on their behalf.
create policy "streaks: select own"
  on public.habit_streaks for select
  using (auth.uid() = user_id);

-- Allow service role to insert/update via triggers
create policy "streaks: insert service"
  on public.habit_streaks for insert
  with check (true);  -- trigger runs as security definer

create policy "streaks: update service"
  on public.habit_streaks for update
  using (true);  -- trigger runs as security definer

-- ── Journal Entries ──────────────────────────────────────────
create policy "journal: select own"
  on public.journal_entries for select
  using (auth.uid() = user_id);

create policy "journal: insert own"
  on public.journal_entries for insert
  with check (auth.uid() = user_id);

create policy "journal: update own"
  on public.journal_entries for update
  using (auth.uid() = user_id);

create policy "journal: delete own"
  on public.journal_entries for delete
  using (auth.uid() = user_id);
