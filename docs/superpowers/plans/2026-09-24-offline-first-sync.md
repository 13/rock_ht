# Offline-First Mobile + Pluggable Sync Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile app works fully offline with no account and no backend, and can optionally sync to either a self-hosted backend (Next.js + Postgres in Docker) or Supabase, chosen at runtime.

**Architecture:** On-device SQLite is the source of truth on mobile. Every local write updates the row and appends a snapshot to an `outbox` table in one transaction. A transport-agnostic sync engine (`@rock_ht/sync`) pushes the outbox and pulls remote changes using a monotonic `server_seq` cursor. Rows merge last-write-wins on `updated_at`, and deletes are tombstones (`deleted_at`). Both backends run the same Postgres sync functions (`sync_push_for` / `sync_pull_for`): Supabase exposes them through RPC wrappers that use `auth.uid()`, and the self-hosted Next.js server calls them over `pg` after authenticating the user with Better Auth.

**Tech Stack:** TypeScript, Expo SDK 55 (`expo-sqlite`, `expo-crypto`, `expo-secure-store`), TanStack Query, vitest + better-sqlite3 (tests), Postgres 17, Next.js 16 route handlers, `pg`, Better Auth (+ `@better-auth/expo`), Supabase JS.

## Global Constraints

- TypeScript everywhere; new workspace packages follow the existing layout: `main`/`types`/`exports` point at `./src/index.ts`, no build step (see `packages/utils/package.json`).
- Node 20 in CI (`actions/setup-node` `node-version: 20`), so no `node:sqlite`; tests use `better-sqlite3`.
- The mobile app must start, create habits, toggle completions, journal, and compute streaks with **no network, no account, and no env vars**.
- Supabase stays optional: nothing in `apps/mobile` may read `EXPO_PUBLIC_SUPABASE_*` at import time; Supabase config comes from the runtime sync settings.
- All timestamps crossing the sync boundary are ISO-8601 UTC strings as produced by `Date.prototype.toISOString()` (e.g. `2026-09-24T20:00:00.000Z`). Adapters normalize with `normalizeTimestamp`.
- Completion ids are deterministic: `completionId(habit_id, completed_date)` = UUIDv5 with namespace `6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f`. Postgres uses `uuid_generate_v5` with the same namespace.
- Synced tables: `profiles`, `habits`, `habit_completions`, `journal_entries`. `habit_streaks` is **not** synced; mobile computes streaks with `calculateStreak` from `@rock_ht/utils`.
- Deletes of synced rows are soft (`deleted_at` set, `updated_at` bumped) on every client, including the web app.
- Existing test command stays green: `npm test --workspace=packages/utils`.

## Scope and sequencing

This touches several subsystems. Each phase ends with working, shippable software:

| Phase | Deliverable | Works without |
|---|---|---|
| 1 | `@rock_ht/sync` protocol + engine (pure TS, tested) | everything else |
| 2 | `@rock_ht/local-db` SQLite store (tested on Node) | mobile, servers |
| 3 | Mobile runs fully offline on local-db, no login | any backend |
| 4 | Self-hosted backend in Docker + HTTP sync from mobile | Supabase |
| 5 | Supabase adapter (migration + RPC remote) + web soft-delete fixes | self-host |
| 6 | Web app without Supabase (**separate plan**, outlined only) | — |

Phase 6 (porting the Next.js UI off Supabase auth/queries) is a separate plan. This plan only makes the web **build** without Supabase env (Task 10) so the self-host image can be built.

## File structure

