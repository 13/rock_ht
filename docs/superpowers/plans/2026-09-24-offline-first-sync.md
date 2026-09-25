# Offline-First Mobile + Pluggable Sync Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app works fully offline with no account, no network and no env vars. Syncing to a self-hosted plain Postgres backend (Next.js + Better Auth + Postgres in Docker) or to Supabase is optional and chosen at runtime in the app's settings.

**Architecture:** On-device SQLite is the source of truth on mobile. Every local write updates the row and appends a snapshot to an `outbox` table in one exclusive transaction, from M1 on, so enabling sync later needs no data migration. A transport-agnostic sync engine (`@rock_ht/sync`, M2) pushes the outbox and pulls remote changes using a monotonic `server_seq` cursor. Rows merge last-write-wins on `updated_at`, and deletes are tombstones (`deleted_at`). Both backends run the same Postgres sync functions (`sync_push_for` / `sync_pull_for`): the self-hosted Next.js server (M3) calls them over `pg` after authenticating the user with Better Auth, and Supabase (M4) exposes them through RPC wrappers that use `auth.uid()`.

**Tech Stack:** TypeScript, Expo SDK 55 (`expo-sqlite ~55.0.16`, `expo-crypto ~55.0.15`, `expo-secure-store`, `expo-notifications`, `expo-file-system ~55.0.20`, `expo-sharing ~55.0.19`, `expo-document-picker ~55.0.13`), TanStack Query, vitest + `better-sqlite3 ^12.10` (tests), Postgres 17, Next.js 16 route handlers, `pg`, Better Auth 1.7.x (+ `@better-auth/expo`), Supabase JS.

## Revision 2026-09-25

Revised after the P0 timezone fixes (c6c4195), the rename to `rock_ht` (91c5876) and `scripts/build-apk.sh` (2febad5), and after the user chose **plain Postgres** as the self-hosted backend (Supabase stays a second, optional backend). Changes:

- **Milestones instead of phases.** M1 delivers the fully offline app on its own; the sync engine (M2), the self-hosted backend (M3) and Supabase (M4) follow. Tasks are renumbered 1–15 in execution order. The sync engine (old Task 2) moved to M2; its two-store sync test moved from the local store task to Task 10.
- **New M1 tasks:** 7 (reminders rebuilt from the local DB and scheduled per habit frequency), 8 (JSON export/import), 9 (build script and CI no longer need Supabase env, unused mobile deps removed, on-device airplane-mode checklist). The LocalProvider error screen and TanStack Query `networkMode: 'always'` were folded into Task 4.
- **Date bugs removed from the plan's own code:** the journal default date and the 30-day completion window now use `today()` / `subtractDays()` (local calendar dates, as P0 requires) instead of `toISOString().slice(0, 10)`; completion query keys include the local date so an app left open past midnight refetches; new profiles take the device timezone instead of `'UTC'`.
- **Server fixes:** `sync_push_for` no longer nulls `display_name` on `claim()`; the Supabase streak function (roadmap #16) uses `profiles.timezone`; the self-host schema drops `entry_date default current_date`.
- **Tooling:** CI already runs `npx turbo run test` in a 4-timezone matrix (the old Task 1 Step 6 is dropped); mobile type-checks run `typegen` first; `better-sqlite3 ^12.10` (Node 20–26 prebuilds); Better Auth pinned to 1.7.6 with its Expo peers (option names verified against the 1.7.6 type definitions); URL scheme `rockht`; `expo-sqlite` driver uses `withExclusiveTransactionAsync` and forwards generics; `fetch` mocks typed as `vi.fn<typeof fetch>()`.
- **Android specifics:** `apps/mobile/android/` is committed, so Expo config plugins and `expo-build-properties` do not apply. Native changes (cleartext for user-configured LAN servers) are made directly in `AndroidManifest.xml` and `res/xml/`; autolinking is enough for new Expo modules. The self-host deploy gate in `deploy-web.yml` is changed so the image builds without Supabase secrets.

## Global Constraints

- TypeScript everywhere; new workspace packages follow the existing layout: `main`/`types`/`exports` point at `./src/index.ts`, no build step (see `packages/utils/package.json`).
- Node 20 in CI (`actions/setup-node` `node-version: 20`), so no `node:sqlite`; tests use `better-sqlite3 ^12.10`. Local npm 12 blocks install scripts: run `npm install-scripts approve better-sqlite3` once after installing it, or its native binary is missing.
- CI (`.github/workflows/test.yml`) runs `npx turbo run test` for every workspace under `TZ` = `UTC`, `Pacific/Kiritimati`, `Pacific/Pago_Pago` and `America/New_York`. Every new test must pass in all four; build calendar dates with `today()`, `subtractDays()` and `addDaysToDate()` from `@rock_ht/utils`, never with `toISOString().slice(0, 10)`.
- Calendar dates (`completed_date`, `entry_date`) are the device's local date as `yyyy-MM-dd`. Instants (`created_at`, `updated_at`, `deleted_at`) are ISO-8601 UTC strings as produced by `Date.prototype.toISOString()` (e.g. `2026-09-24T20:00:00.000Z`). Adapters normalize instants with `normalizeTimestamp`.
- The mobile app must start, create habits, toggle completions, journal, compute streaks, fire reminders and export/import its data with **no network, no account, and no env vars**.
- Supabase stays optional: nothing in `apps/mobile` may read `EXPO_PUBLIC_SUPABASE_*` at import time; Supabase config comes from the runtime sync settings. `EXPO_PUBLIC_SENTRY_DSN` stays optional (Sentry is a no-op without it).
- Completion ids are deterministic: `completionId(habit_id, completed_date)` = UUIDv5 with namespace `6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f`. Postgres uses `uuid_generate_v5` with the same namespace.
- Synced tables: `profiles`, `habits`, `habit_completions`, `journal_entries`. `habit_streaks` is **not** synced; mobile computes streaks with `calculateStreak` from `@rock_ht/utils`.
- Deletes of synced rows are soft (`deleted_at` set, `updated_at` bumped) on every client, including the web app.
- `apps/mobile/android/` is committed: no `expo prebuild`, no config plugins for native changes. Build and install APKs with `scripts/build-apk.sh --install <serial>` (signs with the shared release key; a raw `adb install` of a debug-signed APK fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
- Mobile type-check always runs after typegen: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile`.

## Scope and sequencing

Each milestone ends with working, shippable software:

| Milestone | Tasks | Deliverable | Works without |
|---|---|---|---|
| M1 | 1–9 | Android app fully offline: local SQLite store (with outbox), no login, reminders, export/import, APK builds with no env | any backend, any network |
| M2 | 10–11 | Sync engine, HTTP remote, sync settings (Off / Self-hosted / Supabase), background triggers, cleartext for LAN servers | a running backend (settings stay Off) |
| M3 | 12–13 | Self-hosted plain Postgres backend: sync SQL, Better Auth, `/api/sync`, web image builds without Supabase, `docker-compose.selfhost.yml` | Supabase |
| M4 | 14–15 | Supabase as an optional backend: migration 007 (sync columns, RPCs, timezone-aware streaks), web soft deletes, Supabase remote | self-host |
| Later | — | Web app without Supabase (**separate plan**, outlined only) | — |

Porting the Next.js UI off Supabase auth/queries is a separate plan. This plan only makes the web **build** without Supabase env (Task 13) so the self-host image can be built.

## File structure

```
packages/sync/                      NEW  transport-agnostic protocol
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                      re-exports
  src/types.ts                      SyncTable, SyncRow, SyncChange, SyncRemote, SyncLocal, PullResult   (M1)
  src/merge.ts                      isNewer, normalizeTimestamp                                         (M1)
  src/ids.ts                        completionId (uuid v5)                                              (M1)
  src/engine.ts                     runSync(local, remote)                                              (M2)
  src/http-remote.ts                createHttpRemote (self-host)                                        (M2)
  src/supabase-remote.ts            createSupabaseRemote (RPC)                                          (M4)
  src/__tests__/*.test.ts

packages/local-db/                  NEW  SQLite store over an injectable driver
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts
  src/driver.ts                     SqlDriver, SqlParam
  src/schema.ts                     MIGRATIONS + migrate()
  src/codec.ts                      COLUMNS, toSqlRow, fromSqlRow
  src/store.ts                      createLocalStore → repos + SyncLocal + claim()
  src/backup.ts                     Backup format, parseBackup()                                        (Task 8)
  src/__tests__/helpers.ts          better-sqlite3 driver for tests
  src/__tests__/*.test.ts

packages/utils/src/reminders.ts     NEW  reminderTriggers(frequency, time)                              (Task 7)

apps/mobile/
  lib/sqlite-driver.ts              NEW  expo-sqlite → SqlDriver
  lib/local.ts                      NEW  singleton open + migrate
  providers/local-provider.tsx      NEW  LocalProvider/useLocal (store, userId) + error screen
  providers/auth-provider.tsx       NEW  replaces supabase-provider; same useAuth() shape
  providers/query-provider.tsx      MODIFY networkMode 'always'
  lib/notifications.ts              MODIFY per-frequency triggers + rebuildReminders()                  (Task 7)
  lib/backup.ts                     NEW  export (share file) / import (document picker)                 (Task 8)
  lib/sync/config.ts                NEW  SyncConfig persisted in SecureStore                            (M2)
  lib/sync/remote-factory.ts        NEW  SyncConfig → SyncRemote + auth                                 (M2)
  lib/sync/service.ts               NEW  single-flight sync + triggers                                  (M2)
  hooks/use-streaks.ts              NEW
  hooks/use-profile.ts              NEW
  hooks/use-sync.ts                 NEW                                                                 (M2)
  app/sync-settings.tsx             NEW  choose Off / Self-hosted / Supabase, sign in                   (M2)
  hooks/use-habits.ts, use-completions.ts, use-journal.ts, use-notifications.ts   MODIFY  local store
  app/_layout.tsx, app/(tabs)/*.tsx, app/habit/[id].tsx, app/onboarding.tsx  MODIFY
  lib/supabase.ts, lib/offline-queue.ts, providers/supabase-provider.tsx,
  hooks/use-realtime.ts, app/(auth)/*                        DELETE / MOVE
  android/app/src/main/res/xml/network_security_config.xml   NEW  cleartext for LAN sync servers      (M2)
  android/app/src/main/AndroidManifest.xml                   MODIFY                                   (M2)
  .env.local.example                                         MODIFY Sentry only                       (Task 9)

scripts/build-apk.sh                MODIFY no Supabase env required                                     (Task 9)
.github/workflows/android-apk.yml   MODIFY drop EXPO_PUBLIC_SUPABASE_* secrets                          (Task 9)

db/selfhost/init/01_schema.sql      NEW  tables without auth.users/RLS                                  (M3)
db/selfhost/init/02_sync.sql        NEW  sync functions (identical block to 007)                        (M3)
db/selfhost/init/03_auth.sql        NEW  Better Auth tables (generated)                                 (M3)
docker-compose.selfhost.yml         NEW                                                                 (M3)
apps/web/lib/server/db.ts           NEW  pg Pool                                                        (M3)
apps/web/lib/server/auth.ts         NEW  Better Auth instance                                           (M3)
apps/web/app/api/auth/[...all]/route.ts   NEW                                                           (M3)
apps/web/app/api/sync/push/route.ts NEW                                                                 (M3)
apps/web/app/api/sync/pull/route.ts NEW                                                                 (M3)
.github/workflows/deploy-web.yml    MODIFY build without Supabase secrets                               (M3)
supabase/migrations/007_sync.sql    NEW                                                                 (M4)
packages/db/src/*.ts                MODIFY  soft deletes + deleted_at filters                           (M4)
packages/types/src/database.types.ts MODIFY  new columns                                                (M4)
```

---

## M1 — Fully offline Android app

### Task 1: `@rock_ht/sync` package, types, merge rules, completion ids

**Files:**
- Create: `packages/sync/package.json`, `packages/sync/tsconfig.json`, `packages/sync/vitest.config.ts`
- Create: `packages/sync/src/types.ts`, `src/merge.ts`, `src/ids.ts`, `src/index.ts`
- Test: `packages/sync/src/__tests__/merge.test.ts`, `src/__tests__/ids.test.ts`

CI needs no change: `.github/workflows/test.yml` already runs `npx turbo run test` for every workspace in a 4-timezone matrix, so the new package is picked up automatically.

**Interfaces:**
- Produces:
  - `SYNC_TABLES: readonly ["profiles","habits","habit_completions","journal_entries"]`
  - `type SyncTable`
  - `interface SyncRow { id: string; updated_at: string; deleted_at: string | null; [col: string]: unknown }`
  - `interface SyncChange { table: SyncTable; row: SyncRow }`
  - `interface PullResult { changes: SyncChange[]; cursor: string | null; hasMore: boolean }`
  - `interface SyncRemote { push(changes: SyncChange[]): Promise<void>; pull(cursor: string | null, limit: number): Promise<PullResult> }`
  - `interface OutboxEntry { seq: number; change: SyncChange }`
  - `interface SyncLocal { readOutbox(limit: number): Promise<OutboxEntry[]>; ackOutbox(uptoSeq: number): Promise<void>; getRow(table: SyncTable, id: string): Promise<SyncRow | null>; getCursor(): Promise<string | null>; applyRemote(changes: SyncChange[], cursor: string | null): Promise<void> }`
  - `isNewer(incoming: SyncRow, existing: SyncRow | null): boolean`
  - `normalizeTimestamp(value: string): string`
  - `completionId(habitId: string, date: string): string`
  - `COMPLETION_NAMESPACE = "6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f"`

- [ ] **Step 1: Scaffold the package**

`packages/sync/package.json`:
```json
{
  "name": "@rock_ht/sync",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "uuid": "^11.1.0" },
  "devDependencies": {
    "@rock_ht/types": "*",
    "typescript": "^5.7.2",
    "vitest": "^3.2.7"
  }
}
```

`packages/sync/tsconfig.json` (copy of `packages/utils/tsconfig.json`; check that file first and keep its `extends`/`compilerOptions`, changing nothing but paths if needed).

`packages/sync/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
})
```

Run: `npm install` (root). Expected: `uuid` added under `packages/sync`, lockfile updated.

- [ ] **Step 2: Write failing tests**

`packages/sync/src/__tests__/merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isNewer, normalizeTimestamp } from '../merge'
import type { SyncRow } from '../types'

const row = (updated_at: string): SyncRow => ({ id: 'a', updated_at, deleted_at: null })

describe('isNewer', () => {
  it('accepts when no local row exists', () => {
    expect(isNewer(row('2026-01-01T00:00:00.000Z'), null)).toBe(true)
  })
  it('accepts strictly newer timestamps', () => {
    expect(isNewer(row('2026-01-02T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(true)
  })
  it('rejects equal timestamps (echo of our own push)', () => {
    expect(isNewer(row('2026-01-01T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(false)
  })
  it('rejects older timestamps', () => {
    expect(isNewer(row('2025-12-31T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(false)
  })
})

describe('normalizeTimestamp', () => {
  it('converts Postgres offset format to toISOString format', () => {
    expect(normalizeTimestamp('2026-09-24T20:00:00.123+00:00')).toBe('2026-09-24T20:00:00.123Z')
  })
  it('truncates microseconds to milliseconds', () => {
    expect(normalizeTimestamp('2026-09-24T20:00:00.123456+00:00')).toBe('2026-09-24T20:00:00.123Z')
  })
})
```

`packages/sync/src/__tests__/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { completionId } from '../ids'

describe('completionId', () => {
  it('is deterministic for the same habit and date', () => {
    const h = '0b5c6a1e-2f3d-4c5b-8a9e-1f2d3c4b5a6e'
    expect(completionId(h, '2026-09-24')).toBe(completionId(h, '2026-09-24'))
  })
  it('differs across dates', () => {
    const h = '0b5c6a1e-2f3d-4c5b-8a9e-1f2d3c4b5a6e'
    expect(completionId(h, '2026-09-24')).not.toBe(completionId(h, '2026-09-25'))
  })
  it('is a version-5 uuid', () => {
    expect(completionId('x', '2026-09-24')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test --workspace=packages/sync`
Expected: FAIL, `Failed to resolve import "../merge"`.

- [ ] **Step 4: Implement**

`packages/sync/src/types.ts`:
```ts
export const SYNC_TABLES = ['profiles', 'habits', 'habit_completions', 'journal_entries'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** A row as stored in Postgres (jsonb columns as objects), plus sync metadata. */
export interface SyncRow {
  id: string
  /** ISO-8601 UTC set by the device that made the change. Last write wins. */
  updated_at: string
  /** Tombstone. Non-null means the row is deleted. */
  deleted_at: string | null
  [column: string]: unknown
}

export interface SyncChange {
  table: SyncTable
  row: SyncRow
}

export interface PullResult {
  changes: SyncChange[]
  /** Opaque; pass back on the next pull. */
  cursor: string | null
  hasMore: boolean
}

export interface SyncRemote {
  push(changes: SyncChange[]): Promise<void>
  pull(cursor: string | null, limit: number): Promise<PullResult>
}

export interface OutboxEntry {
  seq: number
  change: SyncChange
}

export interface SyncLocal {
  readOutbox(limit: number): Promise<OutboxEntry[]>
  /** Delete outbox entries with seq <= uptoSeq. */
  ackOutbox(uptoSeq: number): Promise<void>
  getRow(table: SyncTable, id: string): Promise<SyncRow | null>
  getCursor(): Promise<string | null>
  /** Write rows without creating outbox entries and store the cursor, atomically. */
  applyRemote(changes: SyncChange[], cursor: string | null): Promise<void>
}
```

`packages/sync/src/merge.ts`:
```ts
import type { SyncRow } from './types'

export function isNewer(incoming: SyncRow, existing: SyncRow | null): boolean {
  if (!existing) return true
  return incoming.updated_at > existing.updated_at
}

export function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString()
}
```

`packages/sync/src/ids.ts`:
```ts
import { v5 as uuidv5 } from 'uuid'

export const COMPLETION_NAMESPACE = '6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'

/** One completion per habit per day, so every device derives the same id. */
export function completionId(habitId: string, date: string): string {
  return uuidv5(`${habitId}:${date}`, COMPLETION_NAMESPACE)
}
```

`packages/sync/src/index.ts`:
```ts
export * from './types'
export * from './merge'
export * from './ids'
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test --workspace=packages/sync`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the tests in every CI timezone**

```bash
for tz in UTC Pacific/Kiritimati Pacific/Pago_Pago America/New_York; do
  TZ=$tz npx turbo run test --force || { echo "FAILED in $tz"; break; }
done
```
Expected: `@rock_ht/utils` and `@rock_ht/sync` pass in all four timezones (`--force` skips the turbo cache, as CI does).

- [ ] **Step 7: Commit**

```bash
git add packages/sync package.json package-lock.json
git commit -m "feat(sync): add sync protocol types, LWW merge and deterministic completion ids"
```

### Task 2: `@rock_ht/local-db` driver, schema, migrations, codec

**Files:**
- Create: `packages/local-db/package.json`, `tsconfig.json`, `vitest.config.ts` (same shape as Task 1; name `@rock_ht/local-db`)
- Create: `src/driver.ts`, `src/schema.ts`, `src/codec.ts`, `src/index.ts`
- Test: `src/__tests__/helpers.ts`, `src/__tests__/schema.test.ts`, `src/__tests__/codec.test.ts`

**Interfaces:**
- Consumes: `SyncTable`, `SyncRow` from `@rock_ht/sync`.
- Produces:
  - `type SqlParam = string | number | null`
  - `interface SqlDriver { exec(sql: string): Promise<void>; run(sql: string, params?: SqlParam[]): Promise<void>; all<T>(sql: string, params?: SqlParam[]): Promise<T[]>; first<T>(sql: string, params?: SqlParam[]): Promise<T | null>; transaction(fn: (tx: SqlDriver) => Promise<void>): Promise<void> }`. Inside `fn`, run every statement on `tx`, never on the outer driver: on device the transaction is exclusive (`withExclusiveTransactionAsync`), so statements on the outer connection would not be part of it. Calling `tx.transaction(...)` runs flat inside the current transaction (no nesting).
  - `migrate(driver: SqlDriver): Promise<void>`
  - `COLUMNS: Record<SyncTable, Record<string, 'text' | 'int' | 'bool' | 'json'>>`
  - `toSqlRow(table: SyncTable, row: SyncRow): Record<string, SqlParam>`
  - `fromSqlRow(table: SyncTable, raw: Record<string, SqlParam>): SyncRow`
  - test helper `openTestDriver(): SqlDriver`

- [ ] **Step 1: Scaffold**

`packages/local-db/package.json`:
```json
{
  "name": "@rock_ht/local-db",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@rock_ht/sync": "*",
    "@rock_ht/types": "*",
    "@rock_ht/utils": "*"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "better-sqlite3": "^12.10.1",
    "typescript": "^5.7.2",
    "vitest": "^3.2.7"
  }
}
```
Run: `npm install`, then `npm install-scripts approve better-sqlite3` (npm 12 blocks dependency install scripts; without this the native binary is never fetched and every test fails with `Could not locate the bindings file`). CI's Node 20 ships npm 10, which runs install scripts by default.

- [ ] **Step 2: Test helper (better-sqlite3 → SqlDriver)**

`packages/local-db/src/__tests__/helpers.ts`:
```ts
import Database from 'better-sqlite3'
import type { SqlDriver, SqlParam } from '../driver'

