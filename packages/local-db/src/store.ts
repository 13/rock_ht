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