```
packages/sync/                      NEW  transport-agnostic protocol
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                      re-exports
  src/types.ts                      SyncTable, SyncRow, SyncChange, SyncRemote, SyncLocal, PullResult
  src/merge.ts                      isNewer, normalizeTimestamp
  src/ids.ts                        completionId (uuid v5)
  src/engine.ts                     runSync(local, remote)
  src/http-remote.ts                createHttpRemote (self-host)
  src/supabase-remote.ts            createSupabaseRemote (RPC)
  src/__tests__/*.test.ts

packages/local-db/                  NEW  SQLite store over an injectable driver
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts
  src/driver.ts                     SqlDriver, SqlParam
  src/schema.ts                     MIGRATIONS + migrate()
  src/codec.ts                      COLUMNS, toSqlRow, fromSqlRow
  src/store.ts                      createLocalStore → repos + SyncLocal + claim()
  src/__tests__/helpers.ts          better-sqlite3 driver for tests
  src/__tests__/*.test.ts

apps/mobile/
  lib/sqlite-driver.ts              NEW  expo-sqlite → SqlDriver
  lib/local.ts                      NEW  singleton open + migrate
  providers/local-provider.tsx      NEW  LocalProvider/useLocal (store, userId)
  providers/auth-provider.tsx       NEW  replaces supabase-provider; same useAuth() shape
  lib/sync/config.ts                NEW  SyncConfig persisted in SecureStore
  lib/sync/remote-factory.ts        NEW  SyncConfig → SyncRemote + auth
  lib/sync/service.ts               NEW  single-flight sync + triggers
  hooks/use-streaks.ts              NEW
  hooks/use-profile.ts              NEW
  hooks/use-sync.ts                 NEW
  app/sync-settings.tsx             NEW  choose Off / Self-hosted / Supabase, sign in
  hooks/use-habits.ts, use-completions.ts, use-journal.ts     MODIFY  local store
  app/_layout.tsx, app/(tabs)/*.tsx, app/habit/[id].tsx, app/onboarding.tsx  MODIFY
  lib/supabase.ts, lib/offline-queue.ts, providers/supabase-provider.tsx,
  hooks/use-realtime.ts, app/(auth)/*                        DELETE / MOVE

db/selfhost/init/01_schema.sql      NEW  tables without auth.users/RLS
db/selfhost/init/02_sync.sql        NEW  sync functions (identical block to 007)
db/selfhost/init/03_auth.sql        NEW  Better Auth tables (generated)
docker-compose.selfhost.yml         NEW
apps/web/lib/server/db.ts           NEW  pg Pool
apps/web/lib/server/auth.ts         NEW  Better Auth instance
apps/web/app/api/auth/[...all]/route.ts   NEW
apps/web/app/api/sync/push/route.ts NEW
apps/web/app/api/sync/pull/route.ts NEW
supabase/migrations/007_sync.sql    NEW
packages/db/src/*.ts                MODIFY  soft deletes + deleted_at filters
packages/types/src/database.types.ts MODIFY  new columns
```

---

## Phase 1 — Sync protocol

### Task 1: `@rock_ht/sync` package, types, merge rules, completion ids

**Files:**
- Create: `packages/sync/package.json`, `packages/sync/tsconfig.json`, `packages/sync/vitest.config.ts`
- Create: `packages/sync/src/types.ts`, `src/merge.ts`, `src/ids.ts`, `src/index.ts`
- Test: `packages/sync/src/__tests__/merge.test.ts`, `src/__tests__/ids.test.ts`
- Modify: `.github/workflows/test.yml` (run all workspace tests)

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

- [ ] **Step 6: Run every workspace's tests in CI**

In `.github/workflows/test.yml`, replace the last step's command:
```yaml
      - name: Run unit tests
        run: npx turbo run test
```
Run locally: `npx turbo run test`. Expected: `@rock_ht/utils` and `@rock_ht/sync` both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/sync package.json package-lock.json .github/workflows/test.yml
git commit -m "feat(sync): add sync protocol types, LWW merge and deterministic completion ids"
```

### Task 2: Sync engine

**Files:**
- Create: `packages/sync/src/engine.ts`
- Modify: `packages/sync/src/index.ts`
- Test: `packages/sync/src/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `isNewer`.
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

- [ ] **Step 5: Commit**

```bash
git add packages/sync
git commit -m "feat(sync): add push-then-pull sync engine with cursor paging"
```

---

## Phase 2 — Local SQLite store

### Task 3: `@rock_ht/local-db` driver, schema, migrations, codec

**Files:**
- Create: `packages/local-db/package.json`, `tsconfig.json`, `vitest.config.ts` (same shape as Task 1; name `@rock_ht/local-db`)
- Create: `src/driver.ts`, `src/schema.ts`, `src/codec.ts`, `src/index.ts`
- Test: `src/__tests__/helpers.ts`, `src/__tests__/schema.test.ts`, `src/__tests__/codec.test.ts`

**Interfaces:**
- Consumes: `SyncTable`, `SyncRow` from `@rock_ht/sync`.
- Produces:
  - `type SqlParam = string | number | null`
  - `interface SqlDriver { exec(sql: string): Promise<void>; run(sql: string, params?: SqlParam[]): Promise<void>; all<T>(sql: string, params?: SqlParam[]): Promise<T[]>; first<T>(sql: string, params?: SqlParam[]): Promise<T | null>; transaction(fn: () => Promise<void>): Promise<void> }`
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
    "@types/better-sqlite3": "^7.6.12",
    "better-sqlite3": "^11.8.1",
    "typescript": "^5.7.2",
    "vitest": "^3.2.7"
  }
}
```
Run: `npm install`.

- [ ] **Step 2: Test helper (better-sqlite3 → SqlDriver)**

`packages/local-db/src/__tests__/helpers.ts`:
```ts
import Database from 'better-sqlite3'
import type { SqlDriver } from '../driver'