export function openTestDriver(): SqlDriver {
  const db = new Database(':memory:')

  function make(inTx: boolean): SqlDriver {
    const driver: SqlDriver = {
      async exec(sql) { db.exec(sql) },
      async run(sql, params = []) { db.prepare(sql).run(...params) },
      async all<T>(sql: string, params: SqlParam[] = []) { return db.prepare(sql).all(...params) as T[] },
      async first<T>(sql: string, params: SqlParam[] = []) { return (db.prepare(sql).get(...params) ?? null) as T | null },
      async transaction(fn) {
        // Already inside a transaction: run flat, like the device driver.
        if (inTx) return fn(driver)
        db.exec('BEGIN IMMEDIATE')
        try { await fn(make(true)); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
      },
    }
    return driver
  }

  return make(false)
}
```

- [ ] **Step 3: Write failing tests**

`packages/local-db/src/__tests__/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { migrate } from '../schema'
import { openTestDriver } from './helpers'

describe('migrate', () => {
  it('creates all tables and is idempotent', async () => {
    const d = openTestDriver()
    await migrate(d)
    await migrate(d)
    const tables = await d.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    expect(tables.map((t) => t.name)).toEqual([
      'habit_completions', 'habits', 'journal_entries', 'meta', 'outbox', 'profiles',
    ])
    const v = await d.first<{ user_version: number }>('PRAGMA user_version')
    expect(v?.user_version).toBe(1)
  })

  it('rolls a failed transaction back, including nested calls', async () => {
    const d = openTestDriver()
    await migrate(d)
    await expect(d.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('a', '1')")
      await tx.transaction(async (inner) => {
        await inner.run("INSERT INTO meta (key, value) VALUES ('b', '2')")
      })
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await d.all('SELECT * FROM meta')).toEqual([])
  })
})
```

`packages/local-db/src/__tests__/codec.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toSqlRow, fromSqlRow } from '../codec'

describe('codec', () => {
  it('round-trips habits (bool + json columns)', () => {
    const row = {
      id: 'h', user_id: 'u', title: 'Run', description: null, icon: '🏃', color: '#6366f1',
      frequency: { type: 'specific_days', days: [1, 3] }, target_value: 1, target_unit: null,
      reminder_time: '07:30:00', reminder_enabled: true, is_archived: false, sort_order: 0,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
    }
    const sql = toSqlRow('habits', row)
    expect(sql.frequency).toBe('{"type":"specific_days","days":[1,3]}')
    expect(sql.reminder_enabled).toBe(1)
    expect(fromSqlRow('habits', sql)).toEqual(row)
  })

  it('drops unknown columns such as server_seq', () => {
    const sql = toSqlRow('journal_entries', {
      id: 'j', user_id: 'u', habit_id: null, entry_date: '2026-01-01', content: 'hi', mood: 4,
      created_at: 'c', updated_at: 'u', deleted_at: null, server_seq: 99,
    })
    expect('server_seq' in sql).toBe(false)
  })
})
```

- [ ] **Step 4: Run, verify fail**

Run: `npm test --workspace=packages/local-db` → FAIL (missing modules).

- [ ] **Step 5: Implement**

`packages/local-db/src/driver.ts`:
```ts
export type SqlParam = string | number | null

/** Minimal async SQLite surface; implemented by expo-sqlite on device and better-sqlite3 in tests. */
export interface SqlDriver {
  exec(sql: string): Promise<void>
  run(sql: string, params?: SqlParam[]): Promise<void>
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>
  /**
   * Runs `fn` in one exclusive transaction. Use only `tx` inside `fn`.
   * `tx.transaction(g)` runs `g(tx)` flat inside the same transaction.
   */
  transaction(fn: (tx: SqlDriver) => Promise<void>): Promise<void>
}
```

`packages/local-db/src/schema.ts`:
```ts
import type { SqlDriver } from './driver'

// Mirrors the Postgres tables (see supabase/migrations) plus sync columns.
// Append new migrations; never edit a shipped one.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    row_json TEXT NOT NULL
  );
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    theme TEXT NOT NULL DEFAULT 'dark',
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    time_format TEXT NOT NULL DEFAULT '12h',
    date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE habits (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    frequency TEXT NOT NULL,
    target_value INTEGER NOT NULL DEFAULT 1,
    target_unit TEXT,
    reminder_time TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE habit_completions (
    id TEXT PRIMARY KEY NOT NULL,
    habit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_date TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (habit_id, completed_date)
  );
  CREATE INDEX completions_date_idx ON habit_completions (completed_date);
  CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    habit_id TEXT,
    entry_date TEXT NOT NULL,
    content TEXT NOT NULL,
    mood INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX journal_date_idx ON journal_entries (entry_date);
  `,
]

export async function migrate(driver: SqlDriver): Promise<void> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version')
  const current = row?.user_version ?? 0
  for (let v = current; v < MIGRATIONS.length; v++) {
    await driver.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[v]!)
      await tx.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}
```

`packages/local-db/src/codec.ts`:
```ts
import type { SyncRow, SyncTable } from '@rock_ht/sync'
import type { SqlParam } from './driver'

type Kind = 'text' | 'int' | 'bool' | 'json'

const meta = { created_at: 'text', updated_at: 'text', deleted_at: 'text' } as const

export const COLUMNS: Record<SyncTable, Record<string, Kind>> = {
  profiles: {
    id: 'text', email: 'text', display_name: 'text', avatar_url: 'text', timezone: 'text',
    theme: 'text', onboarding_completed: 'bool', time_format: 'text', date_format: 'text', ...meta,
  },
  habits: {
    id: 'text', user_id: 'text', title: 'text', description: 'text', icon: 'text', color: 'text',
    frequency: 'json', target_value: 'int', target_unit: 'text', reminder_time: 'text',
    reminder_enabled: 'bool', is_archived: 'bool', sort_order: 'int', ...meta,
  },
  habit_completions: {
    id: 'text', habit_id: 'text', user_id: 'text', completed_date: 'text', value: 'int',
    note: 'text', ...meta,
  },
  journal_entries: {
    id: 'text', user_id: 'text', habit_id: 'text', entry_date: 'text', content: 'text',
    mood: 'int', ...meta,
  },
}

export function toSqlRow(table: SyncTable, row: SyncRow): Record<string, SqlParam> {
  const out: Record<string, SqlParam> = {}
  for (const [col, kind] of Object.entries(COLUMNS[table])) {
    const v = row[col]
    if (v === undefined || v === null) out[col] = null
    else if (kind === 'bool') out[col] = v ? 1 : 0
    else if (kind === 'json') out[col] = JSON.stringify(v)
    else out[col] = v as SqlParam
  }
  return out
}

export function fromSqlRow(table: SyncTable, raw: Record<string, SqlParam>): SyncRow {
  const out: Record<string, unknown> = {}
  for (const [col, kind] of Object.entries(COLUMNS[table])) {
    const v = raw[col] ?? null
    if (v === null) out[col] = null
    else if (kind === 'bool') out[col] = v === 1
    else if (kind === 'json') out[col] = JSON.parse(v as string)
    else out[col] = v
  }
  return out as SyncRow
}
```

`packages/local-db/src/index.ts`:
```ts
export * from './driver'
export * from './schema'
export * from './codec'
```

- [ ] **Step 6: Run, verify pass**

Run: `npm test --workspace=packages/local-db` → PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/local-db package.json package-lock.json
git commit -m "feat(local-db): add SQLite schema, migrations and row codec"
```

### Task 3: Local store repositories + `SyncLocal` + account claim

**Files:**
- Create: `packages/local-db/src/store.ts`
- Modify: `packages/local-db/src/index.ts`
- Test: `packages/local-db/src/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `SqlDriver`, `migrate`, `toSqlRow`, `fromSqlRow`, `completionId` and the `SyncLocal`/`OutboxEntry`/`SyncChange` types from Task 1, `parseFrequency`/`frequencyToJson`/`today` from `@rock_ht/utils`, types from `@rock_ht/types`. The sync engine itself (`runSync`) is not needed until Task 10; the outbox is written from day one so enabling sync later needs no migration.
- Produces `createLocalStore(deps: LocalStoreDeps): LocalStore` where:
```ts
interface LocalStoreDeps { driver: SqlDriver; newId: () => string; now: () => string; timeZone?: () => string }
interface LocalStore {
  ensureProfile(userId: string): Promise<ProfileRow>
  getProfile(userId: string): Promise<ProfileRow | null>
  updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileRow>
  listHabits(userId: string, opts?: { includeArchived?: boolean }): Promise<HabitWithFrequency[]>
  getHabit(id: string): Promise<HabitWithFrequency | null>
  createHabit(userId: string, input: CreateHabitInput): Promise<HabitWithFrequency>
  updateHabit(input: UpdateHabitInput): Promise<HabitWithFrequency>
  deleteHabit(id: string): Promise<void>
  listCompletions(userId: string, opts?: { habitId?: string; startDate?: string; endDate?: string }): Promise<CompletionRow[]>
  setCompletion(userId: string, input: ToggleCompletionInput, done: boolean): Promise<void>
  setCompletionNote(habitId: string, date: string, note: string): Promise<void>
  listJournal(userId: string, opts?: { limit?: number; habitId?: string }): Promise<JournalEntry[]>
  createJournal(userId: string, input: CreateJournalEntryInput): Promise<JournalEntry>
  updateJournal(input: UpdateJournalEntryInput): Promise<JournalEntry>
  deleteJournal(id: string): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string | null): Promise<void>
  claim(fromUserId: string, toUserId: string): Promise<void>
  sync: SyncLocal
}
```
All `list*`/`get*` exclude rows with `deleted_at` set. Every mutation writes the row and an outbox entry in one transaction.

- [ ] **Step 1: Write failing tests**

`packages/local-db/src/__tests__/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { completionId, type SyncChange } from '@rock_ht/sync'
import { today } from '@rock_ht/utils'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()
const U = 'local-user'

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

describe('LocalStore', () => {
  let s: LocalStore
  beforeEach(async () => { s = await newStore() })

  it('creates and lists habits with parsed frequency', async () => {
    await s.createHabit(U, { title: 'Read', icon: '📚', color: '#6366f1', frequency: { type: 'daily' } })
    const list = await s.listHabits(U)
    expect(list).toHaveLength(1)
    expect(list[0]!.frequency).toEqual({ type: 'daily' })
  })

  it('writes an outbox entry per mutation', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.updateHabit({ id: h.id, title: 'B' })
    const out = await s.sync.readOutbox(10)
    expect(out.map((e) => e.change.row.title)).toEqual(['A', 'B'])
  })

  it('toggles completions with deterministic ids and tombstones', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    expect((await s.listCompletions(U))[0]!.id).toBe(completionId(h.id, '2026-01-05'))
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, false)
    expect(await s.listCompletions(U)).toHaveLength(0)
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    expect(await s.listCompletions(U)).toHaveLength(1)
  })

  it('soft-deletes habits', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.deleteHabit(h.id)
    expect(await s.listHabits(U, { includeArchived: true })).toHaveLength(0)
    const last = (await s.sync.readOutbox(10)).at(-1)!
    expect(last.change.row.deleted_at).not.toBeNull()
  })

  it('applyRemote writes rows without outbox entries and stores cursor', async () => {
    const change: SyncChange = {
      table: 'journal_entries',
      row: { id: 'j1', user_id: U, habit_id: null, entry_date: '2026-01-01', content: 'hi', mood: 3,
             created_at: now(), updated_at: now(), deleted_at: null },
    }
    await s.sync.applyRemote([change], '42')
    expect(await s.sync.readOutbox(10)).toHaveLength(0)
    expect(await s.sync.getCursor()).toBe('42')
    expect((await s.listJournal(U))[0]!.content).toBe('hi')
  })

  it('claim rewrites user ids and re-queues every row', async () => {
    await s.ensureProfile(U)
    await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const before = (await s.sync.readOutbox(100)).length
    await s.claim(U, 'account-1')
    expect(await s.listHabits('account-1')).toHaveLength(1)
    expect(await s.getProfile('account-1')).not.toBeNull()
    expect((await s.sync.readOutbox(100)).length).toBeGreaterThan(before)
  })

  it('dates journal entries with the local calendar date by default', async () => {
    const j = await s.createJournal(U, { content: 'hi' })
    expect(j.entry_date).toBe(today())
  })

  it('stores the device timezone on new profiles', async () => {
    const p = await s.ensureProfile(U)
    expect(p.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test --workspace=packages/local-db` → FAIL (`../store` missing).

- [ ] **Step 3: Implement `store.ts`**

Every helper that runs inside a transaction takes the transaction driver `db` as its first argument; the public methods pass `driver` (outside a transaction) or `tx` (inside one).

```ts
import { completionId, type OutboxEntry, type SyncChange, type SyncLocal, type SyncRow, type SyncTable } from '@rock_ht/sync'
import { parseFrequency, frequencyToJson, today } from '@rock_ht/utils'
import type {
  CompletionRow, CreateHabitInput, CreateJournalEntryInput, HabitRow, HabitWithFrequency, JournalEntry,
  ProfileRow, ToggleCompletionInput, UpdateHabitInput, UpdateJournalEntryInput, UpdateProfileInput,
} from '@rock_ht/types'
import { COLUMNS, fromSqlRow, toSqlRow } from './codec'
import type { SqlDriver, SqlParam } from './driver'

export interface LocalStoreDeps {
  driver: SqlDriver
  newId: () => string
  now: () => string
  /** IANA zone stored on new profiles. Defaults to the runtime's zone. */
  timeZone?: () => string
}

export type LocalStore = ReturnType<typeof createLocalStore>

const CURSOR_KEY = 'sync_cursor'

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function createLocalStore({ driver, newId, now, timeZone = deviceTimeZone }: LocalStoreDeps) {
  async function upsert(db: SqlDriver, table: SyncTable, row: SyncRow): Promise<void> {
    const sql = toSqlRow(table, row)
    const cols = Object.keys(COLUMNS[table])
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
    await db.run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${updates}`,
      cols.map((c) => sql[c] ?? null),
    )
  }

  async function enqueue(db: SqlDriver, table: SyncTable, row: SyncRow): Promise<void> {
    await db.run('INSERT INTO outbox (tbl, row_json) VALUES (?, ?)', [table, JSON.stringify(row)])
  }

  /** Local write: row + outbox snapshot in one transaction. */
  async function write(table: SyncTable, row: SyncRow): Promise<void> {
    await driver.transaction(async (tx) => {
      await upsert(tx, table, row)
      await enqueue(tx, table, row)
    })
  }

  async function getRow(table: SyncTable, id: string, db: SqlDriver = driver): Promise<SyncRow | null> {
    const raw = await db.first<Record<string, SqlParam>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
    return raw ? fromSqlRow(table, raw) : null
  }

  async function selectRows(table: SyncTable, where: string, params: SqlParam[], tail = ''): Promise<SyncRow[]> {
    const raws = await driver.all<Record<string, SqlParam>>(
      `SELECT * FROM ${table} WHERE deleted_at IS NULL AND ${where} ${tail}`, params,
    )
    return raws.map((r) => fromSqlRow(table, r))
  }

  const toHabit = (row: SyncRow): HabitWithFrequency =>
    ({ ...(row as unknown as HabitRow), frequency: parseFrequency((row as unknown as HabitRow).frequency) })

  async function getProfile(userId: string): Promise<ProfileRow | null> {
    const rows = await selectRows('profiles', 'id = ?', [userId])
    return (rows[0] as unknown as ProfileRow) ?? null
  }

  async function ensureProfile(userId: string): Promise<ProfileRow> {
    const existing = await getProfile(userId)
    if (existing) return existing
    const ts = now()
    const row: SyncRow = {
      id: userId, email: '', display_name: null, avatar_url: null, timezone: timeZone(), theme: 'dark',
      onboarding_completed: false, time_format: '12h', date_format: 'MM/DD/YYYY',
      created_at: ts, updated_at: ts, deleted_at: null,
    }
    // Not queued: the server creates profiles on signup; local edits later are queued.
    await upsert(driver, 'profiles', row)
    return row as unknown as ProfileRow
  }

  async function updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileRow> {
    const cur = await ensureProfile(userId)
    const row = { ...(cur as unknown as SyncRow), ...input, updated_at: now() } as SyncRow
    await write('profiles', row)
    return row as unknown as ProfileRow
  }

  async function listHabits(userId: string, opts: { includeArchived?: boolean } = {}) {
    const rows = await selectRows(
      'habits',
      opts.includeArchived ? 'user_id = ?' : 'user_id = ? AND is_archived = 0',
      [userId],
      'ORDER BY sort_order ASC, created_at ASC',
    )
    return rows.map(toHabit)
  }

  async function getHabit(id: string) {
    const rows = await selectRows('habits', 'id = ?', [id])
    return rows[0] ? toHabit(rows[0]) : null
  }

  async function createHabit(userId: string, input: CreateHabitInput) {
    const ts = now()
    const row: SyncRow = {
      id: newId(), user_id: userId, title: input.title, description: input.description ?? null,
      icon: input.icon, color: input.color, frequency: frequencyToJson(input.frequency),
      target_value: input.target_value ?? 1, target_unit: input.target_unit ?? null,
      reminder_time: input.reminder_time ?? null, reminder_enabled: input.reminder_enabled ?? false,
      is_archived: false, sort_order: 0, created_at: ts, updated_at: ts, deleted_at: null,
    }
    await write('habits', row)
    return toHabit(row)
  }

  async function updateHabit(input: UpdateHabitInput) {
    const cur = await getRow('habits', input.id)
    if (!cur || cur.deleted_at) throw new Error(`habit ${input.id} not found`)
    const { id: _id, frequency, ...rest } = input
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
    const row: SyncRow = {
      ...cur,
      ...defined,
      ...(frequency ? { frequency: frequencyToJson(frequency) } : {}),
      updated_at: now(),
    }
    await write('habits', row)
    return toHabit(row)
  }

  async function deleteHabit(id: string) {
    const cur = await getRow('habits', id)
    if (!cur) return
    const ts = now()
    await write('habits', { ...cur, deleted_at: ts, updated_at: ts })
  }

  async function listCompletions(
    userId: string,
    opts: { habitId?: string; startDate?: string; endDate?: string } = {},
  ): Promise<CompletionRow[]> {
    const where = ['user_id = ?']
    const params: SqlParam[] = [userId]
    if (opts.habitId) { where.push('habit_id = ?'); params.push(opts.habitId) }
    if (opts.startDate) { where.push('completed_date >= ?'); params.push(opts.startDate) }
    if (opts.endDate) { where.push('completed_date <= ?'); params.push(opts.endDate) }
    const rows = await selectRows('habit_completions', where.join(' AND '), params, 'ORDER BY completed_date DESC')
    return rows as unknown as CompletionRow[]
  }

  async function setCompletion(userId: string, input: ToggleCompletionInput, done: boolean) {
    const id = completionId(input.habit_id, input.date)
    const cur = await getRow('habit_completions', id)
    const ts = now()
    if (done) {
      await write('habit_completions', {
        id, habit_id: input.habit_id, user_id: userId, completed_date: input.date,
        value: input.value ?? 1, note: input.note ?? cur?.note ?? null,
        created_at: (cur?.created_at as string) ?? ts, updated_at: ts, deleted_at: null,
      })
    } else if (cur && !cur.deleted_at) {
      await write('habit_completions', { ...cur, deleted_at: ts, updated_at: ts })
    }
  }

  async function setCompletionNote(habitId: string, date: string, note: string) {
    const cur = await getRow('habit_completions', completionId(habitId, date))
    if (!cur || cur.deleted_at) return
    await write('habit_completions', { ...cur, note: note || null, updated_at: now() })
  }

  async function listJournal(userId: string, opts: { limit?: number; habitId?: string } = {}) {
    const where = opts.habitId ? 'user_id = ? AND habit_id = ?' : 'user_id = ?'
    const params: SqlParam[] = opts.habitId ? [userId, opts.habitId] : [userId]
    const rows = await selectRows('journal_entries', where, params,
      `ORDER BY entry_date DESC, created_at DESC LIMIT ${Math.floor(opts.limit ?? 50)}`)
    return rows as unknown as JournalEntry[]
  }

  async function createJournal(userId: string, input: CreateJournalEntryInput) {
    const ts = now()
    const row: SyncRow = {
      id: newId(), user_id: userId, habit_id: input.habit_id ?? null,
      // Local calendar date, never the UTC date from `ts` (see P0 fix c6c4195).
      entry_date: input.entry_date ?? today(), content: input.content, mood: input.mood ?? null,
      created_at: ts, updated_at: ts, deleted_at: null,
    }
    await write('journal_entries', row)
    return row as unknown as JournalEntry
  }

  async function updateJournal(input: UpdateJournalEntryInput) {
    const cur = await getRow('journal_entries', input.id)
    if (!cur || cur.deleted_at) throw new Error(`journal entry ${input.id} not found`)
    const row: SyncRow = {
      ...cur,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.mood !== undefined ? { mood: input.mood } : {}),
      updated_at: now(),
    }
    await write('journal_entries', row)
    return row as unknown as JournalEntry
  }

  async function deleteJournal(id: string) {
    const cur = await getRow('journal_entries', id)
    if (!cur) return
    const ts = now()
    await write('journal_entries', { ...cur, deleted_at: ts, updated_at: ts })
  }

  async function getMeta(key: string, db: SqlDriver = driver) {
    const r = await db.first<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', [key])
    return r?.value ?? null
  }

  async function setMeta(key: string, value: string | null, db: SqlDriver = driver) {
    await db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  }

  /** Move offline data to a signed-in account and queue all of it for upload. */
  async function claim(fromUserId: string, toUserId: string) {
    await driver.transaction(async (tx) => {
      for (const t of ['habits', 'habit_completions', 'journal_entries'] as const) {
        await tx.run(`UPDATE ${t} SET user_id = ?, updated_at = ? WHERE user_id = ?`, [toUserId, now(), fromUserId])
      }
      await tx.run('UPDATE profiles SET id = ?, updated_at = ? WHERE id = ?', [toUserId, now(), fromUserId])
      await tx.run('DELETE FROM outbox')
      await setMeta(CURSOR_KEY, null, tx)
      for (const t of ['profiles', 'habits', 'habit_completions', 'journal_entries'] as const) {
        const raws = await tx.all<Record<string, SqlParam>>(`SELECT * FROM ${t}`)
        for (const raw of raws) await enqueue(tx, t, fromSqlRow(t, raw))
      }
    })
  }

  const sync: SyncLocal = {
    async readOutbox(limit) {
      const rows = await driver.all<{ seq: number; tbl: SyncTable; row_json: string }>(
        'SELECT seq, tbl, row_json FROM outbox ORDER BY seq ASC LIMIT ?', [limit],
      )
      return rows.map((r): OutboxEntry => ({ seq: r.seq, change: { table: r.tbl, row: JSON.parse(r.row_json) } }))
    },
    async ackOutbox(uptoSeq) {
      await driver.run('DELETE FROM outbox WHERE seq <= ?', [uptoSeq])
    },
    getRow: (table, id) => getRow(table, id),
    getCursor: () => getMeta(CURSOR_KEY),
    async applyRemote(changes: SyncChange[], cursor) {
      await driver.transaction(async (tx) => {
        for (const c of changes) await upsert(tx, c.table, c.row)
        await setMeta(CURSOR_KEY, cursor, tx)
      })
    },
  }

  return {
    ensureProfile, getProfile, updateProfile,
    listHabits, getHabit, createHabit, updateHabit, deleteHabit,
    listCompletions, setCompletion, setCompletionNote,
    listJournal, createJournal, updateJournal, deleteJournal,
    getMeta: (key: string) => getMeta(key),
    setMeta: (key: string, value: string | null) => setMeta(key, value),
    claim, sync,
  }
}
```

Add `export * from './store'` to `src/index.ts`.

Note on `claim`: the profile is re-queued too, so the server needs the profile to exist before push. Both backends create it at signup (Supabase trigger `handle_new_user`; self-host in Task 12), and `sync_push_for` only updates profiles.

- [ ] **Step 4: Run, verify pass**

Run: `npm test --workspace=packages/local-db` → PASS (12 tests: 4 from Task 2, 8 store tests).
Run: `npx tsc --noEmit -p packages/local-db` → no errors.
Run the timezone matrix once: `for tz in UTC Pacific/Kiritimati Pacific/Pago_Pago America/New_York; do TZ=$tz npm test --workspace=packages/local-db || break; done` → PASS in all four.

- [ ] **Step 5: Commit**

```bash
git add packages/local-db
git commit -m "feat(local-db): add local store with outbox, tombstones and account claim"
```

### Task 4: expo-sqlite driver, LocalProvider, offline AuthProvider

**Files:**
- Create: `apps/mobile/lib/sqlite-driver.ts`, `apps/mobile/lib/local.ts`, `apps/mobile/providers/local-provider.tsx`, `apps/mobile/providers/auth-provider.tsx`
- Modify: `apps/mobile/providers/index.tsx`, `apps/mobile/providers/query-provider.tsx`, `apps/mobile/package.json`
- Delete: `apps/mobile/providers/supabase-provider.tsx` (in Task 6, once no screen imports it)

**Interfaces:**
- Consumes: `SqlDriver`, `migrate`, `createLocalStore`, `LocalStore`.
- Produces:
  - `createExpoSqliteDriver(name?: string): Promise<SqlDriver>`
  - `openLocalStore(): Promise<LocalStore>` (memoized)
  - `useLocal(): { store: LocalStore; userId: string; refreshUserId: () => Promise<void> }`; `LocalProvider` renders `null` while the DB opens (the splash screen stays up). If opening or migrating fails, it hides the splash screen, reports the error with `Sentry.captureException` and renders an error screen with a "Try again" button instead of staying blank forever.
  - `useAuth(): { user: { id: string; email: string | null; created_at: string } ; loading: boolean; signOut: () => Promise<void> }` with the same call sites as today. `user` is always non-null (the local user when offline).
  - meta keys: `local_user_id`, `account_user_id`

- [ ] **Step 1: Add native deps**

Run in `apps/mobile`: `npx expo install expo-sqlite expo-crypto`
Expected in `apps/mobile/package.json`: `"expo-sqlite": "~55.0.16"`, `"expo-crypto": "~55.0.15"` (the versions `expo@55` pins in `bundledNativeModules.json`).
Add to `apps/mobile/package.json` dependencies: `"@rock_ht/local-db": "*"`, `"@rock_ht/sync": "*"`. Run `npm install` at root.
Do **not** add `expo-sqlite` to `app.json` `plugins`: `apps/mobile/android/` is committed and config plugins only run on `expo prebuild`, which would overwrite it. Autolinking picks the new native modules up on the next Gradle build.

- [ ] **Step 2: Driver**

`apps/mobile/lib/sqlite-driver.ts`:
```ts
import * as SQLite from "expo-sqlite";
import type { SqlDriver, SqlParam } from "@rock_ht/local-db";

