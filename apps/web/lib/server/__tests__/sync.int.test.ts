// Integration tests for db/selfhost/init/02_sync.sql against a real Postgres (DATABASE_URL).
// Run: npm run test:int --workspace=apps/web
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { completionId } from '@rock_ht/sync'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const user = randomUUID()
const other = randomUUID()
const ts = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString()
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

type Pulled = { changes: { table: string; row: Record<string, unknown> }[]; cursor: string | null; hasMore: boolean }

async function push(u: string, changes: unknown[], db: Pool | PoolClient = pool) {
  await db.query('select public.sync_push_for($1, $2::jsonb)', [u, JSON.stringify(changes)])
}
async function pull(u: string, cursor: number | string = 0, limit = 1000, db: Pool | PoolClient = pool) {
  const { rows } = await db.query('select public.sync_pull_for($1, $2, $3) as r', [u, cursor, limit])
  return rows[0].r as Pulled
}
async function newUser(email = 'n@y.z') {
  const u = randomUUID()
  await pool.query('insert into public.profiles (id, email) values ($1, $2)', [u, email])
  return u
}
const habit = (id: string, title: string, m: number, extra: Record<string, unknown> = {}) => ({
  table: 'habits',
  row: { id, title, icon: '✨', color: '#fff', frequency: { type: 'daily' }, target_value: 1,
         reminder_enabled: false, is_archived: false, sort_order: 0,
         created_at: ts(0), updated_at: ts(m), deleted_at: null, ...extra },
})
const completion = (habitId: string, date: string, m: number, extra: Record<string, unknown> = {}) => ({
  table: 'habit_completions',
  row: { id: completionId(habitId, date), habit_id: habitId, completed_date: date, value: 1, note: null,
         created_at: ts(0), updated_at: ts(m), deleted_at: null, ...extra },
})
const journal = (id: string, habitId: string | null, m: number) => ({
  table: 'journal_entries',
  row: { id, habit_id: habitId, entry_date: '2026-01-01', content: 'hi', mood: 3,
         created_at: ts(0), updated_at: ts(m), deleted_at: null },
})
const profile = (u: string, m: number, extra: Record<string, unknown> = {}) => ({
  table: 'profiles',
  row: { id: u, email: '', display_name: null, avatar_url: null, timezone: 'Europe/Berlin', theme: 'forest',
         onboarding_completed: true, time_format: '24h', date_format: 'YYYY-MM-DD',
         created_at: ts(0), updated_at: ts(m), deleted_at: null, ...extra },
})
async function one<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | undefined> {
  return (await pool.query(sql, params)).rows[0] as T | undefined
}

beforeAll(async () => {
  for (const u of [user, other]) {
    await pool.query("insert into public.profiles (id, email) values ($1, 'x@y.z')", [u])
  }
})

afterAll(async () => {
  await pool.end()
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
    const u = await newUser('p@y.z')
    await push(u, Array.from({ length: 3 }, (_, i) => habit(randomUUID(), `h${i}`, 1)))
    const first = await pull(u, 0, 2)
    expect(first.changes).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const second = await pull(u, Number(first.cursor), 2)
    expect(second.changes).toHaveLength(2) // profile row sorts first (lowest seq), so page 2 = h1, h2
    expect(second.hasMore).toBe(false)
  })

  it('returns a null cursor and hasMore=false for an empty page', async () => {
    const u = await newUser()
    const first = await pull(u)
    const empty = await pull(u, Number(first.cursor))
    expect(empty).toEqual({ changes: [], cursor: null, hasMore: false })
  })
})

