import { getSessionUserId } from '@/lib/server/auth'
import { getPool } from '@/lib/server/db'
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT } from '@/lib/server/sync-limits'
import { isSelfHostConfigured } from '@/lib/server/self-host-config'

export const runtime = 'nodejs'

const MAX_BIGINT = BigInt('9223372036854775807') // Postgres bigint max

type PullRow = { result: { changes: unknown[]; cursor: string | null; hasMore: boolean } }

/**
 * `GET /api/sync/pull?cursor=<digits|empty>&limit=<n>` -> 200 `{ changes, cursor, hasMore }`.
 * Same auth rules as push (session cookie, no `Origin` required, 401 without a session).
 * An empty page returns the caller's cursor unchanged (null for a first pull).
 */
export async function GET(req: Request) {
  // 404 (not 500) when this image isn't the self-host one, or self-host env vars are missing.
  if (!isSelfHostConfigured()) return new Response('Not found', { status: 404 })
  const userId = await getSessionUserId(req)
  if (!userId) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const cursorParam = url.searchParams.get('cursor') || '0'
  if (!/^\d{1,19}$/.test(cursorParam) || BigInt(cursorParam) > MAX_BIGINT) {
    return new Response('Bad cursor', { status: 400 })
  }
  const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_PULL_LIMIT) : DEFAULT_PULL_LIMIT
  const { rows } = await getPool().query<PullRow>(
    'select public.sync_pull_for($1, $2::bigint, $3) as result',
    [userId, cursorParam, limit],
  )
  const result = rows[0]!.result
  return Response.json({ ...result, cursor: result.cursor ?? (cursorParam === '0' ? null : cursorParam) })
}