/**
 * `inTx`: `db` is the connection of a running exclusive transaction; nested
 * `transaction()` calls then run flat on it.
 */
function wrap(db: SQLite.SQLiteDatabase, inTx: boolean): SqlDriver {
  const driver: SqlDriver = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParam[] = []) => { await db.runAsync(sql, params); },
    all: <T,>(sql: string, params: SqlParam[] = []) => db.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlParam[] = []) => db.getFirstAsync<T>(sql, params),
    // Exclusive: a background sync applyRemote can't interleave with a user write,
    // which withTransactionAsync (shared connection) would allow.
    transaction: (fn) =>
      inTx ? fn(driver) : db.withExclusiveTransactionAsync((txn) => fn(wrap(txn, true))),
  };
  return driver;
}

export async function createExpoSqliteDriver(name = "rock_ht.db"): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  return wrap(db, false);
}
```

- [ ] **Step 3: Store singleton**

`apps/mobile/lib/local.ts`:
```ts
import * as Crypto from "expo-crypto";
import { createLocalStore, migrate, type LocalStore } from "@rock_ht/local-db";
import { createExpoSqliteDriver } from "./sqlite-driver";

let pending: Promise<LocalStore> | null = null;

/** Forget a failed open so the next openLocalStore() retries. */
export function resetLocalStore(): void {
  pending = null;
}

export function openLocalStore(): Promise<LocalStore> {
  pending ??= (async () => {
    const driver = await createExpoSqliteDriver();
    await migrate(driver);
    return createLocalStore({
      driver,
      newId: () => Crypto.randomUUID(),
      now: () => new Date().toISOString(),
    });
  })();
  return pending;
}

/** The id rows are written under: the signed-in account if any, else a stable device id. */
export async function resolveUserId(store: LocalStore): Promise<string> {
  const account = await store.getMeta("account_user_id");
  if (account) return account;
  let local = await store.getMeta("local_user_id");
  if (!local) {
    local = Crypto.randomUUID();
    await store.setMeta("local_user_id", local);
  }
  return local;
}
```

- [ ] **Step 4: Providers**

`apps/mobile/providers/local-provider.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import * as SplashScreen from "expo-splash-screen";
import type { LocalStore } from "@rock_ht/local-db";
import { openLocalStore, resetLocalStore, resolveUserId } from "@/lib/local";

type LocalContext = { store: LocalStore; userId: string; refreshUserId: () => Promise<void> };

const Context = createContext<LocalContext | undefined>(undefined);

export function LocalProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<{ store: LocalStore; userId: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const store = await openLocalStore();
      const userId = await resolveUserId(store);
      await store.ensureProfile(userId);
      setError(null);
      setValue({ store, userId });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      Sentry.captureException(err);
      resetLocalStore();
      setError(err);
      await SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#f4f4f8" }}>Couldn't open your data</Text>
        <Text style={{ fontSize: 13, color: "#6b7280", textAlign: "center" }}>{error.message}</Text>
        <TouchableOpacity
          onPress={() => void load()}
          style={{ marginTop: 8, backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!value) return null;
  return <Context.Provider value={{ ...value, refreshUserId: load }}>{children}</Context.Provider>;
}

export function useLocal() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useLocal must be used within LocalProvider");
  return ctx;
}
```

`apps/mobile/providers/auth-provider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocal } from "./local-provider";

type AuthUser = { id: string; email: string | null; created_at: string };
type AuthContext = { user: AuthUser; loading: boolean; signOut: () => Promise<void> };

const Context = createContext<AuthContext | undefined>(undefined);

/** Offline-first: there is always a user. Signing out of a sync backend is handled in Task 11. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { store, userId } = useLocal();
  const [user, setUser] = useState<AuthUser>({ id: userId, email: null, created_at: new Date().toISOString() });

  useEffect(() => {
    void store.getProfile(userId).then((p) =>
      setUser({ id: userId, email: p?.email || null, created_at: p?.created_at ?? new Date().toISOString() }),
    );
  }, [store, userId]);

  return (
    <Context.Provider value={{ user, loading: false, signOut: async () => {} }}>
      {children}
    </Context.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

`apps/mobile/providers/index.tsx`:
```tsx
import type { ReactNode } from "react";
import { LocalProvider } from "./local-provider";
import { AuthProvider } from "./auth-provider";
import { QueryProvider } from "./query-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocalProvider>
      <AuthProvider>
        <QueryProvider>{children}</QueryProvider>
      </AuthProvider>
    </LocalProvider>
  );
}
```

- [ ] **Step 5: Local reads never wait for the network**

`apps/mobile/providers/query-provider.tsx`: every query and mutation now hits the local store, so none may pause when TanStack Query thinks the device is offline (its default `networkMode: 'online'` would, as soon as anyone wires `onlineManager` to NetInfo). Replace the `defaultOptions`:
```tsx
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            retry: 1,
            networkMode: "always",
          },
          mutations: {
            networkMode: "always",
          },
        },
```

- [ ] **Step 6: Type-check**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile`. Expected: errors only in files still importing `@/providers/supabase-provider` (fixed in Tasks 5–6). No errors in the new files.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile package-lock.json
git commit -m "feat(mobile): open local SQLite store and provide offline user"
```

### Task 5: Hooks on the local store (habits, completions, journal, streaks, profile)

**Files:**
- Modify: `apps/mobile/hooks/use-habits.ts`, `use-completions.ts`, `use-journal.ts`
- Create: `apps/mobile/hooks/use-streaks.ts`, `apps/mobile/hooks/use-profile.ts`
- Delete: `apps/mobile/lib/offline-queue.ts`

**Interfaces:**
- Consumes: `useLocal()`, `LocalStore` methods, `calculateStreak` from `@rock_ht/utils`.
- Produces (return shapes of existing hooks unchanged):
  - `useHabits()` → `{ habits, isLoading, error, createHabit, updateHabit, archiveHabit, deleteHabit, isCreating }`
  - `useCompletions()` → same as today minus `flushQueue`. Query keys carry the local date: `todayKey(date) = ["completions", "today", date]`, `monthKey(date) = ["completions", "month", date]` (replacing the date-less `TODAY_KEY`/`MONTH_KEY`, so an app left open past midnight fetches the new day instead of showing yesterday's cache). `invalidateQueries({ queryKey: ["completions"] })` still matches both by prefix.
  - `useJournal()` → same as today
  - `useStreaks(): { streaks: StreakRow[] }`, key `["streaks"]`
  - `useHabitCompletions(habitId: string)`, key `["completions","habit",habitId]`
  - `useProfile(): { profile: ProfileRow | null; updateProfile(input: UpdateProfileInput): Promise<ProfileRow> }`, key `["profile"]`

- [ ] **Step 1: `use-habits.ts`**: replace data calls only; keep `syncReminder` and the query keys.

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
// …reminder imports and syncReminder() unchanged…

export function useHabits() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => store.listHabits(userId),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateHabitInput) => store.createHabit(userId, input),
    onSuccess: async (habit) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) => (old ? [...old, habit] : [habit]));
      await syncReminder(habit);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateHabitInput) => store.updateHabit(input),
    onSuccess: async (habit) => { await syncReminder(habit); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: HABITS_KEY }); },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => store.updateHabit({ id, is_archived: true }),
    onSuccess: async (_d, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) => old?.filter((h) => h.id !== id));
      await cancelHabitReminder(id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => store.deleteHabit(id),
    onSuccess: async (_d, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) => old?.filter((h) => h.id !== id));
      await cancelHabitReminder(id);
    },
  });

  return {
    habits: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createHabit: createMutation.mutateAsync,
    updateHabit: updateMutation.mutateAsync,
    archiveHabit: archiveMutation.mutate,
    deleteHabit: deleteMutation.mutate,
    isCreating: createMutation.isPending,
  };
}
```

- [ ] **Step 2: `use-completions.ts`**: drop NetInfo, offline queue and `flushQueue`; writes are local.

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
import { subtractDays, today, yesterday } from "@rock_ht/utils";
import type { ToggleCompletionInput } from "@rock_ht/types";

/** Keys include the local date: a new day is a new cache entry. */
export const todayKey = (date: string) => ["completions", "today", date] as const;
export const monthKey = (date: string) => ["completions", "month", date] as const;