// Carry-over 1: server_seq is taken in a trigger, but transactions can commit out of seq order.
describe('cursor gaps (per-user advisory lock)', () => {
  it('serializes a second push for the same user until the first commits, so no puller skips a row', async () => {
    const u = await newUser()
    const { cursor: start } = await pull(u)
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query('begin')
      await push(u, [habit(randomUUID(), 'slow', 1)], a) // takes seq s1, not yet committed
      let bDone = false
      const bPush = push(u, [habit(randomUUID(), 'fast', 1)], b).then(() => { bDone = true })
      await new Promise((r) => setTimeout(r, 300))
      // Without the lock, B would commit seq s2 > s1 now, a puller would see only s2 and store
      // cursor = s2, and s1 would never be pulled.
      expect(bDone).toBe(false)
      expect((await pull(u, start ?? 0)).changes).toHaveLength(0)
      await a.query('commit')
      await bPush
      const after = await pull(u, start ?? 0)
      expect(after.changes.map((c) => c.row.title)).toEqual(['slow', 'fast'])
    } finally {
      // Destroy rather than return to the pool: a failed assertion may leave a transaction open.
      a.release(true)
      b.release(true)
    }
  })

  it('also serializes writers that bypass sync_push_for (e.g. a web app insert), via the trigger', async () => {
    const u = await newUser()
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query('begin')
      await a.query("insert into public.habits (user_id, title) values ($1, 'web')", [u])
      let bDone = false
      const bInsert = b.query("insert into public.habits (user_id, title) values ($1, 'web2')", [u])
        .then(() => { bDone = true })
      await new Promise((r) => setTimeout(r, 300))
      expect(bDone).toBe(false)
      await a.query('commit')
      await bInsert
      const titles = (await pull(u)).changes.filter((c) => c.table === 'habits').map((c) => c.row.title)
      expect(titles).toEqual(['web', 'web2'])
    } finally {
      // Destroy rather than return to the pool: a failed assertion may leave a transaction open.
      a.release(true)
      b.release(true)
    }
  })

  it('does not serialize different users', async () => {
    const u1 = await newUser()
    const u2 = await newUser()
    const a = await pool.connect()
    try {
      await a.query('begin')
      await push(u1, [habit(randomUUID(), 'u1', 1)], a)
      await push(u2, [habit(randomUUID(), 'u2', 1)]) // resolves while u1's transaction is open
      await a.query('commit')
    } finally {
      a.release(true)
    }
  })
})

// Carry-over 2: Hermes' Date parser needs millisecond ISO strings with a 'Z'.
describe('timestamp format', () => {
  it('emits created_at/updated_at/deleted_at as millisecond UTC ISO strings, even for now() writes', async () => {
    const u = await newUser()
    const id = randomUUID()
    await push(u, [habit(id, 'pushed', 7, { deleted_at: ts(8) })])
    // A web-style write: microsecond now() values.
    await pool.query("insert into public.habits (user_id, title) values ($1, 'web')", [u])
    await pool.query("insert into public.journal_entries (user_id, entry_date, content, deleted_at) values ($1, '2026-01-02', 'x', now())", [u])
    const { changes } = await pull(u)
    expect(changes.length).toBe(4)
    for (const { row } of changes) {
      expect(row.created_at).toMatch(ISO_MS)
      expect(row.updated_at).toMatch(ISO_MS)
      if (row.deleted_at !== null) expect(row.deleted_at).toMatch(ISO_MS)
      expect(row).not.toHaveProperty('server_seq')
    }
    const pushed = changes.find((c) => c.row.id === id)!.row
    expect(pushed.updated_at).toBe(ts(7))
    expect(pushed.deleted_at).toBe(ts(8))
    expect(pushed.created_at).toBe(ts(0))
  })

  it('round-trips a pushed row exactly (the client compares toISOString() strings)', async () => {
    const u = await newUser()
    const h = habit(randomUUID(), 'exact', 3, { updated_at: '2026-03-04T05:06:07.089Z' })
    await push(u, [h])
    const row = (await pull(u)).changes.find((c) => c.row.id === h.row.id)!.row
    expect(row.updated_at).toBe('2026-03-04T05:06:07.089Z')
    expect(new Date(row.updated_at as string).toISOString()).toBe(row.updated_at)
  })
})

