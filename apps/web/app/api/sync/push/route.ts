import { getSessionUserId } from '@/lib/server/auth'
import { getPool } from '@/lib/server/db'
import { MAX_PUSH_CHANGES } from '@/lib/server/sync-limits'

export const runtime = 'nodejs'

/**
 * `POST /api/sync/push` body `{ changes: SyncChange[] }` -> 204.
 * Authenticated by the better-auth session cookie only: the mobile client sends it as an explicit
 * `Cookie` header with no `Origin`, so nothing here may require one. 401 without a session (the
 * client maps it to "signed out"). Each change is merged independently by `sync_push_for`; a change
 * it can't apply is skipped (logged as a Postgres warning), so one bad row never blocks the outbox.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId(req)
  if (!userId) return new Response('Unauthorized', { status: 401 })
  let body: { changes?: unknown }
  try {
    body = (await req.json()) as { changes?: unknown }
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!body || !Array.isArray(body.changes)) return new Response('Bad request', { status: 400 })
  if (body.changes.length > MAX_PUSH_CHANGES) return new Response('Too many changes', { status: 413 })
  await getPool().query('select public.sync_push_for($1, $2::jsonb)', [userId, JSON.stringify(body.changes)])
  return new Response(null, { status: 204 })
}