export function useCompletions() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();
  // Local calendar dates (P0 fix c6c4195); never toISOString().slice(0, 10).
  const todayStr = today();
  const yesterdayStr = yesterday();

  const todayQuery = useQuery({
    queryKey: todayKey(todayStr),
    queryFn: () => store.listCompletions(userId, { startDate: todayStr, endDate: todayStr }),
  });
  const monthQuery = useQuery({
    queryKey: monthKey(todayStr),
    queryFn: () => store.listCompletions(userId, { startDate: subtractDays(todayStr, 29), endDate: todayStr }),
  });

  const completedTodayIds = new Set((todayQuery.data ?? []).map((c) => c.habit_id));
  const completedYesterdayIds = new Set(
    (monthQuery.data ?? []).filter((c) => c.completed_date === yesterdayStr).map((c) => c.habit_id),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["completions"] });
    queryClient.invalidateQueries({ queryKey: ["streaks"] });
  };

  const toggleMutation = useMutation({
    mutationFn: (input: ToggleCompletionInput) =>
      store.setCompletion(userId, input, !completedTodayIds.has(input.habit_id)),
    onSettled: invalidate,
  });

  const logYesterdayMutation = useMutation({
    mutationFn: (habitId: string) => store.setCompletion(userId, { habit_id: habitId, date: yesterdayStr }, true),
    onSettled: invalidate,
  });

  return {
    todayCompletions: todayQuery.data ?? [],
    monthCompletions: monthQuery.data ?? [],
    completedTodayIds,
    completedYesterdayIds,
    isLoading: todayQuery.isLoading,
    toggleCompletion: toggleMutation.mutate,
    logYesterday: logYesterdayMutation.mutate,
    isLoggingYesterday: logYesterdayMutation.isPending,
  };
}
```
Local SQLite writes take about 1 ms, so the old optimistic `onMutate` is no longer needed. `flushQueue` has no callers outside the hook; confirm with `grep -rn "flushQueue\|TODAY_KEY\|MONTH_KEY" apps/mobile/app apps/mobile/hooks apps/mobile/components apps/mobile/lib` → no output after this step.

Every render re-reads `today()`, so a new day switches keys as soon as the screen renders again. React Native has no window-focus refetch, so an app resumed from the background after midnight would not re-render on its own; add to `useCompletions`:
```ts
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") queryClient.invalidateQueries({ queryKey: ["completions"] });
    });
    return () => sub.remove();
  }, [queryClient]);
```
(imports: `useEffect` from `react`, `AppState` from `react-native`).

- [ ] **Step 3: `use-journal.ts`**: same pattern: `getJournalEntries(supabase, user!.id)` → `store.listJournal(userId)`, `createJournalEntry(supabase, user!.id, input)` → `store.createJournal(userId, input)`, `updateJournalEntry(supabase, input)` → `store.updateJournal(input)`, `deleteJournalEntry(supabase, id)` → `store.deleteJournal(id)`. Keep `JOURNAL_KEY` and return shape.

- [ ] **Step 4: `use-streaks.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { calculateStreak, parseFrequency } from "@rock_ht/utils";
import type { StreakRow } from "@rock_ht/types";
import { useLocal } from "@/providers/local-provider";

export const STREAKS_KEY = ["streaks"] as const;

/** Streaks are derived locally from completions; the server cache table is not synced. */
export function useStreaks() {
  const { store, userId } = useLocal();
  const query = useQuery({
    queryKey: STREAKS_KEY,
    queryFn: async (): Promise<StreakRow[]> => {
      const [habits, completions] = await Promise.all([
        store.listHabits(userId, { includeArchived: true }),
        store.listCompletions(userId),
      ]);
      const byHabit = new Map<string, string[]>();
      for (const c of completions) {
        const list = byHabit.get(c.habit_id) ?? [];
        list.push(c.completed_date);
        byHabit.set(c.habit_id, list);
      }
      return habits.map((h) => {
        const r = calculateStreak(byHabit.get(h.id) ?? [], parseFrequency(h.frequency));
        return {
          habit_id: h.id,
          user_id: userId,
          current_streak: r.current_streak,
          longest_streak: r.longest_streak,
          last_completed_date: r.last_completed_date,
          updated_at: h.updated_at,
        };
      });
    },
  });
  return { streaks: query.data ?? [] };
}

export function useHabitCompletions(habitId: string) {
  const { store, userId } = useLocal();
  return useQuery({
    queryKey: ["completions", "habit", habitId],
    queryFn: () => store.listCompletions(userId, { habitId }),
  });
}
```
`parseFrequency(raw: unknown)` (`packages/utils/src/habits.ts:6`) accepts an already-parsed `Frequency`, so passing `h.frequency` through it is safe.

- [ ] **Step 5: `use-profile.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateProfileInput } from "@rock_ht/types";
import { useLocal } from "@/providers/local-provider";

export const PROFILE_KEY = ["profile"] as const;

export function useProfile() {
  const { store, userId } = useLocal();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: () => store.getProfile(userId) });
  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => store.updateProfile(userId, input),
    onSuccess: (p) => qc.setQueryData(PROFILE_KEY, p),
  });
  return { profile: query.data ?? null, isLoading: query.isLoading, updateProfile: mutation.mutateAsync };
}
```

- [ ] **Step 6: Commit**

```bash
git rm apps/mobile/lib/offline-queue.ts
git add apps/mobile/hooks
git commit -m "feat(mobile): read and write habits, completions and journal from local store"
```

### Task 6: Screens off Supabase; no login required

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/habits.tsx`, `app/(tabs)/analytics.tsx`, `app/habit/[id].tsx`, `app/onboarding.tsx`, `app/(tabs)/settings.tsx`
- Delete: `apps/mobile/lib/supabase.ts`, `apps/mobile/providers/supabase-provider.tsx`, `apps/mobile/hooks/use-realtime.ts`
- Move: `apps/mobile/app/(auth)/*`: reused by Task 11, rewritten there. In this task, delete the `(auth)` group (git history keeps the UI for reuse).

**Interfaces:**
- Consumes: `useStreaks`, `useHabitCompletions`, `useProfile`, `useAuth` (new provider).

- [ ] **Step 1: Replace every `@/providers/supabase-provider` import with `@/providers/auth-provider`**

Run: `grep -rl "providers/supabase-provider" apps/mobile | xargs sed -i 's#@/providers/supabase-provider#@/providers/auth-provider#'`

- [ ] **Step 2: Streak queries → `useStreaks()`**

In `app/(tabs)/index.tsx`, `app/(tabs)/habits.tsx` and `app/(tabs)/analytics.tsx`, delete the `getStreaks`/`supabase` imports and replace the block
```ts
const { data: streaks } = useQuery({
  queryKey: ["streaks"],
  queryFn: () => getStreaks(supabase, user!.id),
  …
});
```
with
```ts
const { streaks } = useStreaks();
```
(import from `@/hooks/use-streaks`). Where the old code used `streaks ?? []`, the new value is already an array.

In the same two tab screens, delete the realtime hook: remove `import { useRealtimeSync } from "@/hooks/use-realtime";` and the `useRealtimeSync();` call (`app/(tabs)/index.tsx:16,48`, `app/(tabs)/habits.tsx:16,32`). Local writes invalidate queries directly; sync-driven refresh comes back in Task 11.

- [ ] **Step 3: `app/habit/[id].tsx`**

Replace the `getCompletions` query with `const { data: completions = [], isLoading: completionsLoading } = useHabitCompletions(id);` and the streak query with `const { streaks } = useStreaks();`. Remove the `getCompletions`/`getStreaks` imports from `@rock_ht/db` and the `supabase` import (these are the only data calls in the file).

- [ ] **Step 4: `app/onboarding.tsx`**

Replace `updateProfile(supabase as any, user.id, {...})` with `await updateProfile({...})` from `useProfile()`.

- [ ] **Step 5: `app/_layout.tsx` AuthGuard → OnboardingGuard**

Remove the NetInfo queue-flush effect, and the `supabase`, `@rock_ht/db` and offline-queue imports. Replace the guard body:
```tsx
function OnboardingGuard() {
  const { profile, isLoading } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inOnboarding = segments[0] === "onboarding";
    if (profile && !profile.onboarding_completed && !inOnboarding) router.replace("/onboarding");
    SplashScreen.hideAsync();
  }, [profile, isLoading, segments]);

  return <Slot />;
}
```
and render `<OnboardingGuard />` in `RootLayout`.

- [ ] **Step 6: Settings**

In `app/(tabs)/settings.tsx`, keep the `useAuth()` usage. With no sync account `user.email` is null:
- In the Account card, show `user.email ?? "Local profile"` as the title and "Stored on this device" as the subtitle when `user.email` is null (keep "Member since …" otherwise).
- Render the sign-out button at the bottom only when `user.email` is non-null: wrap it in `{user.email ? ( … ) : null}`.
Task 8 adds a "Data" section and Task 11 a "Sync" row here.

- [ ] **Step 7: Delete Supabase-only files and verify nothing references them**

```bash
git rm apps/mobile/lib/supabase.ts apps/mobile/providers/supabase-provider.tsx apps/mobile/hooks/use-realtime.ts
git rm -r "apps/mobile/app/(auth)"
grep -rn "supabase\|@rock_ht/db\|offline-queue\|use-realtime" apps/mobile --include=*.ts --include=*.tsx -l | grep -v node_modules
```
Expected: no output.

- [ ] **Step 8: Verify**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile` → 0 errors (typegen first: this task deletes the `(auth)` routes, so a stale `.expo/types/router.d.ts` would report false errors or hide real ones).
Run: `npm run lint` → 0 errors.
Run: `scripts/build-apk.sh --install <serial> --allow-dummy-env` (the flag is still required until Task 9; the dummy values are no longer read by any code). Then, on the device in airplane mode:
1. The app opens straight to onboarding. Complete it.
2. Create 2 habits and toggle one. The progress ring updates.
3. Force-quit and reopen: data persists and the streak shows 1.
4. Add a journal entry, then delete it. It disappears.
The full offline checklist runs in Task 9.

- [ ] **Step 9: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): run fully offline on local store, drop Supabase client and login gate"
```

### Task 7: Reminders rebuilt from the local DB, scheduled per habit frequency

Today a reminder is a DAILY trigger created only when a habit is saved (`hooks/use-habits.ts` `syncReminder`). So `specific_days` habits fire on off days, and habits that arrive any other way (backup import in Task 8, sync pull or `claim()` in Task 11, an Android Auto Backup restore) never get reminders. This task makes the local DB the source of truth: triggers follow the frequency, and all reminders are rebuilt at launch and after every bulk change.

**Files:**
- Create: `packages/utils/src/reminders.ts`, test `packages/utils/src/__tests__/reminders.test.ts`
- Modify: `packages/utils/src/index.ts`, `apps/mobile/lib/notifications.ts`, `apps/mobile/hooks/use-habits.ts`, `apps/mobile/hooks/use-notifications.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/settings.tsx`
- Create: `apps/mobile/hooks/use-reminders.ts`

**Interfaces:**
- Consumes: `Frequency`, `HabitWithFrequency` from `@rock_ht/types`; `LocalStore`, `useLocal()` from Task 4.
- Produces:
  - `type ReminderTrigger = { kind: "daily"; hour: number; minute: number } | { kind: "weekly"; weekday: number; hour: number; minute: number }` (`weekday` 1 = Sunday … 7 = Saturday, the expo-notifications WEEKLY convention)
  - `parseReminderTime(time: string): { hour: number; minute: number } | null` (accepts `HH:MM` and `HH:MM:SS`)
  - `reminderTriggers(frequency: Frequency, time: string): ReminderTrigger[]`
  - `type ReminderHabit = Pick<HabitWithFrequency, "id" | "title" | "icon" | "frequency" | "reminder_time" | "reminder_enabled" | "is_archived">`
  - `scheduleHabitReminder(habit: ReminderHabit): Promise<string[]>` (replaces all reminders of that habit; returns notification ids; signature changes from `(habitId, title, icon, time)`)
  - `rebuildReminders(habits: ReminderHabit[]): Promise<number>` (no-op returning 0 without notification permission)
  - `rebuildRemindersFromStore(store: LocalStore, userId: string): Promise<number>`
  - `useRebuildRemindersOnLaunch(): void`

- [ ] **Step 1: Write failing tests**

`packages/utils/src/__tests__/reminders.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseReminderTime, reminderTriggers } from '../reminders'

describe('parseReminderTime', () => {
  it('parses HH:MM and Postgres HH:MM:SS', () => {
    expect(parseReminderTime('07:30')).toEqual({ hour: 7, minute: 30 })
    expect(parseReminderTime('21:05:00')).toEqual({ hour: 21, minute: 5 })
  })
  it('rejects malformed or out-of-range times', () => {
    expect(parseReminderTime('25:00')).toBeNull()
    expect(parseReminderTime('07:60')).toBeNull()
    expect(parseReminderTime('soon')).toBeNull()
  })
})

describe('reminderTriggers', () => {
  it('schedules daily habits once a day', () => {
    expect(reminderTriggers({ type: 'daily' }, '08:00')).toEqual([{ kind: 'daily', hour: 8, minute: 0 }])
  })
  it('maps specific days (0=Sun..6=Sat) to weekly triggers (1=Sun..7=Sat)', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [6, 0, 3] }, '09:15')).toEqual([
      { kind: 'weekly', weekday: 1, hour: 9, minute: 15 },
      { kind: 'weekly', weekday: 4, hour: 9, minute: 15 },
      { kind: 'weekly', weekday: 7, hour: 9, minute: 15 },
    ])
  })
  it('drops duplicate and invalid days', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [1, 1, 9, -1] }, '09:00')).toEqual([
      { kind: 'weekly', weekday: 2, hour: 9, minute: 0 },
    ])
  })
  it('returns nothing for a specific-days habit without days', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [] }, '09:00')).toEqual([])
  })
  it('reminds times-per-week habits daily (they have no fixed days)', () => {
    expect(reminderTriggers({ type: 'times_per_week', count: 3 }, '18:00')).toEqual([{ kind: 'daily', hour: 18, minute: 0 }])
  })
  it('returns nothing for an invalid time', () => {
    expect(reminderTriggers({ type: 'daily' }, 'later')).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test --workspace=packages/utils`
Expected: FAIL, `Failed to resolve import "../reminders"`.

- [ ] **Step 3: Implement**

`packages/utils/src/reminders.ts`:
```ts
import type { Frequency } from "@rock_ht/types";

/** Plain trigger description; mapped to expo-notifications inputs on device. */
export type ReminderTrigger =
  | { kind: "daily"; hour: number; minute: number }
  /** weekday: 1 = Sunday … 7 = Saturday (expo-notifications WEEKLY convention) */
  | { kind: "weekly"; weekday: number; hour: number; minute: number };

export function parseReminderTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function reminderTriggers(frequency: Frequency, time: string): ReminderTrigger[] {
  const t = parseReminderTime(time);
  if (!t) return [];
  switch (frequency.type) {
    case "specific_days":
      return [...new Set(frequency.days)]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => ({ kind: "weekly" as const, weekday: d + 1, ...t }));
    case "daily":
    case "times_per_week":
      // times_per_week has no fixed days: remind daily.
      return [{ kind: "daily", ...t }];
  }
}
```

Add `export * from "./reminders";` to `packages/utils/src/index.ts`.

- [ ] **Step 4: Run, verify pass in every CI timezone**

```bash
for tz in UTC Pacific/Kiritimati Pacific/Pago_Pago America/New_York; do
  TZ=$tz npm test --workspace=packages/utils || { echo "FAILED in $tz"; break; }
done
```
Expected: PASS everywhere (the new tests are timezone-independent; the existing ones must stay green).

- [ ] **Step 5: Schedule by frequency on device**

In `apps/mobile/lib/notifications.ts`, replace `scheduleHabitReminder` and add `rebuildReminders` (the rest of the file stays):
```ts
import { reminderTriggers, type ReminderTrigger } from "@rock_ht/utils";
import type { HabitWithFrequency } from "@rock_ht/types";

export type ReminderHabit = Pick<
  HabitWithFrequency,
  "id" | "title" | "icon" | "frequency" | "reminder_time" | "reminder_enabled" | "is_archived"
>;

function toExpoTrigger(t: ReminderTrigger): Notifications.SchedulableNotificationTriggerInput {
  return t.kind === "daily"
    ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute }
    : { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: t.weekday, hour: t.hour, minute: t.minute };
}

/** Replaces all reminders of one habit. Returns the scheduled notification ids. */
export async function scheduleHabitReminder(habit: ReminderHabit): Promise<string[]> {
  await cancelHabitReminder(habit.id);
  if (!habit.reminder_enabled || !habit.reminder_time || habit.is_archived) return [];
  const ids: string[] = [];
  for (const trigger of reminderTriggers(habit.frequency, habit.reminder_time)) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${habit.icon} ${habit.title}`,
          body: "Time for your habit! Keep the streak going.",
          data: { habitId: habit.id },
          sound: true,
        },
        trigger: toExpoTrigger(trigger),
      }),
    );
  }
  return ids;
}

/**
 * The local DB is the source of truth: cancel every habit reminder, then
 * schedule from `habits`. The daily digest (data.type) is left alone.
 */
export async function rebuildReminders(habits: ReminderHabit[]): Promise<number> {
  if ((await getNotificationPermissionStatus()) !== "granted") return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => typeof n.content.data?.["habitId"] === "string")
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  let count = 0;
  for (const habit of habits) count += (await scheduleHabitReminder(habit)).length;
  return count;
}
```

`apps/mobile/hooks/use-reminders.ts`:
```ts
import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import type { LocalStore } from "@rock_ht/local-db";
import { rebuildReminders } from "@/lib/notifications";
import { useLocal } from "@/providers/local-provider";

export async function rebuildRemindersFromStore(store: LocalStore, userId: string): Promise<number> {
  return rebuildReminders(await store.listHabits(userId));
}

/** Mount once: restores reminders after reinstall, restore, or an OS that dropped them. */
export function useRebuildRemindersOnLaunch(): void {
  const { store, userId } = useLocal();
  useEffect(() => {
    rebuildRemindersFromStore(store, userId).catch((e) => Sentry.captureException(e));
  }, [store, userId]);
}
```

- [ ] **Step 6: Callers**

`apps/mobile/hooks/use-habits.ts`, replace `syncReminder`:
```ts
async function syncReminder(habit: HabitWithFrequency): Promise<void> {
  if ((await getNotificationPermissionStatus()) === "granted") await scheduleHabitReminder(habit);
  else await cancelHabitReminder(habit.id);
}
```

`apps/mobile/hooks/use-notifications.ts`, replace `enableHabitReminder`:
```ts
  async function enableHabitReminder(habit: HabitWithFrequency): Promise<void> {
    await scheduleHabitReminder(habit);
  }
