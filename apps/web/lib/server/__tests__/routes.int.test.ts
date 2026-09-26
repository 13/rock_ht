// Integration tests for the self-hosted auth + sync route handlers against a real Postgres
// (DATABASE_URL, with db/selfhost/init/*.sql loaded), driven by the real mobile sync client
// (`createHttpRemote` from @rock_ht/sync) wherever the client's behavior matters.
// Run: npm run test:int --workspace=apps/web
import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { completionId, createHttpRemote, runSync, SyncAuthError, type SyncChange } from '@rock_ht/sync'
import { createLocalStore, migrate, type SqlDriver, type SqlParam } from '@rock_ht/local-db'
import { GET as authGET, POST as authPOST } from '@/app/api/auth/[...all]/route'
import { POST as pushPOST } from '@/app/api/sync/push/route'
import { GET as pullGET } from '@/app/api/sync/pull/route'
import { getPool } from '@/lib/server/db'
import { SIGNUP_PROFILE_UPDATED_AT } from '@/lib/server/auth'

const BASE = process.env.BETTER_AUTH_URL!
const PASSWORD = 'correct-horse-battery-staple'
const ts = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString()

afterAll(async () => {
  await getPool().end()
})

/** Headers the mobile app's better-auth expo client sends (it has no browser Origin). */
const EXPO_HEADERS = { 'content-type': 'application/json', 'expo-origin': 'rockht://' }

