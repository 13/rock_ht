# Rolling out migration 008 (offline sync) to a hosted Supabase project

`supabase/migrations/008_sync.sql` adds the offline-sync columns (`deleted_at`, `server_seq`, a completion
`updated_at`), rewrites every completion id to its deterministic value, replaces the `set_updated_at`
triggers, drops the API delete policies on the synced tables, and installs the sync functions plus the
`sync_push` / `sync_pull` RPCs. It is the first migration that changes existing rows. This page covers
applying it to a hosted project safely.

Before anything touches the hosted project, verify it locally: `npm run db:start && npm run db:reset`, then
`npm run test:supabase --workspace=apps/web`.

## 1. Pre-checks on the hosted project

Run these in the SQL editor (or with `psql` against the project's connection string).

**`uuid-ossp` must live in the `extensions` schema.** The completion-id backfill calls
`extensions.uuid_generate_v5`:

```sql
select extnamespace::regnamespace from pg_extension where extname = 'uuid-ossp';
```

The query should return `extensions`, or no row at all, in which case 008 creates the extension there. If it returns
`public`, the backfill fails and 008 rolls back. Move the extension first with
`alter extension "uuid-ossp" set schema extensions;` and check that nothing else refers to `public.uuid_*`.

**Tables and functions must be owned by `postgres`.** 008 runs `create or replace` on 003/007's functions,
and the security-definer RPCs rely on their owner bypassing RLS:

```sql
select relname, relowner::regrole from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('profiles', 'habits', 'habit_completions', 'journal_entries', 'habit_streaks');
select proname, proowner::regrole from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('handle_new_user', 'recalculate_streak', 'handle_completion_insert');
```

Every row should say `postgres`.

**Take a backup first.** Use either of these:

- Dashboard: *Database → Backups*. Confirm there's a recent daily backup, or use point-in-time recovery if the plan has
  it, and note the time.
- CLI: `supabase db dump --linked -f rock_ht-pre-008.sql` (schema) and
  `supabase db dump --linked --data-only -f rock_ht-pre-008-data.sql` (data).

## 2. What applying it does

- `supabase db push` applies each pending migration **in its own transaction**. If any statement in 008
  fails, the whole of 008 rolls back and the database is left at 007.
- `add column … server_seq bigint not null default nextval(…)` has a volatile default, so Postgres
  **rewrites each synced table under an ACCESS EXCLUSIVE lock**. The completion-id backfill also
  updates every completion. At this project's size that means a lock of seconds at most: requests
  to those tables wait for it (they aren't rejected), and the lock is released at commit.
- It has no effect on any running client until it commits.

## 3. Recommended order

1. Run the pre-checks above and take the backup.
2. `supabase db push` (applies 008).
3. Deploy the web app built from this branch. Its data layer soft-deletes, reads only live rows and sends
   deterministic completion ids.
4. Release the mobile build that syncs through `sync_push` / `sync_pull`.

Pushing 008 before the web deploy is safe. Browser tabs still on the old bundle keep working against the new schema:

- their hard deletes affect 0 rows, because 008 drops the API delete policies, so they can't delete a row that offline devices would never hear about;
- their id-less completion inserts get the deterministic id from the `completions_derive_id` trigger;
- the old bundle doesn't filter tombstones, but tombstones only come from new clients.

Deploying the web app before 008 is **not** safe: the new bundle writes `deleted_at` / `updated_at`
columns that don't exist yet.

## 4. Verify afterwards

```sql
-- every completion has its deterministic id (expect 0)
select count(*) from public.habit_completions
 where id <> public.completion_id(habit_id, completed_date);

-- sync columns are filled (expect 0)
select count(*) from public.habits where server_seq is null;

-- no delete policies left on the synced tables (expect no rows)
select tablename, policyname from pg_policies
 where cmd = 'DELETE' and tablename in ('habits', 'habit_completions', 'journal_entries');

-- the API surface (expect: sync_push, sync_pull executable by authenticated; *_for by nobody)
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('sync_push', 'sync_pull', 'sync_push_for', 'sync_pull_for');
```

Then sign in on the web app, toggle a completion on and off, and delete a test habit. It should
disappear from the UI but remain as a row with `deleted_at` set.

## 5. Rolling back

008 isn't trivially reversible. The completion ids are rewritten in place, the old `set_updated_at`
triggers and delete policies are dropped, and new clients start writing tombstones straight away. There's no
down migration. To roll back:

1. Redeploy the previous web build, so it doesn't write the new columns.
2. Restore the backup from step 1, using the dashboard restore or PITR, or by loading the dumps into a fresh project.
   Anything written after the backup is lost unless it's re-exported first.
3. Remove `008` from `supabase_migrations.schema_migrations` if you restored into a database
   that still records it.

If a problem shows up in the sync RPCs only, it's usually cheaper to fix forward with a 009 migration than to roll back.