```

`apps/mobile/app/_layout.tsx`: call `useRebuildRemindersOnLaunch();` at the top of `OnboardingGuard` (import from `@/hooks/use-reminders`).

`apps/mobile/app/(tabs)/settings.tsx`: habits created before permission was granted have no reminders, so rebuild right after the grant. In `handleNotificationsToggle`, after `setNotifEnabled(true);` add `await rebuildRemindersFromStore(store, userId);`, with `const { store, userId } = useLocal();` at the top of the component (imports from `@/providers/local-provider` and `@/hooks/use-reminders`).

Run: `grep -rn "scheduleHabitReminder(" apps/mobile --include=*.ts --include=*.tsx | grep -v node_modules`. Expected: only the calls above, each passing a habit object.

- [ ] **Step 7: Verify**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile` → 0 errors.
Run: `scripts/build-apk.sh --install <serial> --allow-dummy-env`, then on the device (notifications allowed):
1. Create a daily habit with a reminder 2 minutes from now. The notification arrives on time.
2. Create a `specific_days` habit for a weekday other than today with a reminder 2 minutes from now. No notification arrives.
3. `adb -s <serial> shell dumpsys alarm | grep -c app.rockht.mobile` → a non-zero count; force-stop and relaunch the app → the count is unchanged (rebuild replaced, not duplicated, the reminders).

- [ ] **Step 8: Commit**

```bash
git add packages/utils apps/mobile
git commit -m "feat(mobile): schedule reminders per habit frequency and rebuild them from the local DB"
```

### Task 8: JSON export and import

Offline-only users have their data on one device only. Android Auto Backup (`allowBackup="true"`) is untested and opaque, so give users an explicit, versioned JSON export they can save anywhere, and an import that merges it back in one transaction.

**Files:**
- Create: `packages/local-db/src/backup.ts`, test `packages/local-db/src/__tests__/backup.test.ts`
- Modify: `packages/local-db/src/store.ts`, `packages/local-db/src/index.ts`
- Create: `apps/mobile/lib/backup.ts`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`, `apps/mobile/package.json`

**Interfaces:**
- Consumes: `SYNC_TABLES`, `SyncRow`, `SyncTable`, `isNewer` (Task 1); store internals `upsert`, `enqueue`, `getRow`, `selectRows` (Task 3); `rebuildRemindersFromStore` (Task 7).
- Produces:
  - `BACKUP_FORMAT = "rock_ht-backup"`, `BACKUP_VERSION = 1`
  - `interface Backup { format: "rock_ht-backup"; version: 1; exported_at: string; tables: Record<SyncTable, SyncRow[]> }`
  - `class BackupError extends Error`
  - `parseBackup(json: string): Backup` (throws `BackupError`)
  - `LocalStore.exportBackup(userId: string): Promise<Backup>` (live rows only, no tombstones)
  - `LocalStore.importBackup(userId: string, backup: Backup): Promise<{ imported: number; skipped: number }>`
  - mobile: `exportToShareSheet(store: LocalStore, userId: string): Promise<void>`, `importFromPicker(store: LocalStore, userId: string): Promise<{ imported: number; skipped: number } | null>` (`null` = picker cancelled)

Import rules: rows are rewritten to the current user (`user_id`, or `id` for the profile). A backup row is skipped when a **live** local row with the same id is at least as new (`!isNewer`); it replaces a missing or tombstoned row (a restore brings deleted items back). Every imported row gets `updated_at = now()` and an outbox entry, so a later sync propagates the restore. The profile's settings are always taken from the backup, keeping the local profile's `id` and `created_at`. Everything runs in one transaction: an invalid row rolls the whole import back.

- [ ] **Step 1: Write failing tests**

`packages/local-db/src/__tests__/backup.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import { BackupError, parseBackup } from '../backup'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

async function seeded(user: string) {
  const s = await newStore()
  await s.ensureProfile(user)
  await s.updateProfile(user, { display_name: 'Ada' })
  const h = await s.createHabit(user, { title: 'Read', icon: '📚', color: '#6366f1', frequency: { type: 'daily' } })
  await s.setCompletion(user, { habit_id: h.id, date: '2026-01-02' }, true)
  await s.createJournal(user, { content: 'day one', entry_date: '2026-01-02' })
  return { s, h }
}

describe('backup', () => {
  it('round-trips into another store under the importing user', async () => {
    const { s: a } = await seeded('user-a')
    const json = JSON.stringify(await a.exportBackup('user-a'))
    const b = await newStore()
    await b.ensureProfile('user-b')
    const res = await b.importBackup('user-b', parseBackup(json))
    expect(res).toEqual({ imported: 4, skipped: 0 })
    expect((await b.listHabits('user-b'))[0]!.title).toBe('Read')
    expect(await b.listCompletions('user-b')).toHaveLength(1)
    expect((await b.listJournal('user-b'))[0]!.content).toBe('day one')
    expect((await b.getProfile('user-b'))!.display_name).toBe('Ada')
    expect((await b.sync.readOutbox(100)).length).toBe(4)
  })

  it('keeps newer live local rows', async () => {
    const { s, h } = await seeded('u')
    const backup = await s.exportBackup('u')
    await s.updateHabit({ id: h.id, title: 'Read more' })
    const res = await s.importBackup('u', backup)
    expect(res.skipped).toBeGreaterThanOrEqual(1)
    expect((await s.getHabit(h.id))!.title).toBe('Read more')
  })

  it('restores rows deleted after the export', async () => {
    const { s, h } = await seeded('u')
    const backup = await s.exportBackup('u')
    await s.deleteHabit(h.id)
    await s.importBackup('u', backup)
    expect((await s.getHabit(h.id))!.title).toBe('Read')
  })

  it('does not export tombstones', async () => {
    const { s, h } = await seeded('u')
    await s.deleteHabit(h.id)
    expect((await s.exportBackup('u')).tables.habits).toEqual([])
  })

  it('rolls the whole import back when a row is invalid', async () => {
    const { s: a } = await seeded('u')
    const backup = await a.exportBackup('u')
    backup.tables.journal_entries.push({ ...backup.tables.journal_entries[0]!, id: randomUUID(), content: null })
    const b = await newStore()
    await expect(b.importBackup('u', backup)).rejects.toThrow()
    expect(await b.listHabits('u')).toEqual([])
  })

  it('rejects files that are not rock backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ format: 'other' }))).toThrow('Not a rock backup file')
    expect(() => parseBackup(JSON.stringify({ format: 'rock_ht-backup', version: 2, tables: {} })))
      .toThrow('Unsupported backup version 2')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test --workspace=packages/local-db` → FAIL (`../backup` missing).

- [ ] **Step 3: Implement**

`packages/local-db/src/backup.ts`:
```ts
import { SYNC_TABLES, type SyncRow, type SyncTable } from '@rock_ht/sync'

export const BACKUP_FORMAT = 'rock_ht-backup'
export const BACKUP_VERSION = 1

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exported_at: string
  tables: Record<SyncTable, SyncRow[]>
}

export class BackupError extends Error {}

/** Validates the envelope. Row contents are checked by the table constraints during import. */
export function parseBackup(json: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new BackupError('Not a JSON file')
  }
  const b = data as Partial<Backup> | null
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) throw new BackupError('Not a rock backup file')
  if (b.version !== BACKUP_VERSION) throw new BackupError(`Unsupported backup version ${String(b.version)}`)
  for (const t of SYNC_TABLES) {
    const rows: unknown = b.tables?.[t]
    const valid = Array.isArray(rows) && rows.every((r) =>
      r !== null && typeof r === 'object' &&
      typeof (r as SyncRow).id === 'string' && typeof (r as SyncRow).updated_at === 'string')
    if (!valid) throw new BackupError(`Invalid "${t}" section`)
  }
  return b as Backup
}
```

In `packages/local-db/src/store.ts`:
- Extend the imports: `import { completionId, isNewer, SYNC_TABLES, type OutboxEntry, type SyncChange, type SyncLocal, type SyncRow, type SyncTable } from '@rock_ht/sync'` and `import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from './backup'`.
- Add inside `createLocalStore`, after `deleteJournal`:
```ts
  async function exportBackup(userId: string): Promise<Backup> {
    const tables: Record<SyncTable, SyncRow[]> = {
      profiles: await selectRows('profiles', 'id = ?', [userId]),
      habits: await selectRows('habits', 'user_id = ?', [userId]),
      habit_completions: await selectRows('habit_completions', 'user_id = ?', [userId]),
      journal_entries: await selectRows('journal_entries', 'user_id = ?', [userId]),
    }
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: now(), tables }
  }

  /** Merge a backup into userId's data in one transaction; see the import rules in Task 8. */
  async function importBackup(userId: string, backup: Backup): Promise<{ imported: number; skipped: number }> {
    let imported = 0
    let skipped = 0
    await driver.transaction(async (tx) => {
      for (const table of SYNC_TABLES) {
        for (const src of backup.tables[table]) {
          if (table === 'profiles') {
            const local = await getRow('profiles', userId, tx)
            const row: SyncRow = {
              ...src, id: userId, created_at: local?.created_at ?? src.created_at, updated_at: now(), deleted_at: null,
            }
            await upsert(tx, table, row)
            await enqueue(tx, table, row)
            imported++
            continue
          }
          const incoming: SyncRow = { ...src, user_id: userId }
          const existing = await getRow(table, incoming.id, tx)
          if (existing && !existing.deleted_at && !isNewer(incoming, existing)) {
            skipped++
            continue
          }
          const row: SyncRow = { ...incoming, deleted_at: null, updated_at: now() }
          await upsert(tx, table, row)
          await enqueue(tx, table, row)
          imported++
        }
      }
    })
    return { imported, skipped }
  }
```
- Add `exportBackup, importBackup,` to the returned object.

Add `export * from './backup'` to `packages/local-db/src/index.ts`.

- [ ] **Step 4: Run, verify pass**

Run: `npm test --workspace=packages/local-db` → PASS (18 tests).
Run: `npx tsc --noEmit -p packages/local-db` → no errors.

- [ ] **Step 5: Mobile file export/import**

Run in `apps/mobile`: `npx expo install expo-file-system expo-sharing expo-document-picker`. Expected versions: `expo-file-system ~55.0.20`, `expo-sharing ~55.0.19`, `expo-document-picker ~55.0.13`. They are native modules: the next `scripts/build-apk.sh` run rebuilds them in via autolinking (no `app.json` plugin, see Global Constraints).

`apps/mobile/lib/backup.ts`:
```ts
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { parseBackup, type LocalStore } from "@rock_ht/local-db";
import { today } from "@rock_ht/utils";

