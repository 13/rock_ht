import {
  completionId, isNewer, SYNC_TABLES,
  type OutboxEntry, type SyncChange, type SyncLocal, type SyncRow, type SyncTable,
} from '@rock_ht/sync'
import { parseFrequency, frequencyToJson, today } from '@rock_ht/utils'
import type {
  CompletionRow, CreateHabitInput, CreateJournalEntryInput, HabitRow, HabitWithFrequency, JournalEntry,
  ProfileRow, ToggleCompletionInput, UpdateHabitInput, UpdateJournalEntryInput, UpdateProfileInput,
} from '@rock_ht/types'
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from './backup'
import { COLUMNS, fromSqlRow, toSqlRow } from './codec'
import type { SqlDriver, SqlParam } from './driver'

export interface LocalStoreDeps {
  driver: SqlDriver
  newId: () => string
  now: () => string
  /** IANA zone stored on new profiles. Defaults to the runtime's zone. */
  timeZone?: () => string
  /**
   * Rows per transaction for bulk work (`claim`'s re-queue, `sync.applyRemote`), so UI reads queued
   * on the same driver can run between chunks instead of waiting for the whole batch.
   */
  chunkSize?: number
}

export type LocalStore = ReturnType<typeof createLocalStore>

const CURSOR_KEY = 'sync_cursor'
/** The signed-in account this device's rows belong to (see `claim`; read by the mobile app's `resolveUserId`). */
const ACCOUNT_KEY = 'account_user_id'
/** Progress of `claim`'s chunked re-queue: `{ table, after: rowid }`, or null when none is pending. */
const CLAIM_KEY = 'claim_progress'
/** Tables `claim` re-queues in chunks after its first transaction (they have no dependents). */
const CLAIM_CHUNKED = ['habit_completions', 'journal_entries'] as const
type ClaimProgress = { table: (typeof CLAIM_CHUNKED)[number]; after: number }

/**
 * Floor for a claimed-but-not-pushed profile's `updated_at` (see `claim`, `pushLocalProfile: false`).
 * Older than any real timestamp, so `isNewer` (`@rock_ht/sync`) always accepts the server's profile.
 */
const EPOCH = '1970-01-01T00:00:00.000Z'

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Drop keys whose value is `undefined` so a partial input never overwrites a column with null. */
function filterDefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

