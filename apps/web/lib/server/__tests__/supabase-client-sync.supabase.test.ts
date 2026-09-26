// End-to-end: the mobile sync client (LocalStore + runSync + createSupabaseRemote) against a LOCAL
// Supabase stack running supabase/migrations (see supabase-sync.supabase.test.ts for setup).
//
//   npm run db:start && npx supabase db reset      # from the repo root (project_id rock_ht, ports 5432x)
//   npm run test:supabase --workspace=apps/web
//   npm run db:stop
//
// Never point this at a hosted project: it signs up throwaway accounts.
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseRemote, runSync, SyncAuthError, type SyncRemote } from '@rock_ht/sync'
import { createLocalStore, migrate, type LocalStore, type SqlDriver, type SqlParam } from '@rock_ht/local-db'
import { subtractDays, today } from '@rock_ht/utils'

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
// The Supabase CLI's fixed local demo anon key (not a secret; `supabase status` prints it).
const ANON_KEY = process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
if (process.env.ALLOW_REMOTE_SUPABASE_TESTS !== '1') {
  for (const [name, url] of [['SUPABASE_DB_URL', DB_URL], ['SUPABASE_URL', API_URL]] as const) {
    const host = new URL(url).hostname
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`${name} points at ${host}, not a local Supabase stack; set ALLOW_REMOTE_SUPABASE_TESTS=1 to override`)
    }
  }
}

const pool = new Pool({ connectionString: DB_URL })
afterAll(async () => {
  await pool.end()
})

