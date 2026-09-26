// Integration tests for supabase/migrations/008_sync.sql against a LOCAL Supabase stack.
//
//   npm run db:start && npx supabase db reset      # from the repo root (project_id rock_ht, ports 5432x)
//   npm run test:supabase --workspace=apps/web
//   npm run db:stop
//
// Never point this at a hosted project: it inserts into auth.users and signs up throwaway accounts.
// Defaults are the local stack's (`supabase status`); override with SUPABASE_DB_URL, SUPABASE_URL and
// SUPABASE_ANON_KEY.
//
// Postgres roles are exercised two ways: over SQL with `set local role` + `request.jwt.claims` (what
// PostgREST does per request), and end to end through supabase-js (GoTrue sign-up + PostgREST).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { completionId } from '@rock_ht/sync'
import {
  addCompletion, archiveHabit, createHabit, createJournalEntry, deleteHabit, deleteJournalEntry, getCompletionForDate, getCompletions,
  getHabit, getHabits, getJournalEntries, getStreaks, getTodayCompletions, removeCompletion, reorderHabits, updateHabit,
  type TypedSupabaseClient,
} from '@rock_ht/db'

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
// The Supabase CLI's fixed local demo anon key (not a secret; `supabase status` prints it).
const ANON_KEY = process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

// Refuse to run against anything but a local stack unless explicitly told to.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
if (process.env.ALLOW_REMOTE_SUPABASE_TESTS !== '1') {
  for (const [name, url] of [['SUPABASE_DB_URL', DB_URL], ['SUPABASE_URL', API_URL]] as const) {
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      throw new Error(`${name} is not a valid URL`)
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`${name} points at ${host}, not a local Supabase stack; set ALLOW_REMOTE_SUPABASE_TESTS=1 to override`)
    }
  }
}

const pool = new Pool({ connectionString: DB_URL })
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const ts = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString()

type Skipped = { tbl: string; id: string | null; reason: string; detail?: string }
type Pulled = { changes: { table: string; row: Record<string, unknown> }[]; cursor: string | null; hasMore: boolean }

/** A Supabase auth user (as the dashboard/GoTrue would insert it); fires handle_new_user. */
async function authUser(name = 'Test'): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `insert into auth.users (id, email, aud, role, raw_user_meta_data)
     values ($1, $2, 'authenticated', 'authenticated', $3::jsonb)`,
    [id, `${id}@example.com`, JSON.stringify({ full_name: name })],
  )
  return id
}

/** Runs `fn` in one transaction as PostgREST would for a request: `role`, with `sub` = uid (if any). */
async function as<T>(role: 'authenticated' | 'anon', uid: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`set local role ${role}`)
    await c.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(uid ? { sub: uid, role } : { role })])
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

async function push(uid: string, changes: unknown[]): Promise<Skipped[]> {
  return as('authenticated', uid, async (c) =>
    ((await c.query('select public.sync_push($1::jsonb) as r', [JSON.stringify(changes)])).rows[0].r as { skipped: Skipped[] }).skipped)
}
async function pull(uid: string, cursor = 0, limit = 500): Promise<Pulled> {
  return as('authenticated', uid, async (c) =>
    (await c.query('select public.sync_pull($1, $2) as r', [cursor, limit])).rows[0].r as Pulled)
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
const journal = (id: string, m: number) => ({
  table: 'journal_entries',
  row: { id, habit_id: null, entry_date: '2026-01-01', content: 'hi', mood: 3,
         created_at: ts(0), updated_at: ts(m), deleted_at: null },
})

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await pool.query(sql, params)).rows[0] as T
}

afterAll(async () => {
  await pool.end()
})

