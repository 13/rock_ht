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
