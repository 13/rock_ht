import { normalizeChange, SyncAuthError } from './http-remote'
import type { PullResult, PushResult, SkippedChange, SyncRemote } from './types'

/** What supabase-js's `client.rpc()` resolves with (the fields this remote reads). */
export interface RpcResponse {
  data: unknown
  error: { message: string; code?: string } | null
  /** HTTP status; 0 when the request never reached the server (network failure). */
  status?: number
}

/** The slice of a `SupabaseClient` the remote needs, so tests (and other clients) can stand in. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResponse>
}

const TIMEOUT_MS = 20_000

// 28000: sync_push/sync_pull raise it when auth.uid() is null. PGRST301/302/303: PostgREST rejected
// the JWT (expired, anonymous access off, bad claims). A 401 is also what PostgREST answers when
// the request ran as `anon` (no session: supabase-js falls back to the anon key), since both RPCs
// are revoked from anon.
const AUTH_CODES = new Set(['28000', 'PGRST301', 'PGRST302', 'PGRST303'])

function toError(fn: string, res: RpcResponse): Error {
  const err = res.error!
  const label = `${fn} failed: ${err.message}`
  if (res.status === 401 || (err.code && AUTH_CODES.has(err.code)) || /jwt expired/i.test(err.message)) {
    return new SyncAuthError(label)
  }
  return new Error(label)
}

/** Races `p` against a 20s timeout (supabase-js's fetch has none), like `createHttpRemote`. Exported
 *  so the mobile Supabase backend can wrap its own auth calls (`getSession`, `getUser`,
 *  `refreshSession`) in the same budget instead of duplicating it. */
export async function withTimeout<T>(fn: string, p: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${fn} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  })
  const call = Promise.resolve(p)
  call.catch(() => {}) // avoid an unhandled rejection if the timeout wins the race
  try {
    return await Promise.race([call, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `SyncRemote` over the Supabase RPCs of supabase/migrations/008_sync.sql, both bound to the
 * caller's `auth.uid()`:
 * - `sync_push(p_changes jsonb)` -> `{ skipped: [{ tbl, id, reason }] }`
 * - `sync_pull(p_cursor bigint, p_limit int)` -> `{ changes, cursor, hasMore }`; `cursor` is null on
 *   an empty page, in which case the caller's cursor is kept (as the self-hosted route does).
 * Auth failures (no session, expired JWT, `not authenticated`) throw `SyncAuthError`, so the app
 * shows "signed out" instead of a generic error; everything else throws a plain `Error`.
 */
export function createSupabaseRemote(client: RpcClient): SyncRemote {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await withTimeout(fn, client.rpc(fn, args))
    if (res.error) throw toError(fn, res)
    return res.data
  }

  return {
    async push(changes): Promise<PushResult> {
      const data = (await call('sync_push', { p_changes: changes })) as { skipped?: SkippedChange[] } | null
      return { skipped: Array.isArray(data?.skipped) ? data.skipped : [] }
    },
    async pull(cursor, limit): Promise<PullResult> {
      // server_seq is a bigint; a cursor from this remote is always its decimal text.
      const p_cursor = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0
      const body = (await call('sync_pull', { p_cursor, p_limit: limit })) as Partial<PullResult> | null
      if (!body || !Array.isArray(body.changes)) throw new Error('sync_pull returned an unexpected body')
      return {
        changes: body.changes.map(normalizeChange),
        cursor: body.cursor ?? cursor,
        hasMore: body.hasMore === true,
      }
    },
  }
}
