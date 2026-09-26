# Rolling out migration 008 (offline sync) to a hosted Supabase project

`supabase/migrations/008_sync.sql` adds the offline-sync columns (`deleted_at`, `server_seq`, a completion
`updated_at`), rewrites every completion id to its deterministic value, replaces the `set_updated_at`
triggers, drops the API delete policies on the synced tables, and installs the sync functions plus the
`sync_push` / `sync_pull` RPCs. It is the first migration that changes existing rows. This page covers
applying it to a hosted project safely.

Before anything touches the hosted project, verify it locally: `npm run db:start && npm run db:reset`, then
`npm run test:supabase --workspace=apps/web`.

## 0. Before merging this branch

As of this branch (sync-m4), nothing in the repo can talk to a hosted Supabase project yet:

- **No repository secrets are set.** `deploy-web.yml` builds the `:latest` web image without
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so that image never queries Supabase
  (web login is disabled; it serves the marketing pages and the self-hosted `/api/sync`).
- **Every deploy step in `deploy-web.yml` is commented out.** Merging to `main` only pushes an image;
  nothing is rolled out automatically.
- **No GitHub release has been published.** The `v0.2.0` tag exists, but no APK was attached to a
  release. The only installed build is the owner's own phone, which already runs a newer
  offline-first build.

So merging is safe today. The rule once that changes:

> **Once the `NEXT_PUBLIC_SUPABASE_*` secrets are set or any deploy step is enabled, apply 008 to the
> hosted project BEFORE merging/deploying the web image.** The new web bundle queries `deleted_at`
> and fails against a 007 schema.

### Stale clients

`v0.2.0` was never published, so no user has a stale client. But any **pre-offline-first build**
(one that talks to Supabase directly through `@rock_ht/db`, with no local database) becomes a stale
client the moment 008 is applied:

- its deletes are no-ops (008 drops the API delete policies, so a hard delete affects 0 rows and the
  item reappears on the next load);
