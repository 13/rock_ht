import { describe, it, expect, vi } from 'vitest'
import { createHttpRemote, SyncAuthError } from '../http-remote'

describe('createHttpRemote', () => {
  it('POSTs changes to /api/sync/push with auth headers', async () => {
    // Typed so toHaveBeenCalledWith/mock.calls type-check (package tsconfigs include __tests__).
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test/', fetch, getHeaders: async () => ({ Cookie: 'a=b' }) })
    await r.push([])
    expect(fetch).toHaveBeenCalledWith('https://x.test/api/sync/push', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Cookie: 'a=b', 'Content-Type': 'application/json' }),
      credentials: 'omit',
    }))
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ changes: [] })
  })

  it('returns no skipped changes for a 204 push (a server that predates skipped reporting)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    expect(await r.push([])).toEqual({ skipped: [] })
  })

  it('returns the changes the server reports as skipped', async () => {
    const skipped = [{ tbl: 'habits', id: 'h1', reason: 'foreign_owner' }]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ skipped }), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    expect(await r.push([])).toEqual({ skipped })
  })

  it('treats a 200 push without a skipped list (or an empty body) as nothing skipped', async () => {
    const r1 = createHttpRemote({ baseUrl: 'https://x.test', fetch: async () => new Response('{}', { status: 200 }), getHeaders: async () => ({}) })
    expect(await r1.push([])).toEqual({ skipped: [] })
    const r2 = createHttpRemote({ baseUrl: 'https://x.test', fetch: async () => new Response('', { status: 200 }), getHeaders: async () => ({}) })
    expect(await r2.push([])).toEqual({ skipped: [] })
  })

  it('treats a 200 push with a non-JSON body (e.g. a proxy error page) as nothing skipped, not a thrown error', async () => {
    const r = createHttpRemote({
      baseUrl: 'https://x.test',
      fetch: async () => new Response('<html>Bad Gateway</html>', { status: 200 }),
      getHeaders: async () => ({}),
    })
    expect(await r.push([])).toEqual({ skipped: [] })
  })

  it('GETs pull with cursor and normalizes timestamps', async () => {
    const body = {
      changes: [{
        table: 'habits',
        row: {
          id: 'h',
          updated_at: '2026-01-01T00:00:00+00:00',
          deleted_at: '2026-01-02T00:00:00.123456+00:00',
          created_at: '2025-12-31T00:00:00.654321+00:00',
        },
      }],
      cursor: '7', hasMore: false,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    const res = await r.pull('3', 50)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=3&limit=50')
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.changes[0]!.row.deleted_at).toBe('2026-01-02T00:00:00.123Z')
    expect(res.changes[0]!.row.created_at).toBe('2025-12-31T00:00:00.654Z')
    expect(res.cursor).toBe('7')
    expect(res.hasMore).toBe(false)
  })

  it('sends credentials: omit so only the explicit Cookie header carries auth', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ changes: [], cursor: null, hasMore: false }), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await r.pull(null, 10)
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit' }))
  })

  it('sends an empty cursor for the first pull', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ changes: [], cursor: null, hasMore: false }), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await r.pull(null, 10)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=&limit=10')
  })

  it('throws on non-2xx', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('no', { status: 500 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await expect(r.pull(null, 10)).rejects.toThrow('500')
  })

  it('throws a SyncAuthError on 401, so the caller can tell an expired session apart from other failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('no', { status: 401 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await expect(r.pull(null, 10)).rejects.toThrow(SyncAuthError)
    await expect(r.push([])).rejects.toThrow(SyncAuthError)
  })

  it('rejects with a timeout error when the request never resolves', async () => {
    vi.useFakeTimers()
    try {
      // Never resolves and ignores the abort signal, like a stalled connection or a test
      // double that doesn't implement AbortController support.
      const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}))
      const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
      const pending = expect(r.pull(null, 10)).rejects.toThrow(/timed? ?out/i)
      await vi.advanceTimersByTimeAsync(20_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })
})
