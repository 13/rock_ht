export const SYNC_TABLES = ['profiles', 'habits', 'habit_completions', 'journal_entries'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** A row as stored in Postgres (jsonb columns as objects), plus sync metadata. */
export interface SyncRow {
  id: string
  /** ISO-8601 UTC set by the device that made the change. Last write wins. */
  updated_at: string
  /** Tombstone. Non-null means the row is deleted. */
  deleted_at: string | null
  [column: string]: unknown
}

export interface SyncChange {
  table: SyncTable
  row: SyncRow
}

export interface PullResult {
  changes: SyncChange[]
  /** Opaque; pass back on the next pull. */
  cursor: string | null
  hasMore: boolean
}

export interface SyncRemote {
  push(changes: SyncChange[]): Promise<void>
  pull(cursor: string | null, limit: number): Promise<PullResult>
}

export interface OutboxEntry {
  seq: number
  change: SyncChange
}

export interface SyncLocal {
  readOutbox(limit: number): Promise<OutboxEntry[]>
  /** Delete outbox entries with seq <= uptoSeq. */
  ackOutbox(uptoSeq: number): Promise<void>
  getRow(table: SyncTable, id: string): Promise<SyncRow | null>
  getCursor(): Promise<string | null>
  /**
   * Write the rows that are newer than the local copy (checked inside the write transaction), without
   * creating outbox entries, then store the cursor. May commit in chunks, but the cursor is stored
   * only once every row is applied, so a failure means the same page is pulled and applied again.
   */
  applyRemote(changes: SyncChange[], cursor: string | null): Promise<void>
}
