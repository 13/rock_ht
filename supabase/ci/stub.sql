-- ============================================================
-- CI only: the smallest slice of a Supabase database that supabase/migrations/*.sql need, so the
-- `supabase-sql-smoke` job (.github/workflows/test.yml) can apply them to a plain postgres:17.
-- It stands in for what a real project provides (the API roles, the `extensions` and `auth`
-- schemas, `auth.users`, `auth.uid()`/`auth.role()`, the realtime publication and Supabase's
-- default privileges). NEVER apply this to a real Supabase project.
-- ============================================================

-- API roles (PostgREST switches to these per request).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase installs extensions into their own schema.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension "uuid-ossp" schema extensions;

-- GoTrue's schema: only the columns the migrations touch.
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- As in Supabase: the caller's id and role come from the JWT claims PostgREST sets per request.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')
$$;

-- Realtime's publication (003 adds tables to it).
create publication supabase_realtime;

-- Supabase's default privileges on public: new tables, sequences and functions are granted to the
-- API roles explicitly, which is why 008 revokes from anon/authenticated and not just from public.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