describe('008: schema and triggers', () => {
  it('drops the 003 set_updated_at triggers', async () => {
    const { rows } = await pool.query(
      "select tgname from pg_trigger where tgname in ('habits_set_updated_at', 'profiles_set_updated_at', 'journal_set_updated_at')")
    expect(rows).toEqual([])
  })

  it('keeps the updated_at a writer sets instead of overwriting it with now() (last-write-wins)', async () => {
    const a = await authUser()
    const h = randomUUID()
    await push(a, [habit(h, 'Read', 1)])
    await as('authenticated', a, async (c) => {
      await c.query("update public.habits set title = 'Read more', updated_at = '2026-01-01T00:05:00.123Z' where id = $1", [h])
      await c.query("update public.profiles set theme = 'forest', updated_at = '2026-01-01T00:06:00.456Z' where id = $1", [a])
    })
    expect((await one("select public.sync_ts(updated_at) as t from public.habits where id = $1", [h])).t)
      .toBe('2026-01-01T00:05:00.123Z')
    expect((await one("select public.sync_ts(updated_at) as t from public.profiles where id = $1", [a])).t)
      .toBe('2026-01-01T00:06:00.456Z')
  })

  it('still advances updated_at (to whole ms) and server_seq for writers that do not set it', async () => {
    const a = await authUser()
    const h = randomUUID()
    await push(a, [habit(h, 'Read', 1)])
    const before = await one<{ server_seq: string }>('select server_seq from public.habits where id = $1', [h])
    await as('authenticated', a, (c) => c.query("update public.habits set title = 'x' where id = $1", [h]))
    const after = await one<{ server_seq: string; us: string; t: string }>(
      `select server_seq, (extract(microseconds from updated_at)::bigint % 1000)::text as us,
              public.sync_ts(updated_at) as t from public.habits where id = $1`, [h])
    expect(BigInt(after.server_seq)).toBeGreaterThan(BigInt(before.server_seq))
    expect(after.t).not.toBe(ts(1))
    expect(after.us).toBe('0')
  })

  it('creates the sign-up profile dated just after the epoch, so the first device profile push wins', async () => {
    const a = await authUser('Ada Lovelace')
    const p = await one<{ t: string; email: string; display_name: string }>(
      'select public.sync_ts(updated_at) as t, email, display_name from public.profiles where id = $1', [a])
    expect(p).toEqual({ t: '1970-01-01T00:00:00.001Z', email: `${a}@example.com`, display_name: 'Ada Lovelace' })

    // A device whose clock is years behind the server still wins that first push.
    const skipped = await push(a, [{ table: 'profiles', row: {
      id: a, email: '', display_name: 'Ada', timezone: 'Europe/Berlin', theme: 'forest', onboarding_completed: true,
      time_format: '24h', date_format: 'YYYY-MM-DD', created_at: '2001-01-01T00:00:00.000Z',
      updated_at: '2001-01-01T00:00:00.000Z', deleted_at: null } }])
    expect(skipped).toEqual([])
    expect(await one('select display_name, theme, email from public.profiles where id = $1', [a]))
      .toEqual({ display_name: 'Ada', theme: 'forest', email: `${a}@example.com` })
  })

  it('lets authenticated (PostgREST) writers take sync_seq values', async () => {
    expect((await one("select has_sequence_privilege('authenticated', 'public.sync_seq', 'USAGE') as ok")).ok).toBe(true)
    const a = await authUser()
    const h = randomUUID()
    await as('authenticated', a, async (c) => {
      await c.query("insert into public.habits (id, user_id, title) values ($1, $2, 'web habit')", [h, a])
      await c.query(
        "insert into public.habit_completions (id, habit_id, user_id, completed_date) values (public.completion_id($1, '2026-01-02'), $1, $2, '2026-01-02')",
        [h, a])
    })
    const page = await pull(a)
    expect(page.changes.map((c) => c.table).sort()).toEqual(['habit_completions', 'habits', 'profiles'])
    expect(page.changes.find((c) => c.table === 'habit_completions')!.row.id).toBe(completionId(h, '2026-01-02'))
  })

  it('has no default completion id: writers must derive it', async () => {
    const { rows } = await pool.query(
      "select column_default from information_schema.columns where table_schema = 'public' and table_name = 'habit_completions' and column_name = 'id'")
    expect(rows[0].column_default).toBeNull()
  })

  it('derives the completion id in the database, whatever the writer sends', async () => {
    const a = await authUser()
    const h = randomUUID()
    await as('authenticated', a, async (c) => {
      await c.query("insert into public.habits (id, user_id, title) values ($1, $2, 'web habit')", [h, a])
      // A stale web bundle sends no id; a buggy writer sends a random one.
      await c.query("insert into public.habit_completions (habit_id, user_id, completed_date) values ($1, $2, '2026-01-03')", [h, a])
      await c.query("insert into public.habit_completions (id, habit_id, user_id, completed_date) values ($1, $2, $3, '2026-01-04')",
        [randomUUID(), h, a])
    })
    const { rows } = await pool.query(
      "select id, to_char(completed_date, 'YYYY-MM-DD') as d from public.habit_completions where habit_id = $1 order by completed_date", [h])
    expect(rows).toEqual([
      { id: completionId(h, '2026-01-03'), d: '2026-01-03' },
      { id: completionId(h, '2026-01-04'), d: '2026-01-04' },
    ])
    // An id-less upsert of the same day hits the same row instead of failing the unique check.
    await as('authenticated', a, (c) => c.query(
      `insert into public.habit_completions (habit_id, user_id, completed_date, value) values ($1, $2, '2026-01-03', 5)
       on conflict (id) do update set value = excluded.value`, [h, a]))
    expect((await one('select value from public.habit_completions where id = $1', [completionId(h, '2026-01-03')])).value).toBe(5)
  })

  it('refuses hard deletes of synced rows to API roles (deletes are soft)', async () => {
    const a = await authUser()
    const h = randomUUID()
    const j = randomUUID()
    expect(await push(a, [habit(h, 'Keep', 1), completion(h, '2026-01-02', 1), journal(j, 1)])).toEqual([])
    const deleted = await as('authenticated', a, async (c) => [
      (await c.query('delete from public.habit_completions where habit_id = $1', [h])).rowCount,
      (await c.query('delete from public.journal_entries where id = $1', [j])).rowCount,
      (await c.query('delete from public.habits where id = $1', [h])).rowCount,
    ])
    expect(deleted).toEqual([0, 0, 0])
    expect(await one(
      `select (select count(*)::int from public.habits where id = $1) as h,
              (select count(*)::int from public.habit_completions where habit_id = $1) as c,
              (select count(*)::int from public.journal_entries where id = $2) as j`, [h, j]))
      .toEqual({ h: 1, c: 1, j: 1 })
    const { rows } = await pool.query(
      "select policyname from pg_policies where schemaname = 'public' and cmd = 'DELETE' and tablename in ('habits', 'habit_completions', 'journal_entries')")
    expect(rows).toEqual([])
  })

  it('still cascades an account deletion (auth.users) to every synced row', async () => {
    const a = await authUser()
    const h = randomUUID()
    await push(a, [habit(h, 'Gone', 1), completion(h, '2026-01-02', 1), journal(randomUUID(), 1)])
    await pool.query('delete from auth.users where id = $1', [a])
    expect(await one(
      `select (select count(*)::int from public.profiles where id = $1) +
              (select count(*)::int from public.habits where user_id = $1) +
              (select count(*)::int from public.habit_completions where user_id = $1) +
              (select count(*)::int from public.journal_entries where user_id = $1) as n`, [a]))
      .toEqual({ n: 0 })
  })
})

