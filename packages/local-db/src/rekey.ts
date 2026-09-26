import { completionId, type SyncRow } from '@rock_ht/sync'

/** The tables whose rows are keyed by id per account (the profile is keyed by the account itself). */
export interface RekeyTables {
  habits: SyncRow[]
  habit_completions: SyncRow[]
  journal_entries: SyncRow[]
}

/**
 * Give every row a new id, for data that is being copied into an account while its current ids may
 * already exist on a server under another account (the server never lets one account write another
 * account's ids: `sync_push_for` skips them). Used by `claim` (an account switch) and `importBackup`
 * (another account's backup).
 *
 * Habits and journal entries get `freshId(table, oldId)`; completions are re-derived as
 * `completionId(newHabitId, completed_date)` (the id every device must agree on). References follow:
 * `habit_completions.habit_id` and `journal_entries.habit_id`. Tombstones are dropped rather than
 * re-keyed: under a new id they delete nothing on the server. With them go the completions of a
 * deleted or missing habit (hidden locally already), and a journal entry about a deleted or missing
 * habit loses the link (the server would write it as null anyway).
 *
 * Pure: returns new rows in the input order and leaves the input untouched.
 */
export function rekeyRows(
  tables: RekeyTables,
  freshId: (table: 'habits' | 'journal_entries', oldId: string) => string,
): RekeyTables {
  const habitIds = new Map<string, string>()
  const habits: SyncRow[] = []
  for (const h of tables.habits) {
    if (h.deleted_at) continue
    const id = freshId('habits', h.id)
    habitIds.set(h.id, id)
    habits.push({ ...h, id })
  }
  const habit_completions: SyncRow[] = []
  for (const c of tables.habit_completions) {
    const habitId = habitIds.get(c.habit_id as string)
    if (c.deleted_at || !habitId) continue
    habit_completions.push({ ...c, id: completionId(habitId, c.completed_date as string), habit_id: habitId })
  }
  const journal_entries: SyncRow[] = []
  for (const j of tables.journal_entries) {
    if (j.deleted_at) continue
    const link = j.habit_id == null ? null : (habitIds.get(j.habit_id as string) ?? null)
    journal_entries.push({ ...j, id: freshId('journal_entries', j.id), habit_id: link })
  }
  return { habits, habit_completions, journal_entries }
}

/**
 * The rows of a backup that an import may write: tombstones are dropped (a backup restores data, it
 * never deletes or revives anything), and with them the completions of a habit the backup itself
 * holds as a tombstone. The same rule `rekeyRows` applies; it additionally drops completions whose
 * habit isn't in the backup at all, since their new id derives from the habit's new id.
 *
 * Pure: returns new arrays in the input order.
 */
export function dropTombstones(tables: RekeyTables): RekeyTables {
  const deletedHabits = new Set(tables.habits.filter((h) => h.deleted_at).map((h) => h.id))
  return {
    habits: tables.habits.filter((h) => !h.deleted_at),
    habit_completions: tables.habit_completions.filter(
      (c) => !c.deleted_at && !deletedHabits.has(c.habit_id as string)),
    journal_entries: tables.journal_entries.filter((j) => !j.deleted_at),
  }
}

/** Total rows across the three tables (for counting what an import dropped). */
export function countRows(tables: RekeyTables): number {
  return tables.habits.length + tables.habit_completions.length + tables.journal_entries.length
}