export function createLocalStore({ driver, newId, now, timeZone = deviceTimeZone, chunkSize = 200 }: LocalStoreDeps) {
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

  /**
   * Highest outbox seq handed to a push by `sync.readOutbox`. Entries at or below it may be on the
   * wire; `ackOutbox(seq)` will delete them, so they must never be rewritten (a rewrite would be acked
   * without having been pushed). Only ever grows: new entries always get a larger seq (AUTOINCREMENT).
   * In memory on purpose — after a restart nothing is in flight.
   */
  let inFlightUpto = 0

  /**
   * Queue `row` for push, compacted per `(tbl, id)`: if the row already has a pending entry that no
   * push has read yet, that entry is rewritten in place with the latest row (and any later duplicates
   * dropped) instead of appending another. The outbox therefore stays bounded by the number of rows
   * while sync is Off.
   *
   * In place, not delete-and-append: keeping the entry's original position keeps a habit ahead of the
   * completions queued after it — the server silently drops a completion whose habit it doesn't have
   * yet (`sync_push_for`), so moving the habit behind them would lose them.
   *
   * Always called with the caller's `tx`, inside the same transaction as the row's upsert.
   */
  async function enqueue(db: SqlDriver, table: SyncTable, row: SyncRow): Promise<void> {
    const json = JSON.stringify(row)
    const pending = await db.first<{ seq: number | null }>(
      'SELECT MIN(seq) AS seq FROM outbox WHERE tbl = ? AND row_id = ? AND seq > ?', [table, row.id, inFlightUpto],
    )
    if (pending?.seq != null) {
      await db.run('UPDATE outbox SET row_json = ? WHERE seq = ?', [json, pending.seq])
      await db.run('DELETE FROM outbox WHERE tbl = ? AND row_id = ? AND seq > ?', [table, row.id, pending.seq])
      return
    }
    await db.run('INSERT INTO outbox (tbl, row_id, row_json) VALUES (?, ?, ?)', [table, row.id, json])
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

  /**
   * Completions never cascade-delete when their habit is soft-deleted (`deleteHabit` only
   * touches the `habits` row), so every read of `habit_completions` must additionally exclude
   * rows whose habit is gone, or a deleted habit's history keeps counting toward streaks/exports.
   */
  const LIVE_HABIT_FILTER = 'habit_id IN (SELECT id FROM habits WHERE deleted_at IS NULL)'

  async function listCompletions(
    userId: string,
    opts: { habitId?: string; startDate?: string; endDate?: string } = {},
  ): Promise<CompletionRow[]> {
    const where = ['user_id = ?', LIVE_HABIT_FILTER]
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

  /**
   * One-tap toggle: flips the completion based on the row's *current* state inside the write
   * transaction, not a snapshot the caller read earlier (e.g. from a UI query cache that can be
   * stale under a double-tap or two in-flight toggles). Same live/tombstone semantics as
   * `setCompletion`: missing or tombstoned -> live, done -> tombstone. Returns the resulting
   * done state so the caller can reconcile an optimistic update.
   */
  async function toggleCompletion(userId: string, input: ToggleCompletionInput): Promise<boolean> {
    const id = completionId(input.habit_id, input.date)
    let done = false
    await write('habit_completions', async (tx) => {
      const cur = await getRow('habit_completions', id, tx)
      const ts = now()
      if (!cur || cur.deleted_at) {
        done = true
        return {
          id, habit_id: input.habit_id, user_id: userId, completed_date: input.date,
          value: input.value ?? 1, note: input.note ?? cur?.note ?? null,
          created_at: (cur?.created_at as string) ?? ts, updated_at: ts, deleted_at: null,
        }
      }
      done = false
      return { ...cur, deleted_at: ts, updated_at: ts }
    })
    return done
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

  async function exportBackup(userId: string): Promise<Backup> {
    const tables: Record<SyncTable, SyncRow[]> = {
      profiles: await selectRows('profiles', 'id = ?', [userId]),
      habits: await selectRows('habits', 'user_id = ?', [userId]),
      habit_completions: await selectRows('habit_completions', `user_id = ? AND ${LIVE_HABIT_FILTER}`, [userId]),
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
   * Move offline data to a signed-in account and queue it for upload.
   *
   * Invariant: the local device only ever tracks one active local identity's rows at a time (see
   * `resolveUserId` in the mobile app), so every row is rewritten to `toUserId` unconditionally.
   *
   * Re-queued rows keep their own `updated_at`: re-pointing `user_id` isn't an edit, and bumping every
   * row would make this device's copies beat newer edits made elsewhere under last-write-wins.
   *
   * `pushLocalProfile: true` (new account sign-up): the local profile is rewritten to `toUserId`,
   * `updated_at` bumped, and queued, so it wins LWW once pushed. This is the only bump.
   *
   * `pushLocalProfile: false` (sign-in to an existing account): the profile row is rewritten to
   * `toUserId` locally so the app keeps working until the next pull, but it is NOT queued — otherwise
   * the device's placeholder profile (empty email, defaults) would win LWW over the real server
   * profile on push. Its `updated_at` is floored to `EPOCH` rather than left at the placeholder's real
   * timestamp: `isNewer` (`@rock_ht/sync`) only accepts a pulled row when it's strictly newer than the
   * local one, so a server profile last edited before this device's first launch would otherwise be
   * older than the placeholder and get rejected by the pull, and then overwritten by the next push.
   * The epoch floor guarantees any real server profile, however old, wins the next pull.
   *
   * Chunked: the first transaction rewrites ids, resets the outbox and cursor, and re-queues the
   * profile and habits (few rows, and the parents every completion/journal entry needs pushed first).
   * Completions and journal entries — the bulk — are then re-queued `chunkSize` rows per transaction
   * (`finishClaim`), with progress stored in `meta` in the same transaction as each chunk. If the app
   * dies midway, `sync.readOutbox` finishes the re-queue before anything is pushed.
   *
   * Contract: the first transaction also writes meta `account_user_id = toUserId` (read by the mobile
   * app's `resolveUserId`), so identity and row ownership switch atomically. If it fails, `claim`
   * rejects and nothing changed. Once `claim` resolves, the device belongs to `toUserId`; re-queueing
   * may still be in progress and is resumed automatically (by `sync.readOutbox`). The returned
   * `completed` settles when this call's re-queue attempt ends; it never rejects — a failed chunk is
   * logged with `console.warn` and left for `readOutbox` to resume.
   */
  async function claim(toUserId: string, opts: { pushLocalProfile: boolean }): Promise<{ completed: Promise<void> }> {
    await driver.transaction(async (tx) => {
      for (const t of ['habits', 'habit_completions', 'journal_entries'] as const) {
        await tx.run(`UPDATE ${t} SET user_id = ?`, [toUserId])
      }
      // A profile row may already sit at `toUserId` (e.g. a previous sign-in to this same account,
      // later disconnected). Drop it first so re-pointing the active row's id below can't collide with
      // it on the primary key, then only touch rows that aren't already `toUserId`.
      await tx.run('DELETE FROM profiles WHERE id = ?', [toUserId])
      await tx.run('UPDATE profiles SET id = ?, updated_at = ? WHERE id <> ?',
        [toUserId, opts.pushLocalProfile ? now() : EPOCH, toUserId])
      await tx.run('DELETE FROM outbox')
      await setMeta(CURSOR_KEY, null, tx)
      const heads = opts.pushLocalProfile ? (['profiles', 'habits'] as const) : (['habits'] as const)
      for (const t of heads) {
        const raws = await tx.all<Record<string, SqlParam>>(`SELECT * FROM ${t} ORDER BY rowid`)
        for (const raw of raws) await enqueue(tx, t, fromSqlRow(t, raw))
      }
      const start: ClaimProgress = { table: CLAIM_CHUNKED[0], after: 0 }
      await setMeta(CLAIM_KEY, JSON.stringify(start), tx)
      await setMeta(ACCOUNT_KEY, toUserId, tx)
    })
    const completed = finishClaim().catch((e: unknown) => {
      console.warn('claim: re-queue interrupted; sync.readOutbox will resume it', e)
    })
    return { completed }
  }

  /** Re-queue the rest of a pending `claim`, one chunk per transaction. No-op when none is pending. */
  async function finishClaim(): Promise<void> {
    for (let pending = true; pending;) {
      await driver.transaction(async (tx) => {
        const raw = await getMeta(CLAIM_KEY, tx)
        if (!raw) { pending = false; return }
        const p = JSON.parse(raw) as ClaimProgress
        const rows = await tx.all<Record<string, SqlParam> & { _rowid: number }>(
          `SELECT rowid AS _rowid, * FROM ${p.table} WHERE rowid > ? ORDER BY rowid LIMIT ?`, [p.after, chunkSize],
        )
        for (const r of rows) await enqueue(tx, p.table, fromSqlRow(p.table, r))
        let next: ClaimProgress | null = null
        if (rows.length === chunkSize) next = { table: p.table, after: rows[rows.length - 1]!._rowid }
        else {
          const i = CLAIM_CHUNKED.indexOf(p.table)
          if (i + 1 < CLAIM_CHUNKED.length) next = { table: CLAIM_CHUNKED[i + 1]!, after: 0 }
        }
        await setMeta(CLAIM_KEY, next ? JSON.stringify(next) : null, tx)
      })
    }
  }

  const sync: SyncLocal = {
    async readOutbox(limit) {
      // An interrupted claim's re-queue must finish before anything is pushed.
      await finishClaim()
      let rows: { seq: number; tbl: SyncTable; row_json: string }[] = []
      // In a transaction so `inFlightUpto` is raised before any later write can compact these entries.
      await driver.transaction(async (tx) => {
        rows = await tx.all('SELECT seq, tbl, row_json FROM outbox ORDER BY seq ASC LIMIT ?', [limit])
        if (rows.length) inFlightUpto = Math.max(inFlightUpto, rows[rows.length - 1]!.seq)
      })
      return rows.map((r): OutboxEntry => ({ seq: r.seq, change: { table: r.tbl, row: JSON.parse(r.row_json) } }))
    },
    async ackOutbox(uptoSeq) {
      await driver.run('DELETE FROM outbox WHERE seq <= ?', [uptoSeq])
    },
    getRow: (table, id) => getRow(table, id),
    getCursor: () => getMeta(CURSOR_KEY),
    /**
     * Last-write-wins against the row as it is *inside* each transaction (a local write may have landed
     * since the engine's `getRow`). Applied `chunkSize` rows per transaction; the cursor is stored with
     * the last chunk only, so if a chunk fails the page is pulled again and re-applied (idempotent:
     * rows already applied are no longer newer).
     */
    async applyRemote(changes: SyncChange[], cursor) {
      let i = 0
      do {
        const chunk = changes.slice(i, i + chunkSize)
        i += chunkSize
        const last = i >= changes.length
        await driver.transaction(async (tx) => {
          for (const c of chunk) {
            if (isNewer(c.row, await getRow(c.table, c.row.id, tx))) await upsert(tx, c.table, c.row)
          }
          if (last) await setMeta(CURSOR_KEY, cursor, tx)
        })
      } while (i < changes.length)
    },
  }

  return {
    ensureProfile, getProfile, updateProfile,
    listHabits, getHabit, createHabit, updateHabit, deleteHabit,
    listCompletions, setCompletion, toggleCompletion, setCompletionNote,
    listJournal, createJournal, updateJournal, deleteJournal,
    getMeta: (key: string) => getMeta(key),
    setMeta: (key: string, value: string | null) => setMeta(key, value),
    exportBackup, importBackup,
    claim, sync,
  }
}
