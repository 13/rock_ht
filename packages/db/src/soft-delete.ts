/**
 * The update that deletes a synced row (habits, habit_completions, journal_entries). Deletes are
 * soft on every client: offline devices only learn about a delete by pulling the tombstone, and
 * `updated_at` moves with it so the delete wins last-write-wins against older edits.
 */
export function softDelete(at: string = new Date().toISOString()) {
  return { deleted_at: at, updated_at: at };
}