/** Writes the backup to the cache dir and opens the share sheet (Save to Files, Drive, email…). */
export async function exportToShareSheet(store: LocalStore, userId: string): Promise<void> {
  const backup = await store.exportBackup(userId);
  const file = new File(Paths.cache, `rock-backup-${today()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup));
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save rock backup" });
}

/** Returns null when the user cancels the picker. Throws BackupError for foreign files. */
export async function importFromPicker(
  store: LocalStore,
  userId: string,
): Promise<{ imported: number; skipped: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  if (res.canceled) return null;
  const text = await new File(res.assets[0]!.uri).text();
  return store.importBackup(userId, parseBackup(text));
}
```
The picker uses `*/*` because Android file managers often report `.json` files as `application/octet-stream`; `parseBackup` rejects anything that is not a rock backup. `File`, `Paths`, `file.exists`, `create()`, `write()` and `text()` are the SDK 55 `expo-file-system` API (`node_modules/expo-file-system/build/ExpoFileSystem.types.d.ts`).

- [ ] **Step 6: Settings "Data" section**

In `apps/mobile/app/(tabs)/settings.tsx`, add below the "Notifications" section (reusing `SectionHeader`, `SectionCard`, `SettingRow`, `Divider`):
```tsx
        {/* Data */}
        <SectionHeader title="Data" />
        <SectionCard>
          <SettingRow icon="download-outline" label="Export data" onPress={handleExport} />
          <Divider />
          <SettingRow icon="cloud-upload-outline" label="Import data" onPress={handleImport} />
        </SectionCard>
```
and the handlers inside the component (`store`, `userId` from `useLocal()`, added in Task 7; `useQueryClient` from `@tanstack/react-query`):
```tsx
  const queryClient = useQueryClient();

  async function handleExport() {
    hapticLight();
    try {
      await exportToShareSheet(store, userId);
    } catch (e) {
      hapticError();
      Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
    }
  }

  async function handleImport() {
    hapticLight();
    try {
      const result = await importFromPicker(store, userId);
      if (!result) return;
      await queryClient.invalidateQueries();
      await rebuildRemindersFromStore(store, userId);
      Alert.alert("Import complete", `${result.imported} items restored, ${result.skipped} already up to date.`);
    } catch (e) {
      hapticError();
      Alert.alert("Import failed", e instanceof Error ? e.message : String(e));
    }
  }
```
(imports: `exportToShareSheet`, `importFromPicker` from `@/lib/backup`.)

- [ ] **Step 7: Verify**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile` → 0 errors.
Run: `scripts/build-apk.sh --install <serial> --allow-dummy-env`, then on the device in airplane mode:
1. Settings → Export data → Save to Files (Downloads). A `rock-backup-<date>.json` file exists.
2. Delete a habit. Settings → Import data → pick the file. The alert reports restored items and the habit is back with its completions.
3. Import a non-backup file (any photo): the alert says "Not a JSON file" or "Not a rock backup file", and nothing changes.

- [ ] **Step 8: Commit**

```bash
git add packages/local-db apps/mobile package-lock.json
git commit -m "feat(mobile): export and import all local data as a versioned JSON backup"
```

### Task 9: APK builds without any env; M1 on-device acceptance

After Task 6 no mobile code reads `EXPO_PUBLIC_SUPABASE_*`, but `scripts/build-apk.sh` still refuses to build without `apps/mobile/.env.local` (or `--allow-dummy-env`), and `android-apk.yml` still injects Supabase secrets. This task removes those requirements, drops dependencies nothing uses anymore, and runs the full offline acceptance checklist that closes M1.

**Files:**
- Modify: `scripts/build-apk.sh`, `.github/workflows/android-apk.yml`, `apps/mobile/.env.local.example`, `apps/mobile/package.json`, `package-lock.json`

**Interfaces:**
- Produces: `scripts/build-apk.sh [--install [SERIAL]] [--abi LIST] [--clean]` builds with no `.env.local`; if the file exists it is still sourced (for `EXPO_PUBLIC_SENTRY_DSN`).

- [ ] **Step 1: Build script**

In `scripts/build-apk.sh`:
- Replace the whole `# ---- app env …` block (from `if [ -f "$MOBILE/.env.local" ]; then` through its closing `fi`, including the `elif [ "$allow_dummy" = 1 ]` dummy-values branch and the `die "apps/mobile/.env.local missing …"` branch) with:
```bash
# ---- app env (optional; EXPO_PUBLIC_* is inlined into the JS bundle) --------
# The app needs no env to run. .env.local may set EXPO_PUBLIC_SENTRY_DSN.
if [ -f "$MOBILE/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$MOBILE/.env.local"
    set +a
fi
```
- In the argument loop delete the line `        --allow-dummy-env) allow_dummy=1 ;;`, and change the defaults line to `do_install=0 serial="" abi="arm64-v8a" do_clean=0`.
- In `usage()` delete the three `--allow-dummy-env` lines.

Run: `shellcheck scripts/build-apk.sh` → no output. Run: `scripts/build-apk.sh --allow-dummy-env` → `build-apk: unknown option: --allow-dummy-env (see --help)`, exit 1.

- [ ] **Step 2: CI workflow and env example**

In `.github/workflows/android-apk.yml`, delete these two lines from the job `env:` (keep `NODE_PATH` and `EXPO_PUBLIC_SENTRY_DSN`):
```yaml
      EXPO_PUBLIC_SUPABASE_URL: ${{ secrets.EXPO_PUBLIC_SUPABASE_URL }}
      EXPO_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.EXPO_PUBLIC_SUPABASE_ANON_KEY }}
```

Replace `apps/mobile/.env.local.example` with:
```
# Optional. The app runs fully offline with no env at all.
# Sync servers (self-hosted or Supabase) are configured in the app: Settings → Sync.
EXPO_PUBLIC_SENTRY_DSN=
```

- [ ] **Step 3: Drop unused mobile dependencies**

```bash
grep -rn "@rock_ht/db\|@react-native-async-storage" apps/mobile --include=*.ts --include=*.tsx --include=*.js | grep -v node_modules
```
Expected: no output (Tasks 5–6 removed the last users). Then:
```bash
npm uninstall --workspace=apps/mobile @rock_ht/db @react-native-async-storage/async-storage
```
Keep `@supabase/supabase-js` and `react-native-url-polyfill`: the optional Supabase backend (Task 15) loads them lazily. `@react-native-async-storage/async-storage` is a native module, so the next APK build must be a full Gradle build (the script always runs one).

- [ ] **Step 4: Static checks**

```bash
npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile
npm run lint
for tz in UTC Pacific/Kiritimati Pacific/Pago_Pago America/New_York; do TZ=$tz npx turbo run test --force || break; done
```
Expected: 0 type errors, 0 lint errors, all tests green in all four timezones.

- [ ] **Step 5: M1 acceptance on a real device**

Use a test device: step 1 wipes the app's data on it.
```bash
[ -f apps/mobile/.env.local ] && mv apps/mobile/.env.local /tmp/rock_ht.env.local.bak
adb -s <serial> uninstall app.rockht.mobile
scripts/build-apk.sh --install <serial>
adb -s <serial> logcat -c
```
Turn on airplane mode on the device (Wi-Fi off too), then:
1. Launch: the app opens straight to onboarding (no login screen). Complete it and allow notifications.
2. Create a daily habit with a reminder 2 minutes from now and a `specific_days` habit (Mon/Wed/Fri). Toggle the daily one: the progress ring and a streak of 1 show.
3. Swipe to complete the second habit (if scheduled today) and use "log yesterday" on the first: the streak becomes 2.
4. Add a journal entry: it is dated today (local date, also after 20:00 in a timezone west of UTC).
5. Wait for the reminder: it fires at the set minute with the habit's icon and title.
6. Settings → Export data → save the file. Delete the daily habit. Settings → Import data → the habit and its completions return.
7. `adb -s <serial> shell am force-stop app.rockht.mobile`, relaunch: all data is still there, no onboarding.
8. Reboot the phone, keep airplane mode on, open the app: data intact; the reminder is still scheduled (`adb -s <serial> shell dumpsys alarm | grep -c app.rockht.mobile` > 0).
9. `adb -s <serial> logcat -d -s ReactNativeJS:E AndroidRuntime:E` → no errors from `app.rockht.mobile`.

Restore the env file afterwards if you moved it: `[ -f /tmp/rock_ht.env.local.bak ] && mv /tmp/rock_ht.env.local.bak apps/mobile/.env.local`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-apk.sh .github/workflows/android-apk.yml apps/mobile/.env.local.example apps/mobile/package.json package-lock.json
git commit -m "build(mobile): build the offline app without Supabase env and drop unused deps"
```

---

## M2 — Sync engine and client plumbing

### Task 10: Sync engine

**Files:**
- Create: `packages/sync/src/engine.ts`
- Modify: `packages/sync/src/index.ts`
- Test: `packages/sync/src/__tests__/engine.test.ts`, `packages/local-db/src/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `isNewer`; `createLocalStore` and its `sync: SyncLocal` (Task 3), whose outbox has been filled since M1.
- Produces: `runSync(local: SyncLocal, remote: SyncRemote, opts?: { batchSize?: number }): Promise<SyncReport>`, `interface SyncReport { pushed: number; pulled: number }`.

- [ ] **Step 1: Write failing tests** with in-memory fakes

`packages/sync/src/__tests__/engine.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runSync } from '../engine'
import type { OutboxEntry, PullResult, SyncChange, SyncLocal, SyncRemote, SyncRow, SyncTable } from '../types'

function fakeLocal(rows: SyncChange[] = [], outbox: SyncChange[] = []) {
  const data = new Map<string, SyncRow>(rows.map((c) => [`${c.table}:${c.row.id}`, c.row]))
  let entries: OutboxEntry[] = outbox.map((change, i) => ({ seq: i + 1, change }))
  let cursor: string | null = null
  const local: SyncLocal = {
    async readOutbox(limit) { return entries.slice(0, limit) },
    async ackOutbox(upto) { entries = entries.filter((e) => e.seq > upto) },
    async getRow(table: SyncTable, id) { return data.get(`${table}:${id}`) ?? null },
    async getCursor() { return cursor },
    async applyRemote(changes, c) {
      for (const ch of changes) data.set(`${ch.table}:${ch.row.id}`, ch.row)
      cursor = c
    },
  }
  return { local, data, outbox: () => entries, cursor: () => cursor }
}

/** Server with a global sequence and LWW upsert, like sync_push_for/sync_pull_for. */
function fakeRemote() {
  const rows = new Map<string, { seq: number; change: SyncChange }>()
  let seq = 0
  const remote: SyncRemote = {
    async push(changes) {
      for (const c of changes) {
        const key = `${c.table}:${c.row.id}`
        const cur = rows.get(key)
        if (!cur || cur.change.row.updated_at < c.row.updated_at) rows.set(key, { seq: ++seq, change: c })
      }
    },
    async pull(cursor, limit): Promise<PullResult> {
      const after = cursor ? Number(cursor) : 0
      const all = [...rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq)
      const page = all.slice(0, limit)
      return {
        changes: page.map((r) => r.change),
        cursor: page.length ? String(page[page.length - 1]!.seq) : cursor,
        hasMore: all.length > limit,
      }
    },
  }
  return { remote, rows }
}

const habit = (id: string, updated_at: string, title = 'x'): SyncChange => ({
  table: 'habits',
  row: { id, updated_at, deleted_at: null, title },
})

describe('runSync', () => {
  it('pushes the outbox and clears it', async () => {
    const l = fakeLocal([], [habit('h1', '2026-01-01T00:00:00.000Z')])
    const r = fakeRemote()
    const report = await runSync(l.local, r.remote)
    expect(report.pushed).toBe(1)
    expect(l.outbox()).toHaveLength(0)
    expect(r.rows.has('habits:h1')).toBe(true)
  })

  it('pulls remote rows and advances the cursor', async () => {
    const r = fakeRemote()
    await r.remote.push([habit('h2', '2026-01-01T00:00:00.000Z', 'remote')])
    const l = fakeLocal()
    const report = await runSync(l.local, r.remote)
    expect(report.pulled).toBe(1)
    expect(l.data.get('habits:h2')?.title).toBe('remote')
    expect(l.cursor()).toBe('1')
  })

  it('does not overwrite a newer local row with an older remote row', async () => {
    const r = fakeRemote()
    await r.remote.push([habit('h3', '2026-01-01T00:00:00.000Z', 'old')])
    const l = fakeLocal([habit('h3', '2026-02-01T00:00:00.000Z', 'new')])
    await runSync(l.local, r.remote)
    expect(l.data.get('habits:h3')?.title).toBe('new')
  })

  it('pages through more rows than the batch size', async () => {
    const r = fakeRemote()
    await r.remote.push(Array.from({ length: 5 }, (_, i) => habit(`p${i}`, '2026-01-01T00:00:00.000Z')))
    const l = fakeLocal()
    const report = await runSync(l.local, r.remote, { batchSize: 2 })
    expect(report.pulled).toBe(5)
    expect(l.cursor()).toBe('5')
  })

  it('converges two devices editing the same row offline (last write wins)', async () => {
    const r = fakeRemote()
    const a = fakeLocal([], [habit('h4', '2026-01-01T10:00:00.000Z', 'from A')])
    const b = fakeLocal([], [habit('h4', '2026-01-01T11:00:00.000Z', 'from B')])
    await runSync(a.local, r.remote)
    await runSync(b.local, r.remote)
    await runSync(a.local, r.remote)
    expect(a.data.get('habits:h4')?.title).toBe('from B')
    expect(r.rows.get('habits:h4')?.change.row.title).toBe('from B')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test --workspace=packages/sync`
Expected: FAIL, `Failed to resolve import "../engine"`.

- [ ] **Step 3: Implement**

`packages/sync/src/engine.ts`:
```ts
import { isNewer } from './merge'
import type { SyncChange, SyncLocal, SyncRemote } from './types'

export interface SyncReport {
  pushed: number
  pulled: number
}

/** Push first so the pull that follows already reflects our own writes. */
export async function runSync(
  local: SyncLocal,
  remote: SyncRemote,
  opts: { batchSize?: number } = {},
): Promise<SyncReport> {
  const batchSize = opts.batchSize ?? 200
  let pushed = 0
  let pulled = 0

  for (;;) {
    const entries = await local.readOutbox(batchSize)
    if (entries.length === 0) break
    await remote.push(entries.map((e) => e.change))
    await local.ackOutbox(entries[entries.length - 1]!.seq)
    pushed += entries.length
    if (entries.length < batchSize) break
  }

  let cursor = await local.getCursor()
  for (;;) {
    const page = await remote.pull(cursor, batchSize)
    const accepted: SyncChange[] = []
    for (const change of page.changes) {
      const existing = await local.getRow(change.table, change.row.id)
      if (isNewer(change.row, existing)) accepted.push(change)
    }
    await local.applyRemote(accepted, page.cursor)
    pulled += accepted.length
    cursor = page.cursor
    if (!page.hasMore) break
  }

  return { pushed, pulled }
}
```

Add `export * from './engine'` to `src/index.ts`.

- [ ] **Step 4: Run, verify pass**

Run: `npm test --workspace=packages/sync`
Expected: PASS (14 tests).

- [ ] **Step 5: Two real local stores converge through a fake server**

`packages/local-db/src/__tests__/sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { runSync, type SyncChange, type SyncRemote } from '@rock_ht/sync'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()
const U = 'local-user'

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

describe('local store + sync engine', () => {
  it('syncs two stores through a shared fake remote', async () => {
    const seq = { n: 0 }
    const server = new Map<string, { seq: number; c: SyncChange }>()
    const remote: SyncRemote = {
      async push(cs) {
        for (const c of cs) {
          const k = `${c.table}:${c.row.id}`
          const cur = server.get(k)
          if (!cur || cur.c.row.updated_at < c.row.updated_at) server.set(k, { seq: ++seq.n, c })
        }
      },
      async pull(cursor, limit) {
        const all = [...server.values()].filter((r) => r.seq > Number(cursor ?? 0)).sort((a, b) => a.seq - b.seq)
        const page = all.slice(0, limit)
        return { changes: page.map((r) => r.c), cursor: page.at(-1) ? String(page.at(-1)!.seq) : cursor, hasMore: all.length > limit }
      },
    }
    const a = await newStore()
    const b = await newStore()
    const h = await a.createHabit(U, { title: 'Shared', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await a.setCompletion(U, { habit_id: h.id, date: '2026-01-02' }, true)
    await runSync(a.sync, remote)
    await runSync(b.sync, remote)
    expect((await b.listHabits(U))[0]!.title).toBe('Shared')
    expect(await b.listCompletions(U)).toHaveLength(1)
  })
})
```
`@rock_ht/sync` is already a dependency of `@rock_ht/local-db` (Task 2).

Run: `npm test --workspace=packages/local-db` → PASS (19 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sync packages/local-db
git commit -m "feat(sync): add push-then-pull sync engine with cursor paging"
```

### Task 11: Mobile sync settings, remote factory and sync service

**Files:**
- Create: `apps/mobile/lib/sync/config.ts`, `lib/sync/remote-factory.ts`, `lib/sync/service.ts`, `hooks/use-sync.ts`, `app/sync-settings.tsx`
- Create: `packages/sync/src/http-remote.ts` + test `packages/sync/src/__tests__/http-remote.test.ts`
- Create: `apps/mobile/android/app/src/main/res/xml/network_security_config.xml`
- Modify: `packages/sync/src/index.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/settings.tsx`, `apps/mobile/providers/auth-provider.tsx`, `apps/mobile/package.json`, `apps/mobile/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Produces:
  - `createHttpRemote(opts: { baseUrl: string; fetch?: typeof fetch; getHeaders: () => Promise<Record<string, string>> }): SyncRemote`
  - `type SyncConfig = { kind: "off" } | { kind: "selfhost"; baseUrl: string } | { kind: "supabase"; url: string; anonKey: string }`
  - `loadSyncConfig(): Promise<SyncConfig>`, `saveSyncConfig(c: SyncConfig): Promise<void>`
  - `interface SyncBackend { remote: SyncRemote; signIn(email: string, password: string): Promise<string>; signUp(email: string, password: string, name: string): Promise<string>; signOut(): Promise<void>; currentUserId(): Promise<string | null> }` (sign-in/up return the account user id)
  - `createBackend(c: SyncConfig): Promise<SyncBackend | null>` (`null` for `off`)
  - `syncNow(): Promise<SyncReport | null>`: single-flight, returns `null` when off or signed out
  - `useSync(): { status: "off" | "idle" | "syncing" | "error"; lastSyncedAt: string | null; syncNow: () => void }`
- HTTP contract (implemented in Task 12):
  - `POST {baseUrl}/api/sync/push` body `{ changes: SyncChange[] }` → `204`
  - `GET {baseUrl}/api/sync/pull?cursor=<string|empty>&limit=<n>` → `200 { changes, cursor, hasMore }`
  - `401` when not authenticated

- [ ] **Step 1: HttpRemote test (failing)**

`packages/sync/src/__tests__/http-remote.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createHttpRemote } from '../http-remote'

describe('createHttpRemote', () => {
  it('POSTs changes to /api/sync/push with auth headers', async () => {
    // Typed so toHaveBeenCalledWith/mock.calls type-check (package tsconfigs include __tests__).
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test/', fetch, getHeaders: async () => ({ Cookie: 'a=b' }) })
    await r.push([])
    expect(fetch).toHaveBeenCalledWith('https://x.test/api/sync/push', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Cookie: 'a=b', 'Content-Type': 'application/json' }),
    }))
  })

  it('GETs pull with cursor and normalizes timestamps', async () => {
    const body = { changes: [{ table: 'habits', row: { id: 'h', updated_at: '2026-01-01T00:00:00+00:00', deleted_at: null } }], cursor: '7', hasMore: false }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    const res = await r.pull('3', 50)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=3&limit=50')
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.cursor).toBe('7')
  })

  it('throws on non-2xx', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('no', { status: 401 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await expect(r.pull(null, 10)).rejects.toThrow('401')
  })
})
```

- [ ] **Step 2: Implement `http-remote.ts`**

```ts
import { normalizeTimestamp } from './merge'
import type { PullResult, SyncChange, SyncRemote } from './types'

export interface HttpRemoteOptions {
  baseUrl: string
  fetch?: typeof fetch
  getHeaders: () => Promise<Record<string, string>>
}

export function normalizeChange(c: SyncChange): SyncChange {
  const row = { ...c.row, updated_at: normalizeTimestamp(c.row.updated_at) }
  if (row.deleted_at) row.deleted_at = normalizeTimestamp(row.deleted_at)
  return { table: c.table, row }
}

export function createHttpRemote({ baseUrl, fetch: f = fetch, getHeaders }: HttpRemoteOptions): SyncRemote {
  const base = baseUrl.replace(/\/+$/, '')

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await f(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
    })
    if (!res.ok) throw new Error(`sync ${path} failed: ${res.status}`)
    return res
  }

  return {
    async push(changes) {
      await call('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) })
    },
    async pull(cursor, limit): Promise<PullResult> {
      const q = new URLSearchParams({ cursor: cursor ?? '', limit: String(limit) })
      const body = (await (await call(`/api/sync/pull?${q}`)).json()) as PullResult
      return { ...body, changes: body.changes.map(normalizeChange) }
    },
  }
}
```
Export from `index.ts`. Run `npm test --workspace=packages/sync` → PASS, and `npx tsc --noEmit -p packages/sync` → no errors.

- [ ] **Step 3: Config persistence**

`apps/mobile/lib/sync/config.ts`:
```ts
import * as SecureStore from "expo-secure-store";

export type SyncConfig =
  | { kind: "off" }
  | { kind: "selfhost"; baseUrl: string }
  | { kind: "supabase"; url: string; anonKey: string };

const KEY = "rock_ht.sync_config";

export async function loadSyncConfig(): Promise<SyncConfig> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as SyncConfig) : { kind: "off" };
}

export async function saveSyncConfig(c: SyncConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(c));
}
```

- [ ] **Step 4: Remote factory (self-host now, Supabase in Task 15)**

Install in `apps/mobile` (pin the exact version `apps/web` uses in Task 12):
```bash
npm install better-auth@1.7.6 @better-auth/expo@1.7.6 @better-auth/core@1.7.6
npx expo install expo-network expo-web-browser
```
`@better-auth/expo@1.7.6` peers: `better-auth`, `@better-auth/core`, `expo-network`, `expo-web-browser`, `expo-linking`, `expo-constants`, `expo-secure-store` (the last three are already installed). `expo-network` and `expo-web-browser` are native modules: the next `scripts/build-apk.sh` run rebuilds them in. The option names below (`scheme`, `storagePrefix`, `storage`, `getCookie()`) are checked against `@better-auth/expo@1.7.6` `dist/client.d.ts`.

`apps/mobile/lib/sync/remote-factory.ts`:
```ts
import * as SecureStore from "expo-secure-store";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { createHttpRemote, type SyncRemote } from "@rock_ht/sync";
import type { SyncConfig } from "./config";

export interface SyncBackend {
  remote: SyncRemote;
  signIn(email: string, password: string): Promise<string>;
  signUp(email: string, password: string, name: string): Promise<string>;
  signOut(): Promise<void>;
  currentUserId(): Promise<string | null>;
}

function selfHostBackend(baseUrl: string): SyncBackend {
  const auth = createAuthClient({
    baseURL: baseUrl,
    // Must match app.json "scheme" and the intent filter in AndroidManifest.xml.
    plugins: [expoClient({ scheme: "rockht", storagePrefix: "rock_ht", storage: SecureStore })],
  });
  const must = <T,>(r: { data: T | null; error: { message?: string } | null }): T => {
    if (r.error || !r.data) throw new Error(r.error?.message ?? "auth failed");
    return r.data;
  };
  return {
    remote: createHttpRemote({
      baseUrl,
      getHeaders: async () => {
        const cookie = auth.getCookie();
        return cookie ? { Cookie: cookie } : {};
      },
    }),
    async signIn(email, password) {
      return must(await auth.signIn.email({ email, password })).user.id;
    },
    async signUp(email, password, name) {
      return must(await auth.signUp.email({ email, password, name })).user.id;
    },
    async signOut() { await auth.signOut(); },
    async currentUserId() {
      const s = await auth.getSession();
      return s.data?.user.id ?? null;
    },
  };
}

export async function createBackend(c: SyncConfig): Promise<SyncBackend | null> {
  switch (c.kind) {
    case "off": return null;
    case "selfhost": return selfHostBackend(c.baseUrl);
    case "supabase": {
      const { supabaseBackend } = await import("./supabase-backend");
      return supabaseBackend(c.url, c.anonKey);
    }
  }
}
```
Until Task 15, create `apps/mobile/lib/sync/supabase-backend.ts` with:
```ts
import type { SyncBackend } from "./remote-factory";
export async function supabaseBackend(_url: string, _anonKey: string): Promise<SyncBackend> {
  throw new Error("Supabase sync not available yet");
}
```

- [ ] **Step 5: Sync service**

`apps/mobile/lib/sync/service.ts`:
```ts
import { runSync, type SyncReport } from "@rock_ht/sync";
import { openLocalStore } from "@/lib/local";
import { loadSyncConfig } from "./config";
import { createBackend } from "./remote-factory";

let inFlight: Promise<SyncReport | null> | null = null;
const listeners = new Set<(s: { syncing: boolean; error: unknown; at: string | null }) => void>();
let last: { syncing: boolean; error: unknown; at: string | null } = { syncing: false, error: null, at: null };

function emit(next: Partial<typeof last>) {
  last = { ...last, ...next };
  listeners.forEach((l) => l(last));
}

export function subscribeSync(fn: (s: typeof last) => void): () => void {
  listeners.add(fn);
  fn(last);
  return () => listeners.delete(fn);
}

/** Single-flight: concurrent callers share one run. */
export function syncNow(): Promise<SyncReport | null> {
  inFlight ??= (async () => {
    try {
      const backend = await createBackend(await loadSyncConfig());
      if (!backend || !(await backend.currentUserId())) return null;
      emit({ syncing: true, error: null });
      const store = await openLocalStore();
      const report = await runSync(store.sync, backend.remote);
      emit({ syncing: false, at: new Date().toISOString() });
      return report;
    } catch (error) {
      emit({ syncing: false, error });
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
```

- [ ] **Step 6: `useSync` + triggers**

`apps/mobile/hooks/use-sync.ts`:
```ts
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeSync, syncNow } from "@/lib/sync/service";
import { loadSyncConfig } from "@/lib/sync/config";
import { useLocal } from "@/providers/local-provider";
import { rebuildRemindersFromStore } from "@/hooks/use-reminders";

export function useSync() {
  const qc = useQueryClient();
  const { store, userId } = useLocal();
  const [state, setState] = useState<{ syncing: boolean; error: unknown; at: string | null }>({ syncing: false, error: null, at: null });
  const [off, setOff] = useState(true);

  useEffect(() => { void loadSyncConfig().then((c) => setOff(c.kind === "off")); }, []);
  useEffect(() => subscribeSync(setState), []);

  const run = () => {
    void syncNow().then(async (r) => {
      if (!r || r.pulled === 0) return;
      await qc.invalidateQueries();
      // Pulled habits (new, edited, deleted) need their reminders (Task 7).
      await rebuildRemindersFromStore(store, userId);
    });
  };

  return {
    status: off ? "off" : state.syncing ? "syncing" : state.error ? "error" : "idle",
    lastSyncedAt: state.at,
    syncNow: run,
  } as const;
}

/** Mount once in the root layout: sync on launch, on foreground, on reconnect, and every 5 min. */
export function useSyncTriggers() {
  const { syncNow: run } = useSync();
  useEffect(() => {
    run();
    const app = AppState.addEventListener("change", (s) => { if (s === "active") run(); });
    const net = NetInfo.addEventListener((s) => { if (s.isConnected) run(); });
    const timer = setInterval(run, 5 * 60_000);
    return () => { app.remove(); net(); clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```
Call `useSyncTriggers()` inside `OnboardingGuard` in `app/_layout.tsx`. In each mutation's `onSettled` in the hooks from Task 5, also call `void syncNow()` (import from `@/lib/sync/service`). It's a no-op when sync is off.

- [ ] **Step 7: Sync settings screen**

`apps/mobile/app/sync-settings.tsx`: a form with a three-way segmented control (Off / Self-hosted / Supabase), fields per kind (server URL; or Supabase URL + anon key), then email + password (+ name for sign-up) and "Sign in" / "Create account" buttons. Reuse the layout and styling from the `app/(auth)/login.tsx` deleted in Task 6: `git show "$(git rev-list -n1 HEAD -- 'apps/mobile/app/(auth)/login.tsx')^:apps/mobile/app/(auth)/login.tsx"`. Submit handler:
```ts
async function connect(mode: "signin" | "signup") {
  const config: SyncConfig =
    kind === "selfhost" ? { kind, baseUrl: url.trim() }
    : kind === "supabase" ? { kind, url: url.trim(), anonKey: anonKey.trim() }
    : { kind: "off" };
  await saveSyncConfig(config);
  const backend = await createBackend(config);
  if (!backend) { await refreshUserId(); return router.back(); }
  const accountId = mode === "signup"
    ? await backend.signUp(email, password, name)
    : await backend.signIn(email, password);
  const current = await resolveUserId(store);
  if (current !== accountId) await store.claim(current, accountId);
  await store.setMeta("account_user_id", accountId);
  await refreshUserId();
  await syncNow();
  await queryClient.invalidateQueries();
  await rebuildRemindersFromStore(store, accountId);
  router.back();
}
```
(`store`, `refreshUserId` from `useLocal()`; `resolveUserId` from `@/lib/local`; `rebuildRemindersFromStore` from `@/hooks/use-reminders`.)

"Disconnect" button: `await backend.signOut(); await store.setMeta("account_user_id", null); await saveSyncConfig({ kind: "off" }); await refreshUserId();`. Data stays on the device under the account id. On disconnect, also `store.setMeta("local_user_id", accountId)` so the offline user keeps its rows.

In `app/(tabs)/settings.tsx` add a "Sync" row showing `useSync().status` and `lastSyncedAt` that navigates to `/sync-settings`. In `auth-provider.tsx`, make `signOut` do the same as Disconnect.

- [ ] **Step 8: Allow plain HTTP to user-configured LAN servers**

A self-hosted server on the LAN (`http://192.168.x.y:3000`) or a local Supabase (`http://<LAN-IP>:54321`) uses plain HTTP, which Android blocks in release builds. `apps/mobile/android/` is committed, so `expo-build-properties` and other config plugins do nothing here; edit the native files directly.

`apps/mobile/android/app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  The sync server URL is chosen by the user at runtime (Settings > Sync) and is
  often a LAN address without TLS, so cleartext must be allowed app-wide.
  User credentials go to that server only; the app talks to no other host.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

In `apps/mobile/android/app/src/main/AndroidManifest.xml`, add `android:networkSecurityConfig="@xml/network_security_config"` to the `<application …>` element (next to `android:allowBackup="true"`).

In `app/sync-settings.tsx`, show a one-line warning under the URL field when it starts with `http://`: "Unencrypted: use only on a network you trust."

- [ ] **Step 9: Verify**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile` → 0 errors. Run: `npm test --workspace=packages/sync` → green.
Run: `scripts/build-apk.sh --install <serial>` and check the M1 behaviour is unchanged with Settings → Sync → Off (repeat items 1, 2 and 7 of the Task 9 checklist). An end-to-end sync check happens in Task 13 Step 5.

- [ ] **Step 10: Commit**

```bash
git add packages/sync apps/mobile package-lock.json
git commit -m "feat(mobile): add pluggable sync settings, HTTP remote and background sync triggers"
```

---

## M3 — Self-hosted plain Postgres backend

### Task 12: Self-hosted Postgres schema, Better Auth and `/api/sync` in Next.js

**Files:**
- Create: `db/selfhost/init/01_schema.sql`, `db/selfhost/init/02_sync.sql`, `db/selfhost/init/03_auth.sql`
- Create: `apps/web/lib/server/db.ts`, `apps/web/lib/server/auth.ts`, `apps/web/app/api/auth/[...all]/route.ts`, `apps/web/app/api/sync/push/route.ts`, `apps/web/app/api/sync/pull/route.ts`
- Create: `apps/web/lib/server/__tests__/sync.int.test.ts` (runs against Docker Postgres), `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: HTTP contract from Task 11; `SyncChange`, `PullResult`.
- Produces SQL functions shared with Supabase (Task 14):
  - `public.sync_push_for(p_user uuid, p_changes jsonb) returns void`
  - `public.sync_pull_for(p_user uuid, p_cursor bigint, p_limit int) returns jsonb` → `{ "changes": [...], "cursor": "<bigint as text>" | null, "hasMore": bool }`
- Env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SYNC_BACKEND=selfhost`

- [ ] **Step 1: Schema (`01_schema.sql`)**: same tables as `supabase/migrations/001` + `005` + sync columns, without `auth.users`, RLS or the realtime publication.

```sql
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
```

- [ ] **Step 2: Sync functions (`02_sync.sql`)**: this block is copied verbatim into `supabase/migrations/007_sync.sql` in Task 14. A parity test enforces that.

```sql
-- >>> SYNC FUNCTIONS (keep identical to supabase/migrations/007_sync.sql)
create or replace function public.bump_sync_seq()
returns trigger language plpgsql as $$
begin
  new.server_seq := nextval('public.sync_seq');
  -- Web/SQL writers that don't set updated_at still advance it; sync writers set it explicitly.
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger profiles_sync_seq before insert or update on public.profiles
  for each row execute function public.bump_sync_seq();
create or replace trigger habits_sync_seq before insert or update on public.habits
  for each row execute function public.bump_sync_seq();
create or replace trigger completions_sync_seq before insert or update on public.habit_completions
  for each row execute function public.bump_sync_seq();
create or replace trigger journal_sync_seq before insert or update on public.journal_entries
  for each row execute function public.bump_sync_seq();

create or replace function public.sync_push_for(p_user uuid, p_changes jsonb)
returns void language plpgsql as $$
declare
  c jsonb;
  r jsonb;
begin
  for c in select * from jsonb_array_elements(p_changes) loop
    r := c->'row';
    case c->>'table'
    when 'profiles' then
      update public.profiles p set
        -- coalesce: a fresh device's claim() pushes display_name/avatar_url = null
        -- and must not wipe what the account already has.
        display_name = coalesce(r->>'display_name', p.display_name),
        avatar_url = coalesce(r->>'avatar_url', p.avatar_url),
        timezone = coalesce(r->>'timezone', p.timezone),
        theme = coalesce(r->>'theme', p.theme),
        onboarding_completed = coalesce((r->>'onboarding_completed')::boolean, p.onboarding_completed),
        time_format = coalesce(r->>'time_format', p.time_format),
        date_format = coalesce(r->>'date_format', p.date_format),
        updated_at = (r->>'updated_at')::timestamptz
      where p.id = p_user and p.updated_at < (r->>'updated_at')::timestamptz;
    when 'habits' then
      insert into public.habits as t (id, user_id, title, description, icon, color, frequency,
        target_value, target_unit, reminder_time, reminder_enabled, is_archived, sort_order,
        created_at, updated_at, deleted_at)
      values ((r->>'id')::uuid, p_user, r->>'title', r->>'description', r->>'icon', r->>'color',
        r->'frequency', (r->>'target_value')::int, r->>'target_unit', (r->>'reminder_time')::time,
        (r->>'reminder_enabled')::boolean, (r->>'is_archived')::boolean, (r->>'sort_order')::int,
        (r->>'created_at')::timestamptz, (r->>'updated_at')::timestamptz, (r->>'deleted_at')::timestamptz)
      on conflict (id) do update set
        title = excluded.title, description = excluded.description, icon = excluded.icon,
        color = excluded.color, frequency = excluded.frequency, target_value = excluded.target_value,
        target_unit = excluded.target_unit, reminder_time = excluded.reminder_time,
        reminder_enabled = excluded.reminder_enabled, is_archived = excluded.is_archived,
        sort_order = excluded.sort_order, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      where t.user_id = p_user and t.updated_at < excluded.updated_at;
    when 'habit_completions' then
      insert into public.habit_completions as t (id, habit_id, user_id, completed_date, value, note,
        created_at, updated_at, deleted_at)
      select (r->>'id')::uuid, (r->>'habit_id')::uuid, p_user, (r->>'completed_date')::date,
        (r->>'value')::int, r->>'note', (r->>'created_at')::timestamptz,
        (r->>'updated_at')::timestamptz, (r->>'deleted_at')::timestamptz
      where exists (select 1 from public.habits h where h.id = (r->>'habit_id')::uuid and h.user_id = p_user)
      on conflict (id) do update set
        value = excluded.value, note = excluded.note,
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      where t.user_id = p_user and t.updated_at < excluded.updated_at;
    when 'journal_entries' then
      insert into public.journal_entries as t (id, user_id, habit_id, entry_date, content, mood,
        created_at, updated_at, deleted_at)
      values ((r->>'id')::uuid, p_user, (r->>'habit_id')::uuid, (r->>'entry_date')::date,
        r->>'content', (r->>'mood')::smallint, (r->>'created_at')::timestamptz,
        (r->>'updated_at')::timestamptz, (r->>'deleted_at')::timestamptz)
      on conflict (id) do update set
        habit_id = excluded.habit_id, entry_date = excluded.entry_date, content = excluded.content,
        mood = excluded.mood, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      where t.user_id = p_user and t.updated_at < excluded.updated_at;
    else
      raise exception 'unknown sync table %', c->>'table';
    end case;
  end loop;
end;
$$;

create or replace function public.sync_pull_for(p_user uuid, p_cursor bigint, p_limit int)
returns jsonb language sql stable as $$
  with rows as (
    select 'profiles' as tbl, server_seq, to_jsonb(p) - 'server_seq' as row
      from public.profiles p where p.id = p_user and p.server_seq > p_cursor
    union all
    select 'habits', server_seq, to_jsonb(h) - 'server_seq'
      from public.habits h where h.user_id = p_user and h.server_seq > p_cursor
    union all
    select 'habit_completions', server_seq, to_jsonb(c) - 'server_seq'
      from public.habit_completions c where c.user_id = p_user and c.server_seq > p_cursor
    union all
    select 'journal_entries', server_seq, to_jsonb(j) - 'server_seq'
      from public.journal_entries j where j.user_id = p_user and j.server_seq > p_cursor
  ),
  page as (select * from rows order by server_seq limit p_limit + 1)
  select jsonb_build_object(
    'changes', coalesce((select jsonb_agg(jsonb_build_object('table', tbl, 'row', row) order by server_seq)
                         from (select * from page order by server_seq limit p_limit) x), '[]'::jsonb),
    'cursor', (select max(server_seq)::text from (select server_seq from page order by server_seq limit p_limit) y),
    'hasMore', (select count(*) > p_limit from page)
  );
$$;
-- <<< SYNC FUNCTIONS
```
When a page is empty, `cursor` is `null`; the route handler (Step 5) then returns the caller's cursor unchanged. `profiles` are pulled but never inserted by push (they're created at signup).

- [ ] **Step 3: Better Auth server**

Run in `apps/web`: `npm install better-auth@1.7.6 @better-auth/expo@1.7.6 @better-auth/core@1.7.6 pg && npm install -D @types/pg`
(`@better-auth/expo` is needed on the server for the `expo()` plugin; its Expo peers are only imported by its `/client` entry, so the web build does not need them.)

`apps/web/lib/server/db.ts`:
```ts
import { Pool } from 'pg'

let pool: Pool | undefined

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL })
  return pool
}
```

`apps/web/lib/server/auth.ts`:
```ts
import { betterAuth } from 'better-auth'
import { expo } from '@better-auth/expo'
import { randomUUID } from 'node:crypto'
import { getPool } from './db'

