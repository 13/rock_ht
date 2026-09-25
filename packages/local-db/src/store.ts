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

/** Drop keys whose value is `undefined` so a partial input never overwrites a column with null. */
function filterDefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

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

  /**
   * Local write: `compute` reads the current row (if any) via `tx` and returns the row to persist, or
   * null for a no-op. The read and the upsert+outbox insert all run inside the same exclusive
   * transaction, so a concurrent write can't interleave between the read and the write (TOCTOU fix,
   * review round 1: the previous version read via `driver` before `write` opened its transaction).
   */
  async function write(table: SyncTable, compute: (tx: SqlDriver) => Promise<SyncRow | null>): Promise<SyncRow | null> {
    let result: SyncRow | null = null
    await driver.transaction(async (tx) => {
      const row = await compute(tx)
      if (!row) return
      await upsert(tx, table, row)
      await enqueue(tx, table, row)
      result = row
    })
    return result
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

  function defaultProfileRow(userId: string): SyncRow {
    const ts = now()
    return {
      id: userId, email: '', display_name: null, avatar_url: null, timezone: timeZone(), theme: 'dark',
      onboarding_completed: false, time_format: '12h', date_format: 'MM/DD/YYYY',
      created_at: ts, updated_at: ts, deleted_at: null,
    }
  }

  async function ensureProfile(userId: string): Promise<ProfileRow> {
    const existing = await getProfile(userId)
    if (existing) return existing
    const row = defaultProfileRow(userId)
    // Not queued: the server creates profiles on signup; local edits later are queued.
    await upsert(driver, 'profiles', row)
    return row as unknown as ProfileRow
  }

  async function updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileRow> {
    const row = await write('profiles', async (tx) => {
      const cur = (await getRow('profiles', userId, tx)) ?? defaultProfileRow(userId)
      return { ...cur, ...filterDefined(input), updated_at: now() }
    })
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
    await write('habits', async () => row)
    return toHabit(row)
  }

  async function updateHabit(input: UpdateHabitInput) {
    const row = await write('habits', async (tx) => {
      const cur = await getRow('habits', input.id, tx)
      if (!cur || cur.deleted_at) throw new Error(`habit ${input.id} not found`)
      const { id: _id, frequency, ...rest } = input
      const defined = filterDefined(rest)
      return {
        ...cur,
        ...defined,
        ...(frequency ? { frequency: frequencyToJson(frequency) } : {}),
        updated_at: now(),
      }
    })
    return toHabit(row!)
  }

  async function deleteHabit(id: string) {
    await write('habits', async (tx) => {
      const cur = await getRow('habits', id, tx)
      if (!cur) return null
      const ts = now()
      return { ...cur, deleted_at: ts, updated_at: ts }
    })
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
    await write('habit_completions', async (tx) => {
      const cur = await getRow('habit_completions', id, tx)
      const ts = now()
      if (done) {
        return {
          id, habit_id: input.habit_id, user_id: userId, completed_date: input.date,
          value: input.value ?? 1, note: input.note ?? cur?.note ?? null,
          created_at: (cur?.created_at as string) ?? ts, updated_at: ts, deleted_at: null,
        }
      }
      if (cur && !cur.deleted_at) return { ...cur, deleted_at: ts, updated_at: ts }
      return null
    })
  }

  async function setCompletionNote(habitId: string, date: string, note: string) {
    await write('habit_completions', async (tx) => {
      const cur = await getRow('habit_completions', completionId(habitId, date), tx)
      if (!cur || cur.deleted_at) return null
      return { ...cur, note: note || null, updated_at: now() }
    })
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
    await write('journal_entries', async () => row)
    return row as unknown as JournalEntry
  }

  async function updateJournal(input: UpdateJournalEntryInput) {
    const row = await write('journal_entries', async (tx) => {
      const cur = await getRow('journal_entries', input.id, tx)
      if (!cur || cur.deleted_at) throw new Error(`journal entry ${input.id} not found`)
      return {
        ...cur,
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.mood !== undefined ? { mood: input.mood } : {}),
        updated_at: now(),
      }
    })
    return row as unknown as JournalEntry
  }

  async function deleteJournal(id: string) {
    await write('journal_entries', async (tx) => {
      const cur = await getRow('journal_entries', id, tx)
      if (!cur) return null
      const ts = now()
      return { ...cur, deleted_at: ts, updated_at: ts }
    })
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

  /**
   * Move offline data to a signed-in account and queue it for upload. The local device only ever
   * tracks one active local identity's rows at a time (see `resolveUserId` in the mobile app), so every
   * row is rewritten to `toUserId` unconditionally.
   *
   * `pushLocalProfile: true` (new account sign-up): the local profile is rewritten to `toUserId`,
   * `updated_at` bumped, and queued, so it wins LWW once pushed.
   *
   * `pushLocalProfile: false` (sign-in to an existing account): the profile row is rewritten to
   * `toUserId` locally so the app keeps working until the next pull, but its `updated_at` is NOT
   * bumped and it is NOT queued — otherwise the device's placeholder profile (empty email, defaults)
   * would win LWW over the real server profile on push.
   */
  async function claim(toUserId: string, opts: { pushLocalProfile: boolean }) {
    await driver.transaction(async (tx) => {
      for (const t of ['habits', 'habit_completions', 'journal_entries'] as const) {
        await tx.run(`UPDATE ${t} SET user_id = ?, updated_at = ?`, [toUserId, now()])
      }
      if (opts.pushLocalProfile) {
        await tx.run('UPDATE profiles SET id = ?, updated_at = ?', [toUserId, now()])
      } else {
        await tx.run('UPDATE profiles SET id = ?', [toUserId])
      }
      await tx.run('DELETE FROM outbox')
      await setMeta(CURSOR_KEY, null, tx)
      const tables = opts.pushLocalProfile
        ? (['profiles', 'habits', 'habit_completions', 'journal_entries'] as const)
        : (['habits', 'habit_completions', 'journal_entries'] as const)
      for (const t of tables) {
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