function cookieFrom(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

async function signUp(name = 'Ada') {
  const email = `${randomUUID()}@example.com`
  const res = await authPOST(new Request(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST', headers: EXPO_HEADERS, body: JSON.stringify({ email, password: PASSWORD, name }),
  }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { user: { id: string } }
  return { id: body.user.id, email, cookie: cookieFrom(res) }
}

/** Every request the client made, as the route handlers received it. */
type Seen = { url: string; method: string; headers: Headers; credentials: RequestCredentials }

/** A `fetch` that dispatches to the route handlers in-process instead of over the network. */
function routeFetch(seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const req = new Request(input as string, init)
    seen.push({ url: req.url, method: req.method, headers: req.headers, credentials: init?.credentials ?? 'same-origin' })
    const { pathname } = new URL(req.url)
    if (pathname === '/api/sync/push' && req.method === 'POST') return pushPOST(req)
    if (pathname === '/api/sync/pull' && req.method === 'GET') return pullGET(req)
    return new Response('Not found', { status: 404 })
  }
}

function client(cookie: string | null, seen: Seen[] = []) {
  return createHttpRemote({
    baseUrl: `${BASE}/`,
    fetch: routeFetch(seen),
    getHeaders: async (): Promise<Record<string, string>> => (cookie ? { Cookie: cookie } : {}),
  })
}

const habit = (id: string, title: string, m: number): SyncChange => ({
  table: 'habits',
  row: { id, title, icon: '✨', color: '#fff', frequency: { type: 'daily' }, target_value: 1,
         target_unit: null, description: null, reminder_time: null,
         reminder_enabled: false, is_archived: false, sort_order: 0,
         created_at: ts(0), updated_at: ts(m), deleted_at: null },
})

function push(cookie: string | null, body: unknown, headers: Record<string, string> = {}) {
  return pushPOST(new Request(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}
function pull(cookie: string | null, query: string) {
  return pullGET(new Request(`${BASE}/api/sync/pull?${query}`, { headers: cookie ? { cookie } : {} }))
}

// Carry-over 3.
describe('sign-up', () => {
  it('creates the profile with the account email and name, dated just after the epoch', async () => {
    const { id, email } = await signUp('Grace')
    const { rows } = await getPool().query(
      'select email, display_name, onboarding_completed, public.sync_ts(updated_at) as updated_at from public.profiles where id = $1',
      [id],
    )
    expect(rows[0]).toEqual({ email, display_name: 'Grace', onboarding_completed: false, updated_at: SIGNUP_PROFILE_UPDATED_AT })
    expect(SIGNUP_PROFILE_UPDATED_AT > '1970-01-01T00:00:00.000Z').toBe(true) // beats the claim() epoch floor
  })

  it("lets the signing-up phone's first profile push win even if its clock is an hour behind", async () => {
    const { id, cookie } = await signUp()
    const behind = new Date(Date.now() - 3600_000).toISOString()
    await client(cookie).push([{ table: 'profiles', row: {
      id, email: '', display_name: null, avatar_url: null, timezone: 'Asia/Tokyo', theme: 'midnight',
      onboarding_completed: true, time_format: '24h', date_format: 'YYYY-MM-DD',
      created_at: behind, updated_at: behind, deleted_at: null,
    } }])
    const page = await client(cookie).pull(null, 200)
    const profile = page.changes.find((c) => c.table === 'profiles')!.row
    expect(profile).toMatchObject({ id, timezone: 'Asia/Tokyo', onboarding_completed: true, display_name: 'Ada', updated_at: behind })
  })
})

// Carry-over 7.
describe('auth on the sync routes', () => {
  it('answers 401 without a session cookie, which the client maps to SyncAuthError', async () => {
    expect((await push(null, { changes: [] })).status).toBe(401)
    expect((await pull(null, 'cursor=&limit=200')).status).toBe(401)
    expect((await push('better-auth.session_token=forged.value', { changes: [] })).status).toBe(401)
    await expect(client(null).push([])).rejects.toBeInstanceOf(SyncAuthError)
    await expect(client(null).pull(null, 200)).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('accepts the cookie as an explicit Cookie header with credentials omitted and no Origin', async () => {
    const { id, cookie } = await signUp()
    const seen: Seen[] = []
    const remote = client(cookie, seen)
    const h = randomUUID()
    await remote.push([
      habit(h, 'Read', 5),
      { table: 'habit_completions', row: { id: completionId(h, '2026-01-02'), habit_id: h, completed_date: '2026-01-02',
        value: 1, note: null, created_at: ts(6), updated_at: ts(6), deleted_at: null } },
    ])
    const page = await remote.pull(null, 200)
    expect(page.hasMore).toBe(false)
    expect(page.cursor).toMatch(/^\d+$/)
    expect(page.changes.map((c) => c.table)).toEqual(['profiles', 'habits', 'habit_completions'])
    expect(page.changes[0]!.row.id).toBe(id)
    expect(page.changes[1]!.row).toMatchObject({ id: h, user_id: id, title: 'Read', updated_at: ts(5), created_at: ts(0) })
    expect(page.changes[2]!.row).toMatchObject({ id: completionId(h, '2026-01-02'), completed_date: '2026-01-02', updated_at: ts(6) })
    // Nothing new since that cursor: the caller's cursor comes back unchanged.
    expect(await remote.pull(page.cursor, 200)).toEqual({ changes: [], cursor: page.cursor, hasMore: false })

    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual(['POST /api/sync/push', 'GET /api/sync/pull', 'GET /api/sync/pull'])
    for (const s of seen) {
      expect(s.headers.get('origin')).toBeNull()
      expect(s.headers.get('cookie')).toBe(cookie)
      expect(s.credentials).toBe('omit')
    }
  })

  it('still enforces the Origin check on cookie-bearing auth POSTs (only the sync routes skip it)', async () => {
    const { email, cookie } = await signUp()
    const body = JSON.stringify({ email, password: PASSWORD })
    const noOrigin = await authPOST(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body,
    }))
    expect(noOrigin.status).toBe(403)
    // The expo client's `expo-origin: rockht://` is trusted (expo() plugin + trustedOrigins).
    const expoApp = await authPOST(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: { ...EXPO_HEADERS, cookie }, body,
    }))
    expect(expoApp.status).toBe(200)
  })

  it('serves getSession for the cookie, with a session that outlives the client’s once-a-day refresh', async () => {
    const { id, cookie } = await signUp()
    const res = await authGET(new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string }; session: { expiresAt: string } }
    expect(body.user.id).toBe(id)
    expect(new Date(body.session.expiresAt).getTime() - Date.now()).toBeGreaterThan(2 * 24 * 3600_000)
  })

  it('writes only the session user’s rows, whatever user_id a change carries', async () => {
    const a = await signUp()
    const b = await signUp()
    const h = randomUUID()
    const change = habit(h, 'claimed', 1)
    change.row.user_id = b.id
    await client(a.cookie).push([change])
    const { rows } = await getPool().query('select user_id from public.habits where id = $1', [h])
    expect(rows).toEqual([{ user_id: a.id }])
    expect((await client(b.cookie).pull(null, 200)).changes.some((c) => c.row.id === h)).toBe(false)
  })
})