describe('008: RPC permissions', () => {
  it('refuses sync_push_for / sync_pull_for to authenticated and anon callers', async () => {
    const a = await authUser()
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(as(role, a, (c) => c.query("select public.sync_push_for($1, '[]'::jsonb)", [a])))
        .rejects.toThrow(/permission denied/)
      await expect(as(role, a, (c) => c.query('select public.sync_pull_for($1, 0, 10)', [a])))
        .rejects.toThrow(/permission denied/)
    }
  })

  it('exposes no advisory-lock helper, and no sync helpers to anon', async () => {
    expect((await one("select to_regprocedure('public.sync_lock_user(uuid)') as p")).p).toBeNull()
    await expect(as('anon', null, (c) => c.query("select public.completion_id(gen_random_uuid(), '2026-01-01')")))
      .rejects.toThrow(/permission denied/)
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(as(role, null, (c) => c.query('select public.sync_ts(now())'))).rejects.toThrow(/permission denied/)
    }
  })

  it('refuses recalculate_streak (security definer, any habit id) to every API role', async () => {
    const a = randomUUID()
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(as(role, a, (c) => c.query('select public.recalculate_streak(gen_random_uuid())')))
        .rejects.toThrow(/permission denied/)
    }
  })

  it('refuses the wrappers to anon and to a token without a user', async () => {
    await expect(as('anon', null, (c) => c.query("select public.sync_push('[]'::jsonb)"))).rejects.toThrow(/permission denied/)
    await expect(as('anon', null, (c) => c.query('select public.sync_pull(0, 10)'))).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', null, (c) => c.query("select public.sync_push('[]'::jsonb)"))).rejects.toThrow(/not authenticated/)
    await expect(as('authenticated', null, (c) => c.query('select public.sync_pull(0, 10)'))).rejects.toThrow(/not authenticated/)
  })

  it('binds the wrappers to auth.uid(): a user never reads or writes another user\'s rows', async () => {
    const a = await authUser()
    const b = await authUser()
    const h = randomUUID()
    const j = randomUUID()
    expect(await push(a, [habit(h, 'A habit', 1), completion(h, '2026-01-02', 1), journal(j, 1)])).toEqual([])

    // B sees none of A's rows (only its own profile).
    const bPage = await pull(b)
    expect(bPage.changes.map((c) => c.table)).toEqual(['profiles'])
    expect(bPage.changes[0]!.row.id).toBe(b)

    // A pushed user_id (or a profile id) is ignored: rows are always written as the caller's.
    const own = randomUUID()
    expect(await push(b, [habit(own, 'B habit', 2, { user_id: a })])).toEqual([])
    expect((await one('select user_id from public.habits where id = $1', [own])).user_id).toBe(b)

    // B overwriting A's ids is refused and reported; A's rows are untouched.
    const skipped = await push(b, [
      habit(h, 'hijack', 50), completion(h, '2026-01-02', 50), journal(j, 50),
    ])
    expect(skipped).toEqual([
      { tbl: 'habits', id: h, reason: 'rejected' },
      { tbl: 'habit_completions', id: completionId(h, '2026-01-02'), reason: 'rejected' },
      { tbl: 'journal_entries', id: j, reason: 'rejected' },
    ])
    expect(await one('select title, user_id from public.habits where id = $1', [h])).toEqual({ title: 'A habit', user_id: a })
    expect((await one('select count(*)::int as n from public.habit_completions where habit_id = $1', [h])).n).toBe(1)
    expect((await one('select user_id, content from public.journal_entries where id = $1', [j]))).toEqual({ user_id: a, content: 'hi' })
  })
})

