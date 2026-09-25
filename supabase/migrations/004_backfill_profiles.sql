-- ============================================================
-- rock: Backfill profiles for pre-existing auth users
-- Handles users who signed up before migration 003 was applied.
-- Safe to run multiple times (ON CONFLICT DO NOTHING).
-- ============================================================

insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  )
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
);
