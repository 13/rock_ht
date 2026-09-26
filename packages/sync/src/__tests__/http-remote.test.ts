import { describe, it, expect, vi } from 'vitest'
import { createHttpRemote } from '../http-remote'

describe('createHttpRemote', () => {
  it('POSTs changes to /api/sync/push with auth headers', async () => {
    // Typed so toHaveBeenCalledWith/mock.calls type-check (package tsconfigs include __tests__).
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test/', fetch, getHeaders: async () => ({ Cookie: 'a=b' }) })
    await r.push([])
    expect(fetch).toHaveBeenCalledWith('https://x.test/api/sync/push', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Cookie: 'a=b', 'Content-Type': 'application/json' }),
    }))
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ changes: [] })
  })

  it('GETs pull with cursor and normalizes timestamps', async () => {
    const body = {
      changes: [{ table: 'habits', row: { id: 'h', updated_at: '2026-01-01T00:00:00+00:00', deleted_at: '2026-01-02T00:00:00.123456+00:00' } }],
      cursor: '7', hasMore: false,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    const res = await r.pull('3', 50)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=3&limit=50')
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.changes[0]!.row.deleted_at).toBe('2026-01-02T00:00:00.123Z')
    expect(res.cursor).toBe('7')
    expect(res.hasMore).toBe(false)
  })

  it('sends an empty cursor for the first pull', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ changes: [], cursor: null, hasMore: false }), { status: 200 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await r.pull(null, 10)
    expect(fetch.mock.calls[0]![0]).toBe('https://x.test/api/sync/pull?cursor=&limit=10')
  })

  it('throws on non-2xx', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('no', { status: 401 }))
    const r = createHttpRemote({ baseUrl: 'https://x.test', fetch, getHeaders: async () => ({}) })
    await expect(r.pull(null, 10)).rejects.toThrow('401')
  })
})