describe('008: push/pull through the wrappers', () => {
  let a: string
  let h: string
  beforeAll(async () => {
    a = await authUser()
    h = randomUUID()
  })

  it('reports invalid changes as skipped and still applies the rest of the batch', async () => {
    const good = randomUUID()
    const skipped = await push(a, [
      habit(h, 'Read', 1),
      { table: 'habits', row: { ...habit(randomUUID(), 'bad', 1).row, target_value: 'lots' } },
      { table: 'nope', row: { id: randomUUID(), updated_at: ts(1) } },
      completion(randomUUID(), '2026-01-02', 1), // missing habit
      habit(good, 'Good', 1),
    ])
    expect(skipped.map((s) => [s.tbl, s.reason])).toEqual([
      ['habits', 'rejected'], ['nope', 'rejected'], ['habit_completions', 'rejected'],
    ])
    // The client only learns "rejected": no reason or SQL error text crosses the API.
    expect(skipped.every((s) => s.detail === undefined)).toBe(true)
    expect((await one('select count(*)::int as n from public.habits where id = any($1)', [[h, good]])).n).toBe(2)
  })

  it('does not report a change that merely loses last-write-wins', async () => {
    expect(await push(a, [habit(h, 'older', 0)])).toEqual([])
    expect((await one('select title from public.habits where id = $1', [h])).title).toBe('Read')
  })

  it('pulls ms-precision ISO timestamps and deterministic completion ids', async () => {
    await push(a, [completion(h, '2024-02-29', 3), completion(h, '2026-01-03', 3, { deleted_at: ts(4), updated_at: ts(4) })])
    // A server-side writer's now() (microseconds) is still emitted with ms precision.
    await as('authenticated', a, (c) => c.query("update public.habits set description = 'd' where id = $1", [h]))
    const page = await pull(a)
    for (const { row } of page.changes) {
      expect(row.created_at).toMatch(ISO_MS)
      expect(row.updated_at).toMatch(ISO_MS)
      if (row.deleted_at !== null) expect(row.deleted_at).toMatch(ISO_MS)
      expect(row).not.toHaveProperty('server_seq')
    }
    const completions = page.changes.filter((c) => c.table === 'habit_completions').map((c) => c.row)
    expect(completions).toHaveLength(2)
    for (const c of completions) expect(c.id).toBe(completionId(h, c.completed_date as string))
    expect(completions.find((c) => c.completed_date === '2026-01-03')!.deleted_at).toBe(ts(4))
    const sqlId = await one<{ id: string }>("select public.completion_id(upper($1::text)::uuid, '2024-02-29') as id", [h])
    expect(sqlId.id).toBe(completionId(h.toUpperCase(), '2024-02-29'))
  })

  it('pages by server_seq with a clamped limit', async () => {
    const first = await pull(a, 0, 0)
    expect(first.changes).toHaveLength(1)
    expect(first.hasMore).toBe(true)
    const rest = await pull(a, Number(first.cursor), 10_000)
    expect(rest.hasMore).toBe(false)
    expect(Number(rest.cursor)).toBeGreaterThan(Number(first.cursor))
  })
})

