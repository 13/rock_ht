import { isNewer } from './merge'
import type { SyncChange, SyncLocal, SyncRemote } from './types'

export interface SyncReport {
  pushed: number
  pulled: number
}

/**
 * One sync pass: push the whole outbox, then pull until the server has nothing newer than our cursor.
 *
 * Push first so the pull that follows already reflects our own writes (the server has merged them,
 * so our rows come back at most as equal and are skipped). Each pushed batch is acked only after
 * `remote.push` resolves, so a failed push leaves the outbox intact for the next run. Each pulled page
 * is filtered with `isNewer` against the local row (`local.applyRemote` checks again inside its own
 * transaction, since a local write may land in between) and stored together with its cursor, so an
 * interrupted pull resumes from the last applied page. A page that reports `hasMore` but returns no
 * changes and the cursor it was given throws rather than looping forever.
 */
export async function runSync(
  local: SyncLocal,
  remote: SyncRemote,
  opts: { batchSize?: number } = {},
): Promise<SyncReport> {
  const batchSize = opts.batchSize ?? 200
  let pushed = 0
  let pulled = 0

  for (;;) {
    const entries = await local.readOutbox(batchSize)
    if (entries.length === 0) break
    await remote.push(entries.map((e) => e.change))
    await local.ackOutbox(entries[entries.length - 1]!.seq)
    pushed += entries.length
    if (entries.length < batchSize) break
  }

  let cursor = await local.getCursor()
  for (;;) {
    const page = await remote.pull(cursor, batchSize)
    // A server bug (e.g. a cursor that doesn't advance) would otherwise make this loop spin forever.
    if (page.hasMore && page.changes.length === 0 && page.cursor === cursor) {
      throw new Error(
        `sync pull made no progress: server returned hasMore with no changes and the same cursor (${String(cursor)})`,
      )
    }
    const accepted: SyncChange[] = []
    for (const change of page.changes) {
      const existing = await local.getRow(change.table, change.row.id)
      if (isNewer(change.row, existing)) accepted.push(change)
    }
    await local.applyRemote(accepted, page.cursor)
    pulled += accepted.length
    cursor = page.cursor
    if (!page.hasMore) break
  }

  return { pushed, pulled }
}