// Carry-over 3 (the signup hook itself is covered in routes.int.test.ts).
describe('signup profile timestamp', () => {
  it('lets a device whose clock runs behind the server win the first profile push', async () => {
    const u = randomUUID()
    // What the better-auth user.create.after hook writes (SIGNUP_PROFILE_UPDATED_AT).
    await pool.query(
      "insert into public.profiles (id, email, display_name, updated_at) values ($1, 's@y.z', 'Sam', '1970-01-01T00:00:00.001Z')",
      [u],
    )
    const behind = new Date(Date.now() - 3600_000).toISOString()
    await push(u, [profile(u, 0, { updated_at: behind, display_name: null })])
    const p = await one('select timezone, onboarding_completed, theme, display_name, email from public.profiles where id = $1', [u])
    expect(p).toEqual({ timezone: 'Europe/Berlin', onboarding_completed: true, theme: 'forest', display_name: 'Sam', email: 's@y.z' })
  })
})

// Carry-over 4.
describe('onboarding flag merge', () => {
  it('keeps onboarding_completed = true when a newer push says false', async () => {
    const u = await newUser()
    await pool.query('update public.profiles set onboarding_completed = true, updated_at = $2 where id = $1', [u, ts(0)])
    await push(u, [profile(u, 10, { onboarding_completed: false })])
    expect(await one('select onboarding_completed, timezone from public.profiles where id = $1', [u]))
      .toEqual({ onboarding_completed: true, timezone: 'Europe/Berlin' })
  })

  it('sets onboarding_completed = true from a push that loses last-write-wins, without taking its other fields', async () => {
    const u = await newUser()
    await pool.query("update public.profiles set theme = 'sunset', updated_at = $2 where id = $1", [u, ts(20)])
    const { cursor } = await pull(u)
    await push(u, [profile(u, 10, { onboarding_completed: true, theme: 'forest' })])
    expect(await one('select onboarding_completed, theme from public.profiles where id = $1', [u]))
      .toEqual({ onboarding_completed: true, theme: 'sunset' })
    // The merged row is re-published (newer seq and updated_at), so every device pulls it.
    const again = await pull(u, Number(cursor))
    expect(again.changes).toHaveLength(1)
    expect(again.changes[0]!.row.updated_at as string > ts(20)).toBe(true)
  })
})

// Carry-over 5: one bad change must not block the queue.
describe('per-change error isolation', () => {
  it('skips a change that fails and still applies the rest of the batch', async () => {
    const u = await newUser()
    const good = randomUUID()
    await expect(push(u, [
      habit(randomUUID(), 'bad-uuid', 1, { id: 'not-a-uuid' }),
      habit(randomUUID(), 'bad-int', 1, { target_value: 'many' }),
      { table: 'no_such_table', row: { id: randomUUID(), updated_at: ts(1), deleted_at: null } },
      profile(u, 5, { theme: 'neon' }), // check constraint
      { table: 'journal_entries', row: { id: randomUUID(), updated_at: ts(1), deleted_at: null } }, // no content/entry_date
      habit(good, 'good', 1),
    ])).resolves.toBeUndefined()
    const titles = (await pull(u)).changes.filter((c) => c.table === 'habits').map((c) => c.row.title)
    expect(titles).toEqual(['good'])
    expect((await one('select theme from public.profiles where id = $1', [u]))?.theme).toBe('dark')
  })

  it('writes a journal entry whose habit is missing with habit_id = null', async () => {
    const u = await newUser()
    const j = randomUUID()
    await push(u, [journal(j, randomUUID(), 1)])
    expect(await one('select habit_id, content from public.journal_entries where id = $1', [j]))
      .toEqual({ habit_id: null, content: 'hi' })
  })

  it("writes a journal entry pointing at another user's habit with habit_id = null", async () => {
    const u = await newUser()
    const foreign = randomUUID()
    await push(other, [habit(foreign, 'theirs', 1)])
    const j = randomUUID()
    await push(u, [journal(j, foreign, 1)])
    expect(await one('select habit_id, user_id from public.journal_entries where id = $1', [j]))
      .toEqual({ habit_id: null, user_id: u })
  })

  it('keeps a journal entry linked to its own habit', async () => {
    const u = await newUser()
    const h = randomUUID()
    const j = randomUUID()
    await push(u, [habit(h, 'mine', 1), journal(j, h, 1)])
    expect((await one('select habit_id from public.journal_entries where id = $1', [j]))?.habit_id).toBe(h)
  })
})