describe('008: streak cache ignores tombstones and uses the profile timezone', () => {
  it('recalculates on a soft delete (an update) without the tombstoned day', async () => {
    const a = await authUser()
    await as('authenticated', a, (c) => c.query("update public.profiles set timezone = 'Pacific/Pago_Pago' where id = $1", [a]))
    const { today, yesterday } = await one<{ today: string; yesterday: string }>(
      "select to_char((now() at time zone 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD') as today, to_char((now() at time zone 'Pacific/Pago_Pago')::date - 1, 'YYYY-MM-DD') as yesterday")
    const h = randomUUID()
    await push(a, [habit(h, 'Run', 1), completion(h, yesterday, 1), completion(h, today, 1)])
    const streak = async () =>
      one<{ current_streak: number; longest_streak: number }>('select current_streak, longest_streak from public.habit_streaks where habit_id = $1', [h])
    expect(await streak()).toEqual({ current_streak: 2, longest_streak: 2 })

    // Un-toggle today (soft delete via the sync push): yesterday in Pago Pago still counts.
    await push(a, [completion(h, today, 2, { deleted_at: ts(2) })])
    expect((await streak()).current_streak).toBe(1)

    // And via a web-style update.
    await as('authenticated', a, (c) => c.query(
      "update public.habit_completions set deleted_at = now() where id = $1", [completionId(h, yesterday)]))
    expect((await streak()).current_streak).toBe(0)
  })
})