// Carry-over 10.
describe('limits and validation', () => {
  it('accepts the client batch of 200 and the server cap of 500, rejects 501 with 413', async () => {
    const { cookie } = await signUp()
    const batch = (n: number) => Array.from({ length: n }, (_, i) => habit(randomUUID(), `h${i}`, 1))
    expect((await push(cookie, { changes: batch(200) })).status).toBe(204)
    expect((await push(cookie, { changes: batch(500) })).status).toBe(204)
    expect((await push(cookie, { changes: batch(501) })).status).toBe(413)
    // 1 profile + 700 habits: limit is clamped to 500; a missing/invalid limit means 200.
    const clamped = (await (await pull(cookie, 'cursor=&limit=1000')).json()) as { changes: unknown[]; hasMore: boolean }
    expect(clamped.changes).toHaveLength(500)
    expect(clamped.hasMore).toBe(true)
    const byDefault = (await (await pull(cookie, 'cursor=&limit=abc')).json()) as { changes: unknown[] }
    expect(byDefault.changes).toHaveLength(200)
    const tiny = (await (await pull(cookie, 'cursor=0&limit=0')).json()) as { changes: unknown[] }
    expect(tiny.changes).toHaveLength(1)
  })

  it('rejects malformed bodies and cursors with 400', async () => {
    const { cookie } = await signUp()
    expect((await push(cookie, '{not json')).status).toBe(400)
    expect((await push(cookie, { changes: 'nope' })).status).toBe(400)
    expect((await push(cookie, 'null')).status).toBe(400)
    expect((await pull(cookie, 'cursor=-1&limit=10')).status).toBe(400)
    expect((await pull(cookie, 'cursor=1e3&limit=10')).status).toBe(400)
    expect((await pull(cookie, 'cursor=9223372036854775808&limit=10')).status).toBe(400)
  })

  it('pages through everything with the real client loop (cursor + hasMore)', async () => {
    const { cookie } = await signUp()
    const remote = client(cookie)
    await remote.push(Array.from({ length: 450 }, (_, i) => habit(randomUUID(), `p${i}`, 1)))
    let cursor: string | null = null
    let total = 0
    for (let pages = 0; ; pages++) {
      const page = await remote.pull(cursor, 200)
      total += page.changes.length
      cursor = page.cursor
      if (!page.hasMore) {
        expect(pages).toBe(2)
        break
      }
    }
    expect(total).toBe(451)
  })
})

