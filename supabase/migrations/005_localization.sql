-- ============================================================
-- rock: Localization preferences on profiles
-- ============================================================

alter table public.profiles
  add column time_format text not null default '12h'
    check (time_format in ('12h', '24h')),
  add column date_format text not null default 'MM/DD/YYYY'
    check (date_format in ('DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'));