- it shows tombstones (it doesn't filter `deleted_at`), so habits, completions and journal entries
  deleted elsewhere keep showing up.

Any such install must be upgraded to an offline-first build. Don't publish one.

## 1. Pre-checks on the hosted project

**Migration history.** Link the CLI to the project (`supabase link --project-ref <ref>`), then:

```sh
supabase migration list --linked
```

`001`–`007` must show as applied on the remote side, and `008` as local only. If 001–007 were applied
by pasting them into the SQL editor, the remote history is empty and `db push` would try to run them
all again. Mark them as applied first (this only writes the history table, it runs no SQL):

```sh
supabase migration repair --status applied 001 002 003 004 005 006 007
```

Then confirm that only 008 would be applied:

```sh
supabase db push --dry-run
```

Run the SQL checks below in the SQL editor (or with `psql` against the project's connection string).

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

**Take a backup first.** `supabase db dump` skips the Supabase-managed schemas (`auth`, `storage`, …)
by default, so a plain dump has no `auth.users`: restoring it gives you profiles and habits whose
owners don't exist (the `profiles.id → auth.users` foreign key fails). Use one of these:

- **Dashboard backups (paid plans):** *Database → Backups*. Confirm there's a recent daily backup, or
  use point-in-time recovery if the plan has it, and note the time.
- **CLI dumps, including `auth`:**

  ```sh
  supabase db dump --linked -f rock_ht-pre-008-schema.sql                              # public schema
  supabase db dump --linked --data-only -f rock_ht-pre-008-data.sql                    # public data
  supabase db dump --linked --data-only --schema auth -f rock_ht-pre-008-auth-data.sql # auth.users & co.
  ```

  Or dump just the users with `pg_dump "$DB_URL" --data-only --table=auth.users -f auth-users.sql`.
  Keep the files somewhere safe: they contain password hashes and emails.

## 2. What applying it does

- `supabase db push` applies each pending migration **in its own transaction**. If any statement in 008
  fails, the whole of 008 rolls back and the database is left at 007.
- `add column … server_seq bigint not null default nextval(…)` has a volatile default, so Postgres
  **rewrites each synced table under an ACCESS EXCLUSIVE lock**. The completion-id backfill also
  updates every completion. At this project's size that means a lock of seconds at most: requests
  to those tables wait for it (they aren't rejected), and the lock is released at commit.
- It has no effect on any running client until it commits.
- Its last statement is `notify pgrst, 'reload schema'`, so PostgREST picks up the new RPCs and columns
  immediately; there's no need to restart the API.

## 3. Recommended order

1. Run the pre-checks above and take the backup.
2. `supabase db push` (applies 008).
3. Deploy the web app built from this branch. Its data layer soft-deletes, reads only live rows and sends
   deterministic completion ids.
4. **Hard-refresh every open web tab** (or just close them) after the deploy.
5. Release the mobile build that syncs through `sync_push` / `sync_pull`.

Pushing 008 before the web deploy is safe. Browser tabs still on the old bundle keep working against the new schema:

- their hard deletes affect 0 rows, because 008 drops the API delete policies, so they can't delete a row that offline devices would never hear about (the item comes back on the next load; delete it again after a refresh);
- their id-less completion inserts get the deterministic id from the `completions_derive_id` trigger;
- **they don't filter tombstones.** An old tab shows a habit, completion or journal entry that was
  deleted on a new client (a phone, or a refreshed tab) until it is hard-refreshed. That's why step 4
  matters.

Deploying the web app before 008 is **not** safe: the new bundle reads and writes `deleted_at` /
`updated_at` columns that don't exist yet, so every habit and completion query fails.

## 4. Verify afterwards

**SQL:**

```sql
-- every completion has its deterministic id (expect 0)
select count(*) from public.habit_completions
 where id <> public.completion_id(habit_id, completed_date);

-- sync columns are filled (expect 0)
select count(*) from public.habits where server_seq is null;

-- no delete policies left on the synced tables (expect no rows)
select tablename, policyname from pg_policies
 where cmd = 'DELETE' and tablename in ('habits', 'habit_completions', 'journal_entries');

-- the API surface. Expect:
--   sync_push, sync_pull:                        authenticated t, anon f
--   sync_push_for, sync_pull_for, recalculate_streak: authenticated f, anon f
--   service_role t everywhere (it keeps EXECUTE; only the client-facing roles are revoked)
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('sync_push', 'sync_pull', 'sync_push_for', 'sync_pull_for', 'recalculate_streak')
 order by 1;
```

**API** (what the apps actually hit). With `URL=https://<ref>.supabase.co` and `ANON=<anon key>`, sign
in as a test user to get a JWT:

```sh
TOKEN=$(curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"email":"<test user>","password":"<password>"}' | jq -r .access_token)

# authenticated: expect 200 and {"changes":[...],"cursor":...,"hasMore":...}
curl -s -w '\n%{http_code}\n' -X POST "$URL/rest/v1/rpc/sync_pull" -H "apikey: $ANON" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"p_cursor":0,"p_limit":1}'

# anon (no user JWT): expect 401, "permission denied for function sync_pull"
curl -s -w '\n%{http_code}\n' -X POST "$URL/rest/v1/rpc/sync_pull" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"p_cursor":0,"p_limit":1}'
```

A 404 (`PGRST202`, function not found) on the first call means PostgREST hasn't reloaded its schema
cache: run `notify pgrst, 'reload schema';` in the SQL editor.

**By hand:** hard-refresh the web app, sign in, toggle a completion on and off, and delete a test
habit. It should disappear from the UI but remain as a row with `deleted_at` set.

## 5. Rolling back

008 isn't trivially reversible. The completion ids are rewritten in place, the old `set_updated_at`
triggers and delete policies are dropped, and new clients start writing tombstones straight away. There's no
down migration. To roll back:

1. Redeploy the previous web build, so it doesn't write the new columns.
2. Restore the backup from step 1, using the dashboard restore or PITR, or by loading the dumps
   (schema, then `auth` data, then public data) into a fresh project. Anything written after the
   backup is lost unless it's re-exported first.
3. If the restored database still records 008 as applied, mark it reverted with the CLI instead of
   editing `supabase_migrations.schema_migrations` by hand:

   ```sh
   supabase migration repair --status reverted 008
   ```

If a problem shows up in the sync RPCs only, it's usually cheaper to fix forward with a 009 migration than to roll back.