let instance: ReturnType<typeof create> | undefined

function create() {
  return betterAuth({
    database: getPool(),
    emailAndPassword: { enabled: true },
    plugins: [expo()],
    trustedOrigins: ['rockht://'],
    // uuid ids so they fit profiles.id / user_id uuid columns
    advanced: { database: { generateId: () => randomUUID() } },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getPool().query(
              `insert into public.profiles (id, email, display_name) values ($1, $2, $3)
               on conflict (id) do nothing`,
              [user.id, user.email, user.name || user.email.split('@')[0]],
            )
          },
        },
      },
    },
  })
}

/** Lazy so `next build` works without DATABASE_URL. */
export function getAuth() {
  instance ??= create()
  return instance
}
```
The option names were checked against Better Auth 1.7.6 (`@better-auth/core` `dist/types/init-options.d.mts`): `advanced.database.generateId` accepts a function (or `"uuid"`), and `databaseHooks.user.create.after(user, ctx)` exists. `toNextJsHandler` is exported from `better-auth/next-js`.

`apps/web/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function GET(req: Request) { return toNextJsHandler(getAuth()).GET(req) }
export async function POST(req: Request) { return toNextJsHandler(getAuth()).POST(req) }
```

Generate the Better Auth tables:
```bash
cd apps/web
DATABASE_URL=postgres://x npx auth@1.7.6 generate --config lib/server/auth.ts --output ../../db/selfhost/init/03_auth.sql --yes
```
(The CLI ships as the `auth` package, version-matched to `better-auth`; `@better-auth/cli` is deprecated on npm.)
Expected: `03_auth.sql` containing `create table "user"`, `"session"`, `"account"`, `"verification"`. Commit it as-is.

- [ ] **Step 4: Sync routes**

`apps/web/app/api/sync/push/route.ts`:
```ts
import { headers } from 'next/headers'
import { getAuth } from '@/lib/server/auth'
import { getPool } from '@/lib/server/db'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })
  const body = (await req.json()) as { changes?: unknown }
  if (!Array.isArray(body.changes)) return new Response('Bad request', { status: 400 })
  if (body.changes.length > 500) return new Response('Too many changes', { status: 413 })
  await getPool().query('select public.sync_push_for($1, $2::jsonb)', [session.user.id, JSON.stringify(body.changes)])
  return new Response(null, { status: 204 })
}
```

`apps/web/app/api/sync/pull/route.ts`:
```ts
import { headers } from 'next/headers'
import { getAuth } from '@/lib/server/auth'
import { getPool } from '@/lib/server/db'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const cursorParam = url.searchParams.get('cursor') || '0'
  if (!/^\d+$/.test(cursorParam)) return new Response('Bad cursor', { status: 400 })
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200), 1), 500)
  const { rows } = await getPool().query<{ result: { changes: unknown[]; cursor: string | null; hasMore: boolean } }>(
    'select public.sync_pull_for($1, $2::bigint, $3) as result',
    [session.user.id, cursorParam, limit],
  )
  const result = rows[0]!.result
  return Response.json({ ...result, cursor: result.cursor ?? (cursorParam === '0' ? null : cursorParam) })
}
```

- [ ] **Step 5: Integration test against real Postgres**

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['lib/**/__tests__/**/*.int.test.ts'] } })
```
Add `"test:int": "vitest run"` to `apps/web/package.json` scripts and `vitest` to devDependencies.

`apps/web/lib/server/__tests__/sync.int.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const user = randomUUID()
const other = randomUUID()
const ts = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString()

async function push(u: string, changes: unknown[]) {
  await pool.query('select public.sync_push_for($1, $2::jsonb)', [u, JSON.stringify(changes)])
}
async function pull(u: string, cursor = 0, limit = 100) {
  const { rows } = await pool.query('select public.sync_pull_for($1, $2, $3) as r', [u, cursor, limit])
  return rows[0].r as { changes: { table: string; row: Record<string, unknown> }[]; cursor: string | null; hasMore: boolean }
}
const habit = (id: string, title: string, m: number) => ({
  table: 'habits',
  row: { id, title, icon: '✨', color: '#fff', frequency: { type: 'daily' }, target_value: 1,
         reminder_enabled: false, is_archived: false, sort_order: 0,
         created_at: ts(0), updated_at: ts(m), deleted_at: null },
})

beforeAll(async () => {
  for (const u of [user, other]) {
    await pool.query("insert into public.profiles (id, email) values ($1, 'x@y.z')", [u])
  }
})

describe('sync functions', () => {
  it('inserts, then last write wins', async () => {
    const id = randomUUID()
    await push(user, [habit(id, 'v2', 2)])
    await push(user, [habit(id, 'v1-stale', 1)])
    const r = await pull(user)
    expect(r.changes.find((c) => c.row.id === id)?.row.title).toBe('v2')
  })

  it('isolates users: another user cannot overwrite or read', async () => {
    const id = randomUUID()
    await push(user, [habit(id, 'mine', 5)])
    await push(other, [habit(id, 'hijack', 9)])
    expect((await pull(other)).changes.some((c) => c.row.id === id)).toBe(false)
    expect((await pull(user)).changes.find((c) => c.row.id === id)?.row.title).toBe('mine')
  })

  it('does not wipe the display name when a device pushes null', async () => {
    await pool.query("update public.profiles set display_name = 'Ada', updated_at = $2 where id = $1", [user, ts(0)])
    await push(user, [{ table: 'profiles', row: { id: user, display_name: null, updated_at: ts(30), deleted_at: null } }])
    const { rows } = await pool.query('select display_name from public.profiles where id = $1', [user])
    expect(rows[0].display_name).toBe('Ada')
  })

  it('pages with cursor and hasMore', async () => {
    const u = randomUUID()
    await pool.query("insert into public.profiles (id, email) values ($1, 'p@y.z')", [u])
    await push(u, Array.from({ length: 3 }, (_, i) => habit(randomUUID(), `h${i}`, 1)))
    const first = await pull(u, 0, 2)
    expect(first.changes).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const second = await pull(u, Number(first.cursor), 2)
    expect(second.changes).toHaveLength(2) // profile row sorts first (lowest seq), so page 2 = h1, h2
    expect(second.hasMore).toBe(false)
  })
})
```