/** In-memory better-sqlite3 behind the LocalStore driver contract (one queue, flat nested transactions). */
function memoryDriver(): SqlDriver {
  const db = new Database(':memory:')
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(op: () => T | Promise<T>): Promise<T> => {
    const result = queue.then(op)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  const make = (inTx: boolean): SqlDriver => {
    const call = <T>(op: () => T): Promise<T> => (inTx ? Promise.resolve().then(op) : enqueue(op))
    const driver: SqlDriver = {
      exec: (sql) => call(() => { db.exec(sql) }),
      run: (sql, params: SqlParam[] = []) => call(() => { db.prepare(sql).run(...params) }),
      all: <T>(sql: string, params: SqlParam[] = []) => call(() => db.prepare(sql).all(...params) as T[]),
      first: <T>(sql: string, params: SqlParam[] = []) => call(() => (db.prepare(sql).get(...params) ?? null) as T | null),
      async transaction(fn) {
        if (inTx) return fn(driver)
        return enqueue(async () => {
          db.exec('BEGIN IMMEDIATE')
          try {
            await fn(make(true))
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
        })
      },
    }
    return driver
  }
  return make(false)
}

// One strictly increasing clock for every device, so each edit is newer than the one before it.
let tick = Date.now()
const now = () => new Date(++tick).toISOString()

async function newDevice(): Promise<LocalStore> {
  const driver = memoryDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

type Account = { id: string; client: SupabaseClient; remote: SyncRemote }

/** Signs up through GoTrue (email confirmation is off locally) like the app's Supabase backend. */
async function signUp(name: string): Promise<Account> {
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signUp({
    email: `${randomUUID()}@example.com`, password: 'password1', options: { data: { full_name: name, name } },
  })
  if (error || !data.session || !data.user) throw new Error(`sign-up failed: ${error?.message ?? 'no session'}`)
  return { id: data.user.id, client, remote: createSupabaseRemote(client) }
}

async function serverRow(table: string, id: string): Promise<Record<string, unknown> | undefined> {
  return (await pool.query(`select * from public.${table} where id = $1`, [id])).rows[0]
}

describe('mobile sync client against Supabase', () => {
  it('pushes a device, pulls it onto a second device, propagates soft deletes, and skips foreign ids', async () => {
    const a = await signUp('Ann')
    const LOCAL = 'local-user'

    // Device 1 works offline first, then signs up (claim with the local profile), then syncs.
    const d1 = await newDevice()
    await d1.updateProfile(LOCAL, { display_name: 'Ann on phone' })
    const habits: { id: string }[] = []
    for (let i = 0; i < 5; i++) {
      habits.push(await d1.createHabit(LOCAL, { title: `Habit ${i}`, icon: '✨', color: '#fff', frequency: { type: 'daily' } }))
    }
    const day = today()
    await d1.setCompletion(LOCAL, { habit_id: habits[0]!.id, date: day }, true)
    await d1.setCompletion(LOCAL, { habit_id: habits[0]!.id, date: subtractDays(day, 1) }, true)
    const entry = await d1.createJournal(LOCAL, { entry_date: day, content: 'first day', mood: 4 })
    await (await d1.claim(a.id, { pushLocalProfile: true })).completed

    // batchSize 2: several push batches and pull pages.
    const r1 = await runSync(d1.sync, a.remote, { batchSize: 2 })
    expect(r1).toMatchObject({ skipped: 0 })
    expect(r1.pushed).toBe(9) // profile + 5 habits + 2 completions + 1 journal entry

    const h0 = await serverRow('habits', habits[0]!.id)
    expect(h0).toMatchObject({ user_id: a.id, title: 'Habit 0', deleted_at: null })
    expect((await pool.query('select count(*)::int as n from public.habits where user_id = $1', [a.id])).rows[0].n).toBe(5)
    expect((await pool.query('select count(*)::int as n from public.habit_completions where user_id = $1', [a.id])).rows[0].n).toBe(2)
    expect(await serverRow('journal_entries', entry.id)).toMatchObject({ user_id: a.id, content: 'first day' })
    expect(await serverRow('profiles', a.id)).toMatchObject({ display_name: 'Ann on phone' })

    // Device 2 signs in to the same account (claim without pushing its placeholder profile) and pulls.
    const d2 = await newDevice()
    await (await d2.claim(a.id, { pushLocalProfile: false })).completed
    const r2 = await runSync(d2.sync, a.remote, { batchSize: 2 })
    expect(r2.pulled).toBe(9)
    expect((await d2.listHabits(a.id)).map((h) => h.title).sort()).toEqual(['Habit 0', 'Habit 1', 'Habit 2', 'Habit 3', 'Habit 4'])
    expect(await d2.listCompletions(a.id)).toHaveLength(2)
    expect((await d2.listJournal(a.id))[0]).toMatchObject({ id: entry.id, content: 'first day' })
    expect((await d2.getProfile(a.id))?.display_name).toBe('Ann on phone')

    // A soft delete on device 2 reaches the server as a tombstone and removes the habit on device 1.
    await d2.deleteHabit(habits[1]!.id)
    await d2.updateHabit({ id: habits[2]!.id, title: 'Renamed on tablet' })
    expect(await runSync(d2.sync, a.remote)).toMatchObject({ pushed: 2, skipped: 0 })
    expect((await serverRow('habits', habits[1]!.id))?.deleted_at).not.toBeNull()
    await runSync(d1.sync, a.remote)
    const d1Titles = (await d1.listHabits(a.id)).map((h) => h.title).sort()
    expect(d1Titles).toEqual(['Habit 0', 'Habit 3', 'Habit 4', 'Renamed on tablet'])

    // A second account whose device holds one of Ann's ids: the server skips it, the device acks it,
    // and Ann's row is untouched.
    const b = await signUp('Bob')
    const d3 = await newDevice()
    await (await d3.claim(b.id, { pushLocalProfile: true })).completed
    const annHabit = (await a.remote.pull(null, 500)).changes.find((c) => c.table === 'habits' && c.row.id === habits[3]!.id)!
    await d3.sync.applyRemote([{ table: 'habits', row: { ...annHabit.row, user_id: b.id } }], null)
    await d3.updateHabit({ id: habits[3]!.id, title: 'Hijacked' })
    const r3 = await runSync(d3.sync, b.remote)
    expect(r3.skipped).toBe(1)
    expect((await serverRow('habits', habits[3]!.id))).toMatchObject({ user_id: a.id, title: 'Habit 3' })
    expect(await d3.sync.readOutbox(10)).toEqual([])
    // Bob pulls only his own profile, never Ann's rows.
    const bobPull = await b.remote.pull(null, 500)
    expect(bobPull.changes.map((c) => c.table)).toEqual(['profiles'])
  })

  it('normalizes pulled instants to toISOString() form', async () => {
    const a = await signUp('Cy')
    const d = await newDevice()
    await d.createHabit('local', { title: 'Walk', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await (await d.claim(a.id, { pushLocalProfile: true })).completed
    await runSync(d.sync, a.remote)
    const page = await a.remote.pull(null, 500)
    for (const c of page.changes) {
      for (const k of ['created_at', 'updated_at'] as const) {
        expect(c.row[k]).toBe(new Date(c.row[k] as string).toISOString())
      }
    }
    expect(page.cursor).toMatch(/^\d+$/)
    // An empty page keeps the cursor it was given.
    expect((await a.remote.pull(page.cursor, 500)).cursor).toBe(page.cursor)
  })

  it('maps a signed-out client and a bad JWT to SyncAuthError', async () => {
    const anon = createSupabaseRemote(createClient(API_URL, ANON_KEY, { auth: { persistSession: false } }))
    await expect(anon.push([])).rejects.toBeInstanceOf(SyncAuthError)
    await expect(anon.pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)

    const forged = createClient(API_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: 'Bearer not-a-jwt' } },
    })
    await expect(createSupabaseRemote(forged).pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('signs out: the old client can no longer sync', async () => {
    const a = await signUp('Di')
    await a.remote.pull(null, 10)
    await a.client.auth.signOut()
    await expect(a.remote.pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)
  })
})