// Carry-over 6.
describe('completion ids', () => {
  it('public.completion_id matches the client derivation (@rock_ht/sync completionId)', async () => {
    for (const [h, d] of [[randomUUID(), '2026-01-01'], ['6D2F3B8E-8C1A-4B7E-9F2D-5A4C3E2B1D0F', '2024-02-29']] as const) {
      const row = await one<{ id: string }>('select public.completion_id($1::uuid, $2::date)::text as id', [h, d])
      expect(row?.id).toBe(completionId(h.toLowerCase(), d))
    }
  })

  it('merges a device completion with one a server writer created for the same habit and day', async () => {
    const u = await newUser()
    const h = randomUUID()
    await push(u, [habit(h, 'h', 1)])
    await pool.query(
      `insert into public.habit_completions (id, habit_id, user_id, completed_date, value, updated_at)
       values (public.completion_id($1, '2026-01-05'), $1, $2, '2026-01-05', 1, $3)`,
      [h, u, ts(1)],
    )
    await push(u, [completion(h, '2026-01-05', 9, { value: 4 })])
    const rows = (await pool.query('select id, value from public.habit_completions where habit_id = $1', [h])).rows
    expect(rows).toEqual([{ id: completionId(h, '2026-01-05'), value: 4 }])
  })
})

// Carry-over 8.
describe('orphan completions', () => {
  it("silently drops a completion whose habit belongs to another user, leaving theirs untouched", async () => {
    const u = await newUser()
    const foreign = randomUUID()
    await push(other, [habit(foreign, 'theirs', 1), completion(foreign, '2026-01-01', 1)])
    await expect(push(u, [completion(foreign, '2026-01-01', 50, { value: 99 })])).resolves.toBeUndefined()
    await expect(push(u, [completion(foreign, '2026-01-02', 50)])).resolves.toBeUndefined()
    const rows = (await pool.query('select user_id, value, completed_date::text as d from public.habit_completions where habit_id = $1', [foreign])).rows
    expect(rows).toEqual([{ user_id: other, value: 1, d: '2026-01-01' }])
  })

  it('applies completions after their parent habit in the same batch', async () => {
    const u = await newUser()
    const h = randomUUID()
    await push(u, [habit(h, 'parent', 1), completion(h, '2026-01-01', 1), completion(h, '2026-01-02', 1)])
    const { changes } = await pull(u)
    expect(changes.filter((c) => c.table === 'habit_completions').map((c) => c.row.completed_date))
      .toEqual(['2026-01-01', '2026-01-02'])
  })

  it('skips (without failing the push) a completion whose habit does not exist', async () => {
    const u = await newUser()
    const missing = randomUUID()
    await expect(push(u, [completion(missing, '2026-01-01', 1), habit(randomUUID(), 'after', 1)])).resolves.toBeUndefined()
    expect(await one('select 1 from public.habit_completions where habit_id = $1', [missing])).toBeUndefined()
    expect((await pull(u)).changes.some((c) => c.row.title === 'after')).toBe(true)
  })
})

// Carry-over 9.
describe('profile upsert on push', () => {
  it('creates the profile row when the sign-up hook never did, so the rest of the push applies', async () => {
    const u = randomUUID()
    const h = randomUUID()
    await push(u, [profile(u, 3, { email: 'late@y.z', display_name: 'Late' }), habit(h, 'after-profile', 3)])
    expect(await one('select email, display_name, timezone, onboarding_completed, updated_at from public.profiles where id = $1', [u]))
      .toEqual({ email: 'late@y.z', display_name: 'Late', timezone: 'Europe/Berlin', onboarding_completed: true, updated_at: new Date(ts(3)) })
    expect((await pull(u)).changes.map((c) => c.table)).toEqual(['profiles', 'habits'])
  })

  it('ignores a pushed profile row id: a device only ever writes its own profile', async () => {
    const u = await newUser()
    await pool.query('update public.profiles set updated_at = $2 where id = $1', [u, ts(0)])
    await push(u, [profile(other, 40, { theme: 'midnight' })])
    expect((await one('select theme from public.profiles where id = $1', [other]))?.theme).toBe('dark')
    expect((await one('select theme from public.profiles where id = $1', [u]))?.theme).toBe('midnight')
  })
})