Run:
```bash
docker run -d --name rock_ht-pg-test -e POSTGRES_PASSWORD=pg -p 55432:5432 \
  -v "$PWD/db/selfhost/init:/docker-entrypoint-initdb.d:ro" postgres:17
until docker exec rock_ht-pg-test pg_isready -U postgres; do sleep 1; done
DATABASE_URL=postgres://postgres:pg@localhost:55432/postgres npm run test:int --workspace=apps/web
docker rm -f rock_ht-pg-test
```
Expected: 4 passing.

Add a CI job to `.github/workflows/test.yml`:
```yaml
  sync-integration:
    name: Sync integration (Postgres)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: pg }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:pg@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Load schema
        run: for f in db/selfhost/init/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
      - run: npm run test:int --workspace=apps/web
```

- [ ] **Step 6: Commit**

```bash
git add db apps/web .github/workflows/test.yml package-lock.json
git commit -m "feat(server): self-hosted Postgres sync functions, Better Auth and /api/sync routes"
```

### Task 13: Web builds without Supabase env + `docker-compose.selfhost.yml`

**Files:**
- Modify: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/middleware.ts`, `apps/web/providers/supabase-provider.tsx`
- Create: `apps/web/lib/supabase/config.ts`, `docker-compose.selfhost.yml`, `.env.selfhost.example`
- Modify: `.github/workflows/deploy-web.yml` (the `check-secrets` gate from e6c7eca skips the whole image build without Supabase secrets; the self-host compose file needs that image)

**Interfaces:**
- Produces: `isSupabaseConfigured(): boolean`. When false, the web UI shows the marketing pages and the auth pages render a "This server has no web login configured" notice. `/api/auth/*` and `/api/sync/*` keep working.

- [ ] **Step 1: Config guard**

`apps/web/lib/supabase/config.ts`:
```ts
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
```
- `middleware.ts` → `if (!isSupabaseConfigured()) return NextResponse.next()` before `updateSession`.
- `providers/supabase-provider.tsx` → when not configured, render children with a context whose `user` is `null` and don't call `createClient()`.
- `lib/supabase/server.ts` `createClient()` → throw `new Error('Supabase not configured')` when not configured. Callers in `app/(app)/layout.tsx` and `app/page.tsx` catch it and `redirect('/')` or render the landing page.

- [ ] **Step 2: Verify the build without env**

```bash
docker build -f apps/web/Dockerfile -t rock_ht-web:selfhost .
```
Expected: build succeeds with no build-args. (Earlier failure: `@supabase/ssr: Your project's URL and API key are required` while prerendering `/terms`.)

- [ ] **Step 3: Publish the image without Supabase secrets**

In `.github/workflows/deploy-web.yml`:
- Delete the whole `check-secrets` job.
- In `build-and-push`, delete `needs: check-secrets` and `if: needs.check-secrets.outputs.ready == 'true'`.
- Add this as the first step of `build-and-push` (after `actions/checkout`), so a Supabase-less build is visible but not skipped:
```yaml
      - name: Note missing Supabase config
        env:
          URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        run: |
          if [ -z "$URL" ] || [ -z "$KEY" ]; then
            echo "::notice title=Web image without Supabase::NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are not set. The image serves the marketing pages, /api/auth and /api/sync (self-host); web login is disabled."
          fi
```
The existing `build-args` stay: unset secrets expand to empty strings, which Step 1 handles.

Run: `npx --yes @action-validator/cli .github/workflows/deploy-web.yml` → no errors (or push to a branch and check the workflow run builds the image).

- [ ] **Step 4: Compose file**

`docker-compose.selfhost.yml`:
```yaml
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: rock_ht
      POSTGRES_USER: rock_ht
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/selfhost/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rock_ht -d rock_ht"]
      interval: 5s
      retries: 10

  web:
    image: ghcr.io/13/rock_ht-web:${ROCK_HT_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rock_ht:${POSTGRES_PASSWORD}@db:5432/rock_ht
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${PUBLIC_URL:?set PUBLIC_URL}
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

`.env.selfhost.example`:
```
POSTGRES_PASSWORD=change-me
BETTER_AUTH_SECRET=generate-with-openssl-rand-base64-32
PUBLIC_URL=https://rock-ht.example.com
ROCK_HT_VERSION=latest
```

- [ ] **Step 5: End-to-end manual check**

```bash
cp .env.selfhost.example .env.selfhost  # edit values; PUBLIC_URL=http://<LAN-IP>:3000 for phone testing
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/sync/pull   # expect 401
```
On the phone (APK from `scripts/build-apk.sh`), with existing offline data:
1. Settings → Sync → Self-hosted → `http://<LAN-IP>:3000` → Create account. Status shows "idle" with a timestamp.
2. `docker compose exec db psql -U rock_ht -c "select title from habits"` lists the offline habits.
3. Install on a second device or emulator, sign in with the same account: habits and completions appear.
4. Toggle a habit on device B in airplane mode, reconnect, and pull to refresh on device A: the change shows up.

Plain `http://` LAN URLs work because Task 11 Step 8 allows cleartext in `network_security_config.xml`. For anything reachable from the internet, put HTTPS in front (e.g. Caddy) and use the `https://` URL.

- [ ] **Step 6: Commit**

```bash
git add apps/web docker-compose.selfhost.yml .env.selfhost.example .github/workflows/deploy-web.yml
git commit -m "feat(selfhost): build web without Supabase env and add docker compose for self-hosting"
```

---

## M4 — Supabase as an optional sync backend

### Task 14: Supabase migration 007 + web client soft deletes

**Files:**
- Create: `supabase/migrations/007_sync.sql`
- Create: `packages/sync/src/__tests__/sql-parity.test.ts`
- Modify: `packages/types/src/database.types.ts` (add `updated_at`, `deleted_at`, `server_seq` to the synced tables' Row/Insert/Update, and add the `sync_push`/`sync_pull` Functions)
- Modify: `packages/db/src/habits.ts`, `completions.ts`, `journal.ts`, `streaks.ts` if it reads completions directly
- Do not modify `supabase/migrations/003_functions_triggers.sql`; 007 replaces `recalculate_streak` with `create or replace`.

**Interfaces:**
- Produces RPCs: `sync_push(p_changes jsonb) returns void`, `sync_pull(p_cursor bigint, p_limit int) returns jsonb` (both `security definer`, using `auth.uid()`).

- [ ] **Step 1: Parity test (failing)**

`packages/sync/src/__tests__/sql-parity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const block = (file: string) => {
  const sql = readFileSync(resolve(__dirname, '../../../../', file), 'utf8')
  const start = sql.indexOf('-- >>> SYNC FUNCTIONS')
  const end = sql.indexOf('-- <<< SYNC FUNCTIONS')
  if (start < 0 || end < 0) throw new Error(`markers missing in ${file}`)
  return sql.slice(start, end)
}

describe('sync SQL parity', () => {
  it('self-host and Supabase share identical sync functions', () => {
    expect(block('supabase/migrations/007_sync.sql')).toBe(block('db/selfhost/init/02_sync.sql'))
  })
})
```

- [ ] **Step 2: Write `007_sync.sql`**

The file is assembled in three parts so the shared block is copied byte-for-byte from `02_sync.sql` (the parity test from Step 1 enforces it).

Part 1: sync columns, deterministic completion ids, and a streak function that ignores tombstones and uses the user's timezone (roadmap #16: `003_functions_triggers.sql:110` compares against `current_date`, the database server's UTC date).
```bash
cat > supabase/migrations/007_sync.sql <<'SQL'
-- ============================================================
-- rock: offline sync (tombstones, LWW timestamps, server_seq)
-- ============================================================
create extension if not exists "uuid-ossp" with schema extensions;
create sequence if not exists public.sync_seq;

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.habits
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.habit_completions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');
alter table public.journal_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists server_seq bigint not null default nextval('public.sync_seq');

-- Completions get deterministic ids so offline devices agree (see @rock_ht/sync completionId)
update public.habit_completions
  set id = extensions.uuid_generate_v5('6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'::uuid, habit_id::text || ':' || completed_date::text);
alter table public.habit_completions alter column id drop default;

-- The old set_updated_at triggers overwrite client timestamps and break last-write-wins
drop trigger if exists habits_set_updated_at on public.habits;
drop trigger if exists profiles_set_updated_at on public.profiles;
drop trigger if exists journal_set_updated_at on public.journal_entries;

create index if not exists habits_user_seq_idx on public.habits (user_id, server_seq);
create index if not exists completions_user_seq_idx on public.habit_completions (user_id, server_seq);
create index if not exists journal_user_seq_idx on public.journal_entries (user_id, server_seq);

-- Streak cache: skip tombstoned completions, and judge "today" in the user's
-- timezone (profiles.timezone) instead of the server's UTC current_date.
create or replace function public.recalculate_streak(p_habit_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id           uuid;
  v_today             date;
  v_current_streak    integer := 0;
  v_longest_streak    integer := 0;
  v_last_date         date    := null;
  v_run               integer := 0;
  v_prev_date         date    := null;
  r                   record;
begin
  select h.user_id, (now() at time zone coalesce(p.timezone, 'UTC'))::date
    into v_user_id, v_today
    from public.habits h
    left join public.profiles p on p.id = h.user_id
   where h.id = p_habit_id;

  for r in
    select completed_date
    from public.habit_completions
    where habit_id = p_habit_id and deleted_at is null
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

  if v_last_date is not null then
    v_current_streak := 0;
    v_prev_date := null;
    for r in
      select completed_date
      from public.habit_completions
      where habit_id = p_habit_id and deleted_at is null
      order by completed_date desc
    loop
      if v_prev_date is null then
        -- First row: it must be today or yesterday (user's local date) to count
        if r.completed_date >= v_today - 1 then
          v_current_streak := 1;
          v_prev_date := r.completed_date;
        else
          exit;
        end if;
      elsif r.completed_date = v_prev_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_prev_date := r.completed_date;
      else
        exit;
      end if;
    end loop;
  end if;

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

-- Soft deletes are updates: recalculate on update too.
create or replace trigger on_completion_updated
  after update on public.habit_completions
  for each row execute function public.handle_completion_insert();

SQL
```

Part 2: the shared sync functions, copied from the self-host file.
```bash
sed -n '/^-- >>> SYNC FUNCTIONS/,/^-- <<< SYNC FUNCTIONS/p' db/selfhost/init/02_sync.sql >> supabase/migrations/007_sync.sql
```

Part 3: auth-bound RPC wrappers.
```bash
cat >> supabase/migrations/007_sync.sql <<'SQL'

-- Only callable through the auth-bound wrappers below
revoke execute on function public.sync_push_for(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_pull_for(uuid, bigint, int) from public, anon, authenticated;

create or replace function public.sync_push(p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform public.sync_push_for(auth.uid(), p_changes);
end;
$$;

create or replace function public.sync_pull(p_cursor bigint, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return public.sync_pull_for(auth.uid(), p_cursor, least(greatest(p_limit, 1), 500));
end;
$$;

grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, int) to authenticated;
SQL
```

Check the timezone fix against the local stack after `db reset` (Step 2's Run lines below): in Studio's SQL editor, for a user with `timezone = 'Pacific/Pago_Pago'` (UTC−11) and a completion dated yesterday in that zone, `select public.recalculate_streak('<habit id>'); select current_streak from habit_streaks where habit_id = '<habit id>';` returns 1 even when the UTC date is already two days later than that completion.

Run: `npm test --workspace=packages/sync` → parity test PASS.
Run: `npx supabase db reset` (local stack via `npm run db:start`) → migrations 001–007 apply cleanly.

- [ ] **Step 3: Web data layer: soft deletes and filters**

In `packages/db/src`:
- Every `.from("habits"|"habit_completions"|"journal_entries").select(...)` gets `.is("deleted_at", null)`.
- `removeCompletion` → `.update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })` instead of `.delete()`.
- `deleteHabit`, `deleteJournalEntry` → the same soft-delete update.
- `addCompletion` → `id: completionId(input.habit_id, input.date)`, `updated_at: new Date().toISOString()`, `deleted_at: null` in the upsert (add `@rock_ht/sync` to `packages/db/package.json` deps).
- `updateHabit`, `updateJournalEntry`, `updateCompletionNote`, `updateProfile` → include `updated_at: new Date().toISOString()` (the trigger no longer sets it).

Run: `npm run type-check && npm run lint` → green.

- [ ] **Step 4: Commit**

```bash
git add supabase packages/db packages/types packages/sync
git commit -m "feat(supabase): add sync columns, RPCs and soft deletes for offline clients"
```

### Task 15: Supabase remote + mobile backend

**Files:**
- Create: `packages/sync/src/supabase-remote.ts`, test `packages/sync/src/__tests__/supabase-remote.test.ts`
- Modify: `packages/sync/src/index.ts`, `apps/mobile/lib/sync/supabase-backend.ts`

**Interfaces:**
- Produces: `createSupabaseRemote(client: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }): SyncRemote`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseRemote } from '../supabase-remote'

// Typed mock: an untyped vi.fn(async () => …) has no parameters, so toHaveBeenCalledWith(...) fails type-check.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

describe('createSupabaseRemote', () => {
  it('calls sync_push with changes', async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: null, error: null }))
    await createSupabaseRemote({ rpc }).push([])
    expect(rpc).toHaveBeenCalledWith('sync_push', { p_changes: [] })
  })

  it('calls sync_pull with numeric cursor and normalizes rows', async () => {
    const rpc = vi.fn<Rpc>(async () => ({
      data: { changes: [{ table: 'habits', row: { id: 'h', updated_at: '2026-01-01T00:00:00+00:00', deleted_at: null } }], cursor: '9', hasMore: false },
      error: null,
    }))
    const res = await createSupabaseRemote({ rpc }).pull(null, 100)
    expect(rpc).toHaveBeenCalledWith('sync_pull', { p_cursor: 0, p_limit: 100 })
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.cursor).toBe('9')
  })

  it('keeps the previous cursor on an empty page', async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: { changes: [], cursor: null, hasMore: false }, error: null }))
    expect((await createSupabaseRemote({ rpc }).pull('5', 10)).cursor).toBe('5')
  })

  it('throws rpc errors', async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: null, error: { message: 'not authenticated' } }))
    await expect(createSupabaseRemote({ rpc }).push([])).rejects.toThrow('not authenticated')
  })
})
```

- [ ] **Step 2: Implement**

```ts
import { normalizeChange } from './http-remote'
import type { PullResult, SyncRemote } from './types'

type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export function createSupabaseRemote(client: RpcClient): SyncRemote {
  return {
    async push(changes) {
      const { error } = await client.rpc('sync_push', { p_changes: changes })
      if (error) throw new Error(error.message)
    },
    async pull(cursor, limit): Promise<PullResult> {
      const { data, error } = await client.rpc('sync_pull', { p_cursor: Number(cursor ?? 0), p_limit: limit })
      if (error) throw new Error(error.message)
      const body = data as PullResult
      return { changes: body.changes.map(normalizeChange), cursor: body.cursor ?? cursor, hasMore: body.hasMore }
    },
  }
}
```
Export from `index.ts`. Run `npm test --workspace=packages/sync` → PASS, and `npx tsc --noEmit -p packages/sync` → no errors.

- [ ] **Step 3: Mobile Supabase backend** (Supabase JS is loaded only when chosen)

`apps/mobile/lib/sync/supabase-backend.ts`:
```ts
import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseRemote } from "@rock_ht/sync";
import type { SyncBackend } from "./remote-factory";

export async function supabaseBackend(url: string, anonKey: string): Promise<SyncBackend> {
  const client = createClient(url, anonKey, {
    auth: {
      storage: {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        removeItem: (k) => SecureStore.deleteItemAsync(k),
      },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return {
    remote: createSupabaseRemote(client),
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) throw new Error(error?.message ?? "sign-in failed");
      return data.user.id;
    },
    async signUp(email, password, name) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { name } } });
      if (error || !data.user) throw new Error(error?.message ?? "sign-up failed");
      return data.user.id;
    },
    async signOut() { await client.auth.signOut(); },
    async currentUserId() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },
  };
}
```

- [ ] **Step 4: Verify end-to-end against local Supabase**

Run: `npm run typegen --workspace=apps/mobile && npm run type-check --workspace=apps/mobile` → 0 errors. Run: `scripts/build-apk.sh --install <serial>`.

`npm run db:start`, then in the app: Settings → Sync → Supabase → URL `http://<LAN-IP>:54321` + anon key from `supabase status` → Create account (email confirmation is off in the local `config.toml`; check `[auth.email] enable_confirmations`).
1. Offline habits appear in Studio (`http://localhost:54323`) under `habits`.
2. Log in to the web app (`npm run dev:web`) with the same account and toggle a habit. On the phone, bring the app to the foreground: the change appears.
3. Delete a habit on the phone. It disappears from the web after refresh (soft-delete filter from Task 14).

- [ ] **Step 5: Commit**

```bash
git add packages/sync apps/mobile
git commit -m "feat(sync): add Supabase RPC remote and mobile Supabase backend"
```

---

## Later — Web app without Supabase (separate plan)

Outline only; write a dedicated plan before starting:
- Introduce a `DataClient` interface in `packages/db` matching today's function set (`getHabits`, `addCompletion`, …) with two implementations: the current Supabase one, and `HttpDataClient` calling new `/api/data/*` routes that run parameterized SQL against the self-host Postgres.
- Swap web auth to an `AuthAdapter` (Supabase auth vs Better Auth), selected by `NEXT_PUBLIC_BACKEND=supabase|selfhost`.
- Replace Supabase realtime on web with polling `/api/sync/pull` every 15 s in self-host mode (or Postgres `LISTEN/NOTIFY` over SSE later).
- Billing/AI routes keep working in both modes because they only need the user id.

## Risks and decisions

- **Clock skew:** LWW uses device clocks, so a phone set 1 h ahead wins conflicts for an hour. That's acceptable for single-user habit data. If it becomes a problem, switch `updated_at` to a hybrid logical clock (HLC) string, which keeps the same comparison semantics.
- **Completions merge:** the deterministic id plus LWW means that if one device toggles off and another toggles on for the same day, the later tap wins. That's the intended behaviour.
- **Profiles are update-only via sync:** the server creates the profile at signup, so a push before signup finishes is a no-op, and `claim()` re-queues the profile afterwards.
- **`habit_streaks` on Supabase** remains a server cache for the web app only. Mobile never reads it.
- **Reminders are not context-aware yet:** they fire at the set time even if the habit is already done that day, and `times_per_week` habits are reminded daily. Skipping done days needs per-day one-shot triggers rescheduled after each completion; that is a separate change on top of Task 7's `rebuildReminders`.
- **Backup import restores deletions:** a backup row replaces a local tombstone (Task 8 import rules), because "restore from backup" is the purpose of the feature. Live local rows that are newer still win.
- **Deleting old Supabase-only mobile code** (Task 6) removes realtime on mobile. Foreground/reconnect/5-min sync replaces it, which is enough for one person using several devices.