describe('008 end to end: GoTrue sign-up, PostgREST RPCs and the @rock_ht/db web data layer', () => {
  const clients: Record<'a' | 'b', { db: TypedSupabaseClient; id: string }> = {} as never

  beforeAll(async () => {
    for (const k of ['a', 'b'] as const) {
      const db = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as TypedSupabaseClient
      const { data, error } = await db.auth.signUp({ email: `${randomUUID()}@example.com`, password: 'password-1234' })
      if (error) throw error
      if (!data.session) throw new Error('sign-up returned no session (is enable_confirmations off?)')
      clients[k] = { db, id: data.user!.id }
    }
  })

  it('exposes only the auth-bound wrappers over PostgREST', async () => {
    const { db, id } = clients.a
    const direct = await db.rpc('sync_push_for' as never, { p_user: clients.b.id, p_changes: [] } as never)
    expect(direct.error).not.toBeNull()
    const pulled = await db.rpc('sync_pull', { p_cursor: 0, p_limit: 100 })
    expect(pulled.error).toBeNull()
    const page = pulled.data as unknown as Pulled
    expect(page.changes.map((c) => c.row.id)).toEqual([id])
    expect(page.changes[0]!.row.updated_at).toBe('1970-01-01T00:00:00.001Z')

    const pushed = await db.rpc('sync_push', { p_changes: [habit(randomUUID(), 'via rpc', 1)] })
    expect(pushed.error).toBeNull()
    expect(pushed.data).toEqual({ skipped: [] })

    const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
    expect((await anon.rpc('sync_pull', { p_cursor: 0, p_limit: 10 })).error).not.toBeNull()
  })

  it('soft-deletes completions, habits and journal entries, and hides tombstones from every read', async () => {
    const { db, id } = clients.a
    const h = await createHabit(db, id, { title: 'Web', icon: '✨', color: '#fff', frequency: { type: 'daily' } })

    const c = await addCompletion(db, id, { habit_id: h.id, date: '2026-01-05' })
    expect(c.id).toBe(completionId(h.id, '2026-01-05'))
    expect(c.deleted_at).toBeNull()
    const listed = await getCompletions(db, id, { habitId: h.id })
    expect(listed.map((x) => x.id)).toEqual([c.id])
    expect(listed[0]).not.toHaveProperty('habits')
    expect((await getTodayCompletions(db, id, '2026-01-05')).map((x) => x.id)).toEqual([c.id])
    const byDate = await getCompletionForDate(db, h.id, '2026-01-05')
    expect(byDate?.id).toBe(c.id)
    expect(byDate).not.toHaveProperty('habits')

    await removeCompletion(db, h.id, '2026-01-05')
    expect(await getCompletions(db, id, { habitId: h.id })).toEqual([])
    const tomb = await one<{ deleted_at: Date | null }>('select deleted_at from public.habit_completions where id = $1', [c.id])
    expect(tomb.deleted_at).not.toBeNull()

    // Re-completing revives the same row (same deterministic id).
    const again = await addCompletion(db, id, { habit_id: h.id, date: '2026-01-05' })
    expect(again.id).toBe(c.id)
    expect(again.deleted_at).toBeNull()

    // An edit carries its own updated_at, which the server keeps.
    const before = Date.now()
    const edited = await updateHabit(db, { id: h.id, title: 'Web 2' })
    expect(new Date(edited.updated_at).getTime()).toBeGreaterThanOrEqual(before - 5_000)

    const j = await createJournalEntry(db, id, { content: 'note', entry_date: '2026-01-05' })
    await deleteJournalEntry(db, j.id)
    expect((await getJournalEntries(db, id)).map((e) => e.id)).not.toContain(j.id)

    // The completion trigger keeps a streak row for the habit, listed while the habit is live.
    expect((await getStreaks(db, id)).map((x) => x.habit_id)).toContain(h.id)
    expect((await getStreaks(db, id))[0]).not.toHaveProperty('habits')

    await deleteHabit(db, h.id)
    expect((await getHabits(db, id)).map((x) => x.id)).not.toContain(h.id)
    // The streak row outlives the tombstone but is no longer listed.
    expect((await one('select count(*)::int as n from public.habit_streaks where habit_id = $1', [h.id])).n).toBe(1)
    expect((await getStreaks(db, id)).map((x) => x.habit_id)).not.toContain(h.id)
    expect(await getHabit(db, h.id)).toBeNull()
    // Its completions are kept (as on mobile) but no longer listed.
    expect((await one('select count(*)::int as n from public.habit_completions where habit_id = $1 and deleted_at is null', [h.id])).n).toBe(1)
    expect(await getCompletions(db, id, { habitId: h.id })).toEqual([])
    expect(await getTodayCompletions(db, id, '2026-01-05')).toEqual([])
    expect(await getCompletionForDate(db, h.id, '2026-01-05')).toBeNull()
    // Archiving a deleted habit (a stale tab) leaves the tombstone alone.
    const tombBefore = await one('select updated_at, is_archived from public.habits where id = $1', [h.id])
    await archiveHabit(db, h.id)
    expect(await one('select updated_at, is_archived from public.habits where id = $1', [h.id])).toEqual(tombBefore)
    // So does reordering it.
    await reorderHabits(db, [{ id: h.id, sort_order: 99 }])
    expect(await one('select updated_at, is_archived from public.habits where id = $1', [h.id])).toEqual(tombBefore)

    // Mobile pulls the tombstones.
    const page = (await db.rpc('sync_pull', { p_cursor: 0, p_limit: 500 })).data as unknown as Pulled
    const byId = new Map(page.changes.map((ch) => [ch.row.id, ch.row]))
    expect(byId.get(h.id)!.deleted_at).toMatch(ISO_MS)
    expect(byId.get(j.id)!.deleted_at).toMatch(ISO_MS)
  })

  it('never returns another user\'s rows to the web data layer', async () => {
    const a = clients.a
    const b = clients.b
    const h = await createHabit(a.db, a.id, { title: 'mine', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    expect(await getHabit(b.db, h.id)).toBeNull()
    expect(await getHabits(b.db, b.id)).toEqual([])
  })
})