export function openTestDriver(): SqlDriver {
  const db = new Database(':memory:')
  return {
    async exec(sql) { db.exec(sql) },
    async run(sql, params = []) { db.prepare(sql).run(...params) },
    async all(sql, params = []) { return db.prepare(sql).all(...params) as never },
    async first(sql, params = []) { return (db.prepare(sql).get(...params) ?? null) as never },
    async transaction(fn) {
      db.exec('BEGIN')
      try { await fn(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
    },
  }
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
  transaction(fn: () => Promise<void>): Promise<void>
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
    await driver.transaction(async () => {
      await driver.exec(MIGRATIONS[v]!)
      await driver.exec(`PRAGMA user_version = ${v + 1}`)
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

Run: `npm test --workspace=packages/local-db` → PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/local-db package.json package-lock.json
git commit -m "feat(local-db): add SQLite schema, migrations and row codec"
```

### Task 4: Local store repositories + `SyncLocal` + account claim

**Files:**
- Create: `packages/local-db/src/store.ts`
- Modify: `packages/local-db/src/index.ts`
- Test: `packages/local-db/src/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `SqlDriver`, `migrate`, `toSqlRow`, `fromSqlRow`, `completionId`, `runSync` types, `parseFrequency`/`frequencyToJson` from `@rock_ht/utils`, types from `@rock_ht/types`.
- Produces `createLocalStore(deps: LocalStoreDeps): LocalStore` where:
```ts
interface LocalStoreDeps { driver: SqlDriver; newId: () => string; now: () => string }
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
import { completionId, runSync, type SyncRemote, type SyncChange } from '@rock_ht/sync'
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
    const a = s
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

- [ ] **Step 2: Run, verify fail**

Run: `npm test --workspace=packages/local-db` → FAIL (`../store` missing).

- [ ] **Step 3: Implement `store.ts`**

```ts
import { completionId, type OutboxEntry, type SyncChange, type SyncLocal, type SyncRow, type SyncTable } from '@rock_ht/sync'
import { parseFrequency, frequencyToJson } from '@rock_ht/utils'
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
}

export type LocalStore = ReturnType<typeof createLocalStore>

const CURSOR_KEY = 'sync_cursor'

export function createLocalStore({ driver, newId, now }: LocalStoreDeps) {
  async function upsert(table: SyncTable, row: SyncRow): Promise<void> {
    const sql = toSqlRow(table, row)
    const cols = Object.keys(COLUMNS[table])
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
    await driver.run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${updates}`,
      cols.map((c) => sql[c] ?? null),
    )
  }

  /** Local write: row + outbox snapshot in one transaction. */
  async function write(table: SyncTable, row: SyncRow): Promise<void> {
    await driver.transaction(async () => {
      await upsert(table, row)
      await driver.run('INSERT INTO outbox (tbl, row_json) VALUES (?, ?)', [table, JSON.stringify(row)])
    })
  }

  async function getRow(table: SyncTable, id: string): Promise<SyncRow | null> {
    const raw = await driver.first<Record<string, SqlParam>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
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
      id: userId, email: '', display_name: null, avatar_url: null, timezone: 'UTC', theme: 'dark',
      onboarding_completed: false, time_format: '12h', date_format: 'MM/DD/YYYY',
      created_at: ts, updated_at: ts, deleted_at: null,
    }
    // Not queued: the server creates profiles on signup; local edits later are queued.
    await upsert('profiles', row)
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
    const row: SyncRow = {
      ...cur,
      ...rest,
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
      entry_date: input.entry_date ?? ts.slice(0, 10), content: input.content, mood: input.mood ?? null,
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

  async function getMeta(key: string) {
    const r = await driver.first<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', [key])
    return r?.value ?? null
  }

  async function setMeta(key: string, value: string | null) {
    await driver.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  }

  /** Move offline data to a signed-in account and queue all of it for upload. */
  async function claim(fromUserId: string, toUserId: string) {
    await driver.transaction(async () => {
      for (const t of ['habits', 'habit_completions', 'journal_entries'] as const) {
        await driver.run(`UPDATE ${t} SET user_id = ?, updated_at = ? WHERE user_id = ?`, [toUserId, now(), fromUserId])
      }
      await driver.run('UPDATE profiles SET id = ?, updated_at = ? WHERE id = ?', [toUserId, now(), fromUserId])
      await driver.run('DELETE FROM outbox')
      await setMeta(CURSOR_KEY, null)
      for (const t of ['profiles', 'habits', 'habit_completions', 'journal_entries'] as const) {
        const raws = await driver.all<Record<string, SqlParam>>(`SELECT * FROM ${t}`)
        for (const raw of raws) {
          await driver.run('INSERT INTO outbox (tbl, row_json) VALUES (?, ?)', [t, JSON.stringify(fromSqlRow(t, raw))])
        }
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
    getRow,
    getCursor: () => getMeta(CURSOR_KEY),
    async applyRemote(changes: SyncChange[], cursor) {
      await driver.transaction(async () => {
        for (const c of changes) await upsert(c.table, c.row)
        await setMeta(CURSOR_KEY, cursor)
      })
    },
  }

  return {
    ensureProfile, getProfile, updateProfile,
    listHabits, getHabit, createHabit, updateHabit, deleteHabit,
    listCompletions, setCompletion, setCompletionNote,
    listJournal, createJournal, updateJournal, deleteJournal,
    getMeta, setMeta, claim, sync,
  }
}
```

Add `export * from './store'` to `src/index.ts`.

Note on `claim`: the profile is re-queued too, so the server needs the profile to exist before push. Both backends create it at signup (Supabase trigger `handle_new_user`; self-host in Task 9), and `sync_push_for` only updates profiles.

- [ ] **Step 4: Run, verify pass**

Run: `npm test --workspace=packages/local-db` → PASS (10 tests).
Run: `npx tsc --noEmit -p packages/local-db` → no errors. If `UpdateHabitInput` spreading trips `exactOptionalPropertyTypes`, filter `undefined` values out of `rest` before spreading.

- [ ] **Step 5: Commit**

```bash
git add packages/local-db
git commit -m "feat(local-db): add local store with outbox, tombstones and account claim"
```

---

## Phase 3 — Mobile fully offline

### Task 5: expo-sqlite driver, LocalProvider, offline AuthProvider

**Files:**
- Create: `apps/mobile/lib/sqlite-driver.ts`, `apps/mobile/lib/local.ts`, `apps/mobile/providers/local-provider.tsx`, `apps/mobile/providers/auth-provider.tsx`
- Modify: `apps/mobile/providers/index.tsx`, `apps/mobile/package.json`
- Delete: `apps/mobile/providers/supabase-provider.tsx` (in Task 7, once no screen imports it)

**Interfaces:**
- Consumes: `SqlDriver`, `migrate`, `createLocalStore`, `LocalStore`.
- Produces:
  - `createExpoSqliteDriver(name?: string): Promise<SqlDriver>`
  - `openLocalStore(): Promise<LocalStore>` (memoized)
  - `useLocal(): { store: LocalStore; userId: string }`; `LocalProvider` renders `null` until the DB is ready (the splash screen stays up)
  - `useAuth(): { user: { id: string; email: string | null; created_at: string } ; loading: boolean; signOut: () => Promise<void> }` with the same call sites as today. `user` is always non-null (the local user when offline).
  - meta keys: `local_user_id`, `account_user_id`

- [ ] **Step 1: Add native deps**

Run in `apps/mobile`: `npx expo install expo-sqlite expo-crypto`
Add to `apps/mobile/package.json` dependencies: `"@rock_ht/local-db": "*"`, `"@rock_ht/sync": "*"`. Run `npm install` at root.
Add `"expo-sqlite"` to `plugins` in `apps/mobile/app.json`.

- [ ] **Step 2: Driver**

`apps/mobile/lib/sqlite-driver.ts`:
```ts
import * as SQLite from "expo-sqlite";
import type { SqlDriver, SqlParam } from "@rock_ht/local-db";

export async function createExpoSqliteDriver(name = "rock_ht.db"): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParam[] = []) => { await db.runAsync(sql, params); },
    all: (sql, params: SqlParam[] = []) => db.getAllAsync(sql, params),
    first: (sql, params: SqlParam[] = []) => db.getFirstAsync(sql, params),
    transaction: (fn) => db.withTransactionAsync(fn),
  };
}
```

- [ ] **Step 3: Store singleton**

`apps/mobile/lib/local.ts`:
```ts
import * as Crypto from "expo-crypto";
import { createLocalStore, migrate, type LocalStore } from "@rock_ht/local-db";
import { createExpoSqliteDriver } from "./sqlite-driver";

let pending: Promise<LocalStore> | null = null;

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
import type { LocalStore } from "@rock_ht/local-db";
import { openLocalStore, resolveUserId } from "@/lib/local";

type LocalContext = { store: LocalStore; userId: string; refreshUserId: () => Promise<void> };

const Context = createContext<LocalContext | undefined>(undefined);

export function LocalProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<{ store: LocalStore; userId: string } | null>(null);

  const load = useCallback(async () => {
    const store = await openLocalStore();
    const userId = await resolveUserId(store);
    await store.ensureProfile(userId);
    setValue({ store, userId });
  }, []);

  useEffect(() => { void load(); }, [load]);

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

/** Offline-first: there is always a user. Signing out of a sync backend is handled in Task 8. */
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

- [ ] **Step 5: Type-check**

Run: `npm run type-check --workspace=apps/mobile`. Expected: errors only in files still importing `@/providers/supabase-provider` (fixed in Tasks 6–7). No errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile package-lock.json
git commit -m "feat(mobile): open local SQLite store and provide offline user"
```

### Task 6: Hooks on the local store (habits, completions, journal, streaks, profile)

**Files:**
- Modify: `apps/mobile/hooks/use-habits.ts`, `use-completions.ts`, `use-journal.ts`
- Create: `apps/mobile/hooks/use-streaks.ts`, `apps/mobile/hooks/use-profile.ts`
- Delete: `apps/mobile/lib/offline-queue.ts`

**Interfaces:**
- Consumes: `useLocal()`, `LocalStore` methods, `calculateStreak` from `@rock_ht/utils`.
- Produces (return shapes of existing hooks unchanged):
  - `useHabits()` → `{ habits, isLoading, error, createHabit, updateHabit, archiveHabit, deleteHabit, isCreating }`
  - `useCompletions()` → same as today minus `flushQueue`
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
import { today, yesterday } from "@rock_ht/utils";
import type { ToggleCompletionInput } from "@rock_ht/types";

export const TODAY_KEY = ["completions", "today"] as const;
export const MONTH_KEY = ["completions", "month"] as const;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export function useCompletions() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();
  const todayStr = today();
  const yesterdayStr = yesterday();

  const todayQuery = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => store.listCompletions(userId, { startDate: todayStr, endDate: todayStr }),
  });
  const monthQuery = useQuery({
    queryKey: MONTH_KEY,
    queryFn: () => store.listCompletions(userId, { startDate: daysAgo(29), endDate: todayStr }),
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
Local SQLite writes take about 1 ms, so the old optimistic `onMutate` is no longer needed. Remove any caller of `flushQueue` (`grep -rn flushQueue apps/mobile`).

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
Check `parseFrequency` accepts an already-parsed `Frequency` (`packages/utils/src/habits.ts`). If it only accepts `Json`, pass `h.frequency` directly, since `listHabits` already returns `HabitWithFrequency`.

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

### Task 7: Screens off Supabase; no login required

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/habits.tsx`, `app/(tabs)/analytics.tsx`, `app/habit/[id].tsx`, `app/onboarding.tsx`, `app/(tabs)/settings.tsx`
- Delete: `apps/mobile/lib/supabase.ts`, `apps/mobile/providers/supabase-provider.tsx`, `apps/mobile/hooks/use-realtime.ts`
- Move: `apps/mobile/app/(auth)/*`: kept for Task 8, rewritten there. In this task, delete the `(auth)` group (git history keeps the UI for reuse).

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

- [ ] **Step 3: `app/habit/[id].tsx`**

Replace the `getCompletions` query with `const { data: completions = [], isLoading: completionsLoading } = useHabitCompletions(id);` and the streak query with `const { streaks } = useStreaks();`. Replace any `updateCompletionNote(supabase, …)` with `store.setCompletionNote(habitId, date, note)` via `const { store } = useLocal()`, then invalidate `["completions"]`.

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

In `app/(tabs)/settings.tsx`, keep the `useAuth()` usage. Hide the "Sign out" row when `user.email` is null (Task 8 adds a "Sync" row there).

- [ ] **Step 7: Delete Supabase-only files and verify nothing references them**

```bash
git rm apps/mobile/lib/supabase.ts apps/mobile/providers/supabase-provider.tsx apps/mobile/hooks/use-realtime.ts
git rm -r "apps/mobile/app/(auth)"
grep -rn "supabase\|@rock_ht/db\|offline-queue\|use-realtime" apps/mobile --include=*.ts --include=*.tsx -l | grep -v node_modules
```
Expected: no output.

- [ ] **Step 8: Verify**

Run: `npm run type-check --workspace=apps/mobile` → 0 errors.
Run: `npm run lint` → 0 errors.
Manual, on a device or emulator in airplane mode, with no `.env.local` (`mv apps/mobile/.env.local /tmp/`):
`cd apps/mobile/android && NODE_PATH=$PWD/../node_modules ./gradlew assembleRelease` and install the APK. Then:
1. The app opens straight to onboarding. Complete it.
2. Create 2 habits and toggle one. The progress ring updates.
3. Force-quit and reopen: data persists and the streak shows 1.
4. Add a journal entry, then delete it. It disappears.

- [ ] **Step 9: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): run fully offline on local store, drop Supabase client and login gate"
```

---

## Phase 4 — Self-hosted backend in Docker + mobile sync

### Task 8: Mobile sync settings, remote factory and sync service

**Files:**
- Create: `apps/mobile/lib/sync/config.ts`, `lib/sync/remote-factory.ts`, `lib/sync/service.ts`, `hooks/use-sync.ts`, `app/sync-settings.tsx`
- Create: `packages/sync/src/http-remote.ts` + test `packages/sync/src/__tests__/http-remote.test.ts`
- Modify: `packages/sync/src/index.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/settings.tsx`, `apps/mobile/providers/auth-provider.tsx`, `apps/mobile/package.json`

**Interfaces:**
- Produces:
  - `createHttpRemote(opts: { baseUrl: string; fetch?: typeof fetch; getHeaders: () => Promise<Record<string, string>> }): SyncRemote`
  - `type SyncConfig = { kind: "off" } | { kind: "selfhost"; baseUrl: string } | { kind: "supabase"; url: string; anonKey: string }`
  - `loadSyncConfig(): Promise<SyncConfig>`, `saveSyncConfig(c: SyncConfig): Promise<void>`
  - `interface SyncBackend { remote: SyncRemote; signIn(email: string, password: string): Promise<string>; signUp(email: string, password: string, name: string): Promise<string>; signOut(): Promise<void>; currentUserId(): Promise<string | null> }` (sign-in/up return the account user id)
  - `createBackend(c: SyncConfig): Promise<SyncBackend | null>` (`null` for `off`)
  - `syncNow(): Promise<SyncReport | null>`: single-flight, returns `null` when off or signed out
  - `useSync(): { status: "off" | "idle" | "syncing" | "error"; lastSyncedAt: string | null; syncNow: () => void }`
- HTTP contract (implemented in Task 9):
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
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test/', fetch, getHeaders: async () => ({ Cookie: 'a=b' }) })
    await r.push([])
    expect(fetch).toHaveBeenCalledWith('https://x.test/api/sync/push', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Cookie: 'a=b', 'Content-Type': 'application/json' }),
    }))
  })

  it('GETs pull with cursor and normalizes timestamps', async () => {
    const body = { changes: [{ table: 'habits', row: { id: 'h', updated_at: '2026-01-01T00:00:00+00:00', deleted_at: null } }], cursor: '7', hasMore: false }
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    const res = await r.pull('3', 50)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=3&limit=50')
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.cursor).toBe('7')
  })

  it('throws on non-2xx', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 401 }))
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
Export from `index.ts`. Run `npm test --workspace=packages/sync` → PASS.

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

- [ ] **Step 4: Remote factory (self-host now, Supabase in Task 12)**

Install: in `apps/mobile`, `npm install better-auth @better-auth/expo` (use the same major version as `apps/web` in Task 9).

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
    plugins: [expoClient({ scheme: "rock_ht", storagePrefix: "rock_ht", storage: SecureStore })],
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
Until Task 12, create `apps/mobile/lib/sync/supabase-backend.ts` with:
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

export function useSync() {
  const qc = useQueryClient();
  const [state, setState] = useState<{ syncing: boolean; error: unknown; at: string | null }>({ syncing: false, error: null, at: null });
  const [off, setOff] = useState(true);

  useEffect(() => { void loadSyncConfig().then((c) => setOff(c.kind === "off")); }, []);
  useEffect(() => subscribeSync(setState), []);

  const run = () => { void syncNow().then((r) => { if (r && r.pulled > 0) qc.invalidateQueries(); }); };

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
Call `useSyncTriggers()` inside `OnboardingGuard` in `app/_layout.tsx`. In each mutation's `onSettled` in the hooks from Task 6, also call `void syncNow()` (import from `@/lib/sync/service`). It's a no-op when sync is off.

- [ ] **Step 7: Sync settings screen**

`apps/mobile/app/sync-settings.tsx`: a form with a three-way segmented control (Off / Self-hosted / Supabase), fields per kind (server URL; or Supabase URL + anon key), then email + password (+ name for sign-up) and "Sign in" / "Create account" buttons. Reuse the layout and styling from the deleted `app/(auth)/login.tsx` (`git show HEAD~1:apps/mobile/app/\(auth\)/login.tsx`). Submit handler:
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
  queryClient.invalidateQueries();
  router.back();
}
```
(`store`, `refreshUserId` from `useLocal()`; `resolveUserId` from `@/lib/local`.)

"Disconnect" button: `await backend.signOut(); await store.setMeta("account_user_id", null); await saveSyncConfig({ kind: "off" }); await refreshUserId();`. Data stays on the device under the account id. On disconnect, also `store.setMeta("local_user_id", accountId)` so the offline user keeps its rows.

In `app/(tabs)/settings.tsx` add a "Sync" row showing `useSync().status` and `lastSyncedAt` that navigates to `/sync-settings`. In `auth-provider.tsx`, make `signOut` do the same as Disconnect.

- [ ] **Step 8: Verify**

`npm run type-check --workspace=apps/mobile`, `npm test --workspace=packages/sync` → green. An end-to-end check happens after Task 9.

- [ ] **Step 9: Commit**

```bash
git add packages/sync apps/mobile package-lock.json
git commit -m "feat(mobile): add pluggable sync settings, HTTP remote and background sync triggers"
```

### Task 9: Self-hosted Postgres schema, Better Auth and `/api/sync` in Next.js

**Files:**
- Create: `db/selfhost/init/01_schema.sql`, `db/selfhost/init/02_sync.sql`, `db/selfhost/init/03_auth.sql`
- Create: `apps/web/lib/server/db.ts`, `apps/web/lib/server/auth.ts`, `apps/web/app/api/auth/[...all]/route.ts`, `apps/web/app/api/sync/push/route.ts`, `apps/web/app/api/sync/pull/route.ts`
- Create: `apps/web/lib/server/__tests__/sync.int.test.ts` (runs against Docker Postgres), `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: HTTP contract from Task 8; `SyncChange`, `PullResult`.
- Produces SQL functions shared with Supabase (Task 11):
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
  entry_date date not null default current_date,
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

- [ ] **Step 2: Sync functions (`02_sync.sql`)**: this block is copied verbatim into `supabase/migrations/007_sync.sql` in Task 11. A parity test enforces that.

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
        display_name = r->>'display_name',
        avatar_url = r->>'avatar_url',
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

Run in `apps/web`: `npm install better-auth @better-auth/expo pg && npm install -D @types/pg`

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
Check the installed Better Auth version's docs for the exact option names `advanced.database.generateId` and `databaseHooks.user.create.after` (`node_modules/better-auth/dist/*.d.ts`). Adjust if they're named differently.

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
DATABASE_URL=postgres://x npx @better-auth/cli@latest generate --config lib/server/auth.ts --output ../../db/selfhost/init/03_auth.sql -y
```
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
Expected: 3 passing.

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

### Task 10: Web builds without Supabase env + `docker-compose.selfhost.yml`

**Files:**
- Modify: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/middleware.ts`, `apps/web/providers/supabase-provider.tsx`
- Create: `apps/web/lib/supabase/config.ts`, `docker-compose.selfhost.yml`, `.env.selfhost.example`
- Modify: `.github/workflows/deploy-web.yml` (build-args fall back to empty)

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

- [ ] **Step 3: Compose file**

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

- [ ] **Step 4: End-to-end manual check**

```bash
cp .env.selfhost.example .env.selfhost  # edit values; PUBLIC_URL=http://<LAN-IP>:3000 for phone testing
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/sync/pull   # expect 401
```
On the phone (APK from Task 7), with existing offline data:
1. Settings → Sync → Self-hosted → `http://<LAN-IP>:3000` → Create account. Status shows "idle" with a timestamp.
2. `docker compose exec db psql -U rock_ht -c "select title from habits"` lists the offline habits.
3. Install on a second device or emulator, sign in with the same account: habits and completions appear.
4. Toggle a habit on device B in airplane mode, reconnect, and pull to refresh on device A: the change shows up.

Android blocks cleartext HTTP by default. For LAN testing either use HTTPS (e.g. Caddy in front) or add `expo-build-properties` with `android.usesCleartextTraffic: true` for debug builds only.

- [ ] **Step 5: Commit**

```bash
git add apps/web docker-compose.selfhost.yml .env.selfhost.example .github/workflows/deploy-web.yml
git commit -m "feat(selfhost): build web without Supabase env and add docker compose for self-hosting"
```

---

## Phase 5 — Supabase as a pluggable sync backend

### Task 11: Supabase migration 007 + web client soft deletes

**Files:**
- Create: `supabase/migrations/007_sync.sql`
- Create: `packages/sync/src/__tests__/sql-parity.test.ts`
- Modify: `packages/types/src/database.types.ts` (add `updated_at`, `deleted_at`, `server_seq` to the synced tables' Row/Insert/Update, and add the `sync_push`/`sync_pull` Functions)
- Modify: `packages/db/src/habits.ts`, `completions.ts`, `journal.ts`, `streaks.ts` if it reads completions directly
- Modify: `supabase/migrations/003_functions_triggers.sql`: **no**; override in 007 instead

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

```sql
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

-- Streak cache must ignore tombstoned completions and react to soft deletes
-- (recalculate_streak body from 003 with `and deleted_at is null` added to every
--  select from habit_completions; copy it here and edit, then:)
create or replace trigger on_completion_updated
  after update on public.habit_completions
  for each row execute function public.handle_completion_insert();

-- <paste the SYNC FUNCTIONS block from db/selfhost/init/02_sync.sql here, markers included>

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
```
Copy `recalculate_streak` from `003_functions_triggers.sql` into 007 as `create or replace`, adding `and deleted_at is null` to each `habit_completions` query. Leave the placeholder comment out of the final file: paste the actual block.

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

### Task 12: Supabase remote + mobile backend

**Files:**
- Create: `packages/sync/src/supabase-remote.ts`, test `packages/sync/src/__tests__/supabase-remote.test.ts`
- Modify: `packages/sync/src/index.ts`, `apps/mobile/lib/sync/supabase-backend.ts`

**Interfaces:**
- Produces: `createSupabaseRemote(client: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }): SyncRemote`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSupabaseRemote } from '../supabase-remote'

describe('createSupabaseRemote', () => {
  it('calls sync_push with changes', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    await createSupabaseRemote({ rpc }).push([])
    expect(rpc).toHaveBeenCalledWith('sync_push', { p_changes: [] })
  })

  it('calls sync_pull with numeric cursor and normalizes rows', async () => {
    const rpc = vi.fn(async () => ({
      data: { changes: [{ table: 'habits', row: { id: 'h', updated_at: '2026-01-01T00:00:00+00:00', deleted_at: null } }], cursor: '9', hasMore: false },
      error: null,
    }))
    const res = await createSupabaseRemote({ rpc }).pull(null, 100)
    expect(rpc).toHaveBeenCalledWith('sync_pull', { p_cursor: 0, p_limit: 100 })
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.cursor).toBe('9')
  })

  it('keeps the previous cursor on an empty page', async () => {
    const rpc = vi.fn(async () => ({ data: { changes: [], cursor: null, hasMore: false }, error: null }))
    expect((await createSupabaseRemote({ rpc }).pull('5', 10)).cursor).toBe('5')
  })

  it('throws rpc errors', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'not authenticated' } }))
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
Export from `index.ts`. Run `npm test --workspace=packages/sync` → PASS.

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

`npm run db:start`, then in the app: Settings → Sync → Supabase → URL `http://<LAN-IP>:54321` + anon key from `supabase status` → Create account (email confirmation is off in the local `config.toml`; check `[auth.email] enable_confirmations`).
1. Offline habits appear in Studio (`http://localhost:54323`) under `habits`.
2. Log in to the web app (`npm run dev:web`) with the same account and toggle a habit. On the phone, bring the app to the foreground: the change appears.
3. Delete a habit on the phone. It disappears from the web after refresh (soft-delete filter from Task 11).

- [ ] **Step 5: Commit**

```bash
git add packages/sync apps/mobile
git commit -m "feat(sync): add Supabase RPC remote and mobile Supabase backend"
```

---

## Phase 6 — Web app without Supabase (separate plan)

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
- **Deleting old Supabase-only mobile code** (Task 7) removes realtime on mobile. Foreground/reconnect/5-min sync replaces it, which is enough for one person using several devices.
