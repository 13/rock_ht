import { getSessionUserId } from '@/lib/server/auth'
import { getPool } from '@/lib/server/db'
import { MAX_PUSH_BYTES, MAX_PUSH_CHANGES } from '@/lib/server/sync-limits'

export const runtime = 'nodejs'

/**
 * `POST /api/sync/push` body `{ changes: SyncChange[] }` -> 204 when every change was applied (or
 * lost last-write-wins), 200 `{ skipped: [{ tbl, id, reason, detail? }] }` when `sync_push_for`
 * skipped some (an id another account owns, or a change it can't apply). The client acks both: a
 * skipped change would be skipped again forever, so it only surfaces the count as a warning.
 * Authenticated by the better-auth session cookie only: the mobile client sends it as an explicit
 * `Cookie` header with no `Origin`, so nothing here may require one. 401 without a session (the
 * client maps it to "signed out"). 415 unless the body is declared as JSON, 413 over 5 MB or 500
 * changes. Each change is merged independently by `sync_push_for`; a change it can't apply is
 * skipped (and reported, see above), so one bad row never blocks the outbox. Any other
 * database error answers 500 with nothing committed, and the client retries without acking.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!/^application\/json(\s*;|$)/i.test(contentType.trim())) {
    return new Response('Unsupported media type', { status: 415 })
  }
  // Checked before anything reads the body (or the session store).
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_PUSH_BYTES) return new Response('Payload too large', { status: 413 })

  const userId = await getSessionUserId(req)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  // A chunked body declares no length: bound what is actually read, too.
  const text = await readBounded(req, MAX_PUSH_BYTES)
  if (text === null) return new Response('Payload too large', { status: 413 })
  let body: { changes?: unknown }
  try {
    body = JSON.parse(text) as { changes?: unknown }
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!body || !Array.isArray(body.changes)) return new Response('Bad request', { status: 400 })
  if (body.changes.length > MAX_PUSH_CHANGES) return new Response('Too many changes', { status: 413 })
  let skipped: unknown[]
  try {
    const { rows } = await getPool().query<{ result: { skipped?: unknown[] } | null }>(
      'select public.sync_push_for($1, $2::jsonb) as result', [userId, JSON.stringify(body.changes)])
    skipped = rows[0]?.result?.skipped ?? []
  } catch (err) {
    console.error('[sync/push] failed', err)
    return new Response('Sync push failed', { status: 500 })
  }
  if (skipped.length === 0) return new Response(null, { status: 204 })
  console.warn(`[sync/push] ${skipped.length} change(s) skipped for ${userId}`)
  return Response.json({ skipped }, { status: 200 })
}

/** The body as text, or null once it exceeds `limit` bytes (reading stops there). */
async function readBounded(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