// Review fix 6.
describe('push request hardening', () => {
  it('answers 415 unless the body is declared as JSON', async () => {
    const { cookie } = await signUp()
    expect((await push(cookie, { changes: [] }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await push(cookie, { changes: [] }, { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415)
    expect((await push(cookie, { changes: [] }, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(204)
  })

  it('answers 413 for a declared length over 5 MB without reading the body', async () => {
    const { cookie } = await signUp()
    let pulled = false
    const body = new ReadableStream({ pull() { pulled = true; throw new Error('body must not be read') } }, { highWaterMark: 0 })
    const req = new Request(`${BASE}/api/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'content-length': String(5 * 1024 * 1024 + 1) },
      body,
      duplex: 'half',
    } as RequestInit)
    expect((await pushPOST(req)).status).toBe(413)
    expect(pulled).toBe(false)
  })

  it('answers 413 for an undeclared body over 5 MB', async () => {
    const { cookie } = await signUp()
    const big = JSON.stringify({ changes: [habit(randomUUID(), 'x'.repeat(5 * 1024 * 1024), 1)] })
    expect((await push(cookie, big)).status).toBe(413)
  })
})

// Review fix 1: an error that isn't about one change fails the push with 500, so the client
// keeps its outbox and retries instead of acking changes that were never written.
describe('push errors', () => {
  it('answers 500 (not 204) when sync_push_for raises a non-data error, and the client does not ack', async () => {
    const { cookie } = await signUp()
    const title = `boom-${randomUUID()}`
    await getPool().query(`
      create or replace function test_route_boom() returns trigger language plpgsql as $f$
      begin
        if new.title = '${title}' then raise exception 'simulated deadlock' using errcode = '40P01'; end if;
        return new;
      end $f$`)
    await getPool().query('create trigger zz_test_route_boom before insert on public.habits for each row execute function test_route_boom()')
    try {
      const good = randomUUID()
      expect((await push(cookie, { changes: [habit(good, 'ok', 1), habit(randomUUID(), title, 1)] })).status).toBe(500)
      await expect(client(cookie).push([habit(good, 'ok', 1), habit(randomUUID(), title, 1)])).rejects.toThrow(/500/)
      const { rows } = await getPool().query('select 1 from public.habits where id = $1', [good])
      expect(rows).toEqual([])
    } finally {
      await getPool().query('drop trigger zz_test_route_boom on public.habits')
      await getPool().query('drop function test_route_boom()')
    }
  })
})

/** In-memory SQLite for a real `LocalStore` (serial, like the device driver; nested transactions run flat). */
function memoryDriver(): SqlDriver {
  const db = new Database(':memory:')
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(op: () => T | Promise<T>): Promise<T> => {
    const result = queue.then(op)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  function make(inTx: boolean): SqlDriver {
    const call = <T>(op: () => T): Promise<T> => (inTx ? Promise.resolve().then(op) : serial(op))
    const d: SqlDriver = {
      exec: (sql) => call(() => { db.exec(sql) }),
      run: (sql, params: SqlParam[] = []) => call(() => { db.prepare(sql).run(...params) }),
      all: <T>(sql: string, params: SqlParam[] = []) => call(() => db.prepare(sql).all(...params) as T[]),
      first: <T>(sql: string, params: SqlParam[] = []) => call(() => (db.prepare(sql).get(...params) ?? null) as T | null),
      async transaction(fn) {
        if (inTx) return fn(d)
        return serial(async () => {
          db.exec('BEGIN IMMEDIATE')
          try { await fn(make(true)); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
        })
      },
    }
    return d
  }
  return make(false)
}

// The Task 13 end-to-end bug, through the real client pieces (LocalStore, runSync, createHttpRemote)
// and the real route handlers: a device synced to account A, disconnected, then signed up as B.
describe('one device switching accounts (copy into the new account)', () => {
  async function device() {
    const driver = memoryDriver()
    await migrate(driver)
    return createLocalStore({ driver, newId: randomUUID, now: () => new Date().toISOString() })
  }
  const counts = async (userId: string) => {
    const q = async (t: string) => Number((await getPool().query(`select count(*) from public.${t} where user_id = $1`, [userId])).rows[0].count)
    return { habits: await q('habits'), completions: await q('habit_completions'), journal: await q('journal_entries') }
  }

  it('pushes the device data to B under new ids, leaves A untouched, and reports nothing skipped', async () => {
    const store = await device()
    const local = 'local-device'
    await store.ensureProfile(local)
    const run = await store.createHabit(local, { title: 'Morning run', icon: '🏃', color: '#f00', frequency: { type: 'daily' } })
    const read = await store.createHabit(local, { title: 'Read', icon: '📚', color: '#00f', frequency: { type: 'daily' } })
    await store.setCompletion(local, { habit_id: run.id, date: '2026-09-25' }, true)
    await store.setCompletion(local, { habit_id: run.id, date: '2026-09-26' }, true)
    await store.setCompletion(local, { habit_id: read.id, date: '2026-09-26' }, true)
    await store.createJournal(local, { content: 'good day', habit_id: run.id })

    // Sign up as A and sync (connectSync + syncNow).
    const a = await signUp('A')
    await (await store.claim(a.id, { pushLocalProfile: true })).completed
    expect(await runSync(store.sync, client(a.cookie))).toMatchObject({ skipped: 0 })
    expect(await counts(a.id)).toEqual({ habits: 2, completions: 3, journal: 1 })
    const aRowsBefore = (await getPool().query(
      'select id, title, updated_at from public.habits where user_id = $1 order by id', [a.id])).rows

    // Disconnect (disconnectSync): rows stay under A as the local identity.
    await store.setMeta('local_user_id', a.id)
    await store.setMeta('account_user_id', null)
    await store.setCompletion(a.id, { habit_id: read.id, date: '2026-09-27' }, true) // an offline edit

    // Create account B on the same device.
    const b = await signUp('B')
    await (await store.claim(b.id, { pushLocalProfile: true })).completed
    const report = await runSync(store.sync, client(b.cookie))
    expect(report.skipped).toBe(0)

    expect(await counts(b.id)).toEqual({ habits: 2, completions: 4, journal: 1 })
    const bHabits = (await getPool().query('select id, title from public.habits where user_id = $1 order by title', [b.id])).rows
    expect(bHabits.map((h) => h.title)).toEqual(['Morning run', 'Read'])
    expect(bHabits.some((h) => h.id === run.id || h.id === read.id)).toBe(false)
    const bCompletions = (await getPool().query(
      'select id, habit_id, completed_date::text as d from public.habit_completions where user_id = $1', [b.id])).rows
    for (const c of bCompletions) expect(c.id).toBe(completionId(c.habit_id, c.d))
    const bJournal = (await getPool().query('select habit_id from public.journal_entries where user_id = $1', [b.id])).rows
    expect(bJournal).toEqual([{ habit_id: bHabits.find((h) => h.title === 'Morning run')!.id }])

    // A is exactly as it was: same rows, and the offline edit made after disconnecting didn't reach it.
    expect(await counts(a.id)).toEqual({ habits: 2, completions: 3, journal: 1 })
    expect((await getPool().query('select id, title, updated_at from public.habits where user_id = $1 order by id', [a.id])).rows)
      .toEqual(aRowsBefore)

    // The device now shows B's data under the new ids, and a pull brings back exactly those rows.
    expect((await store.listHabits(b.id)).map((h) => h.id).sort()).toEqual(bHabits.map((h) => h.id).sort())
    expect((await store.listCompletions(b.id))).toHaveLength(4)
  })

  it("returns a pushed change whose id is another account's as skipped (200 { skipped }), and 204 when none", async () => {
    const a = await signUp()
    const b = await signUp()
    const h = randomUUID()
    const first = await push(a.cookie, { changes: [habit(h, 'theirs', 1)] })
    expect(first.status).toBe(204)
    const res = await push(b.cookie, { changes: [habit(h, 'mine', 9)] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: [{ tbl: 'habits', id: h, reason: 'foreign_owner' }] })
    // Through the real client: the skipped list comes back from push and runSync counts it.
    expect(await client(b.cookie).push([habit(h, 'mine', 10)])).toEqual({ skipped: [{ tbl: 'habits', id: h, reason: 'foreign_owner' }] })
    const store = await device()
    await store.ensureProfile(b.id)
    await store.sync.applyRemote([{ table: 'habits', row: { ...habit(h, 'mine', 11).row, user_id: b.id } }], null)
    await store.updateHabit({ id: h, title: 'mine, edited' })
    await store.setMeta('account_user_id', b.id)
    expect(await runSync(store.sync, client(b.cookie))).toMatchObject({ pushed: 1, skipped: 1 })
    expect(await store.sync.readOutbox(10)).toEqual([]) // acked: it can never apply
    expect((await getPool().query('select user_id, title from public.habits where id = $1', [h])).rows).toEqual([{ user_id: a.id, title: 'theirs' }])
  })
})
