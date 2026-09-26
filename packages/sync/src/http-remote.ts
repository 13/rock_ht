import { normalizeTimestamp } from './merge'
import type { PullResult, SyncChange, SyncRemote } from './types'

export interface HttpRemoteOptions {
  /** Server origin, e.g. `https://rock.example.com` or `http://192.168.1.10:3000`. A trailing slash is ignored. */
  baseUrl: string
  /** Defaults to the global `fetch`, looked up at call time. */
  fetch?: typeof fetch
  /** Auth headers for every request (e.g. the Better Auth session `Cookie`). */
  getHeaders: () => Promise<Record<string, string>>
}

/** Postgres returns `+00:00` offsets and microseconds; the local store compares `toISOString()` strings. */
export function normalizeChange(c: SyncChange): SyncChange {
  const row = { ...c.row, updated_at: normalizeTimestamp(c.row.updated_at) }
  if (row.deleted_at) row.deleted_at = normalizeTimestamp(row.deleted_at)
  return { table: c.table, row }
}

const TIMEOUT_MS = 20_000

/**
 * `SyncRemote` over the self-hosted server's HTTP API:
 * - `POST {baseUrl}/api/sync/push` body `{ changes }` -> 204
 * - `GET {baseUrl}/api/sync/pull?cursor=<string|empty>&limit=<n>` -> 200 `{ changes, cursor, hasMore }`
 * Any non-2xx (e.g. 401 when the session is missing or expired) throws, so `runSync` stops without acking.
 * Every request is aborted after 20s (e.g. a LAN server that stopped answering, or a dropped
 * connection) so a sync run can never hang forever. This uses `AbortController` + `setTimeout`
 * rather than `AbortSignal.timeout`, which isn't guaranteed to exist in React Native's runtime.
 */
export function createHttpRemote({ baseUrl, fetch: f, getHeaders }: HttpRemoteOptions): SyncRemote {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const doFetch: typeof fetch = f ?? ((input, init) => globalThis.fetch(input, init))

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Races the fetch against its own timeout so `call` rejects even if the fetch
    // implementation doesn't observe the abort signal (e.g. a stalled connection, or a
    // test double that never settles) — the abort is a best-effort courtesy on top of that.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`sync ${path.split('?')[0]} timed out after ${TIMEOUT_MS}ms`))
      }, TIMEOUT_MS)
    })
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getHeaders()) }
      const fetching = doFetch(`${base}${path}`, { ...init, signal: controller.signal, headers })
      fetching.catch(() => {}) // avoid an unhandled rejection if the timeout wins the race
      const res = await Promise.race([fetching, timeout])
      if (!res.ok) throw new Error(`sync ${path.split('?')[0]} failed: ${res.status}`)
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async push(changes) {
      await call('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) })
    },
    async pull(cursor, limit): Promise<PullResult> {
      const q = new URLSearchParams({ cursor: cursor ?? '', limit: String(limit) })
      const body = (await (await call(`/api/sync/pull?${q}`)).json()) as PullResult
      return { ...body, changes: body.changes.map(normalizeChange) }
    },
  }
}
