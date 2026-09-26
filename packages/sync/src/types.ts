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

/** A pushed change the server did not apply and never will (e.g. its id belongs to another account). */
export interface SkippedChange {
  tbl: string
  id: string | null
  /** `foreign_owner` (the id is another account's) or `invalid` (a bad value or missing parent). */
  reason: string
  /** Server detail for `invalid` (the Postgres error message). */
  detail?: string
}

export interface PushResult {
  skipped: SkippedChange[]
}

export interface SyncRemote {
  /**
   * Resolves once the server has taken the batch. Changes it could never apply come back in
   * `skipped` (a remote that can't tell may resolve with nothing); they are acked like the rest.
   */
  push(changes: SyncChange[]): Promise<PushResult | void>
  pull(cursor: string | null, limit: number): Promise<PullResult>
}

export interface OutboxEntry {
  seq: number
  change: SyncChange
}

export interface SyncLocal {
  /**
   * The oldest `limit` outbox entries, in push order. Reading marks the returned entries in-flight:
   * they are never compacted (rewritten in place by a later edit of the same row) until acked, so an
   * ack can't drop an edit that was never pushed; later edits of those rows append new entries.
   */
  readOutbox(limit: number): Promise<OutboxEntry[]>
  /** Delete outbox entries with seq <= uptoSeq. */
  ackOutbox(uptoSeq: number): Promise<void>
  getRow(table: SyncTable, id: string): Promise<SyncRow | null>
  getCursor(): Promise<string | null>
  /** Clears the stored pull cursor (e.g. on disconnect), so a later connect to a different backend
   *  or account never resumes a pull from a cursor another server minted (both the self-hosted and
   *  Supabase routes use the same plain-digits cursor format, so a stale one from either would
   *  otherwise look valid to the other). */
  resetCursor(): Promise<void>
  /**
   * Write the rows that are newer than the local copy (checked inside the write transaction), without
   * creating outbox entries, then store the cursor. May commit in chunks, but the cursor is stored
   * only once every row is applied, so a failure means the same page is pulled and applied again.
   */
  applyRemote(changes: SyncChange[], cursor: string | null): Promise<void>
}
