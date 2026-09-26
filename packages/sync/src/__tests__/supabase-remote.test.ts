import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSupabaseRemote, type RpcResponse } from '../supabase-remote'
import { SyncAuthError } from '../http-remote'
import type { SyncChange } from '../types'

// Typed mock: an untyped vi.fn(async () => …) has no parameters, so toHaveBeenCalledWith(...) fails type-check.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResponse>

const ok = (data: unknown): RpcResponse => ({ data, error: null, status: 200 })
const change: SyncChange = {
  table: 'habits',
  row: { id: 'h1', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createSupabaseRemote', () => {
  it('calls sync_push with changes', async () => {
    const rpc = vi.fn<Rpc>(async () => ok({ skipped: [] }))
    await createSupabaseRemote({ rpc }).push([change])
    expect(rpc).toHaveBeenCalledWith('sync_push', { p_changes: [change] })
  })

  it('returns the changes sync_push reports as skipped', async () => {
    const skipped = [{ tbl: 'habits', id: 'h1', reason: 'rejected' }]
    const rpc = vi.fn<Rpc>(async () => ok({ skipped }))
    expect(await createSupabaseRemote({ rpc }).push([change])).toEqual({ skipped })
  })

  it('treats a push with no data or no skipped list as nothing skipped', async () => {
    expect(await createSupabaseRemote({ rpc: async () => ok(null) }).push([])).toEqual({ skipped: [] })
    expect(await createSupabaseRemote({ rpc: async () => ok({}) }).push([])).toEqual({ skipped: [] })
  })

  it('calls sync_pull with a numeric cursor and normalizes timestamps', async () => {
    const rpc = vi.fn<Rpc>(async () => ok({
      changes: [{
        table: 'habits',
        row: {
          id: 'h',
          updated_at: '2026-01-01T00:00:00+00:00',
          deleted_at: '2026-01-02T00:00:00.123456+00:00',
          created_at: '2025-12-31T00:00:00.654321+00:00',
        },
      }],
      cursor: '9',
      hasMore: true,
    }))
    const remote = createSupabaseRemote({ rpc })
    const res = await remote.pull(null, 100)
    expect(rpc).toHaveBeenCalledWith('sync_pull', { p_cursor: 0, p_limit: 100 })
    expect(res.changes[0]!.row.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(res.changes[0]!.row.deleted_at).toBe('2026-01-02T00:00:00.123Z')
    expect(res.changes[0]!.row.created_at).toBe('2025-12-31T00:00:00.654Z')
    expect(res.cursor).toBe('9')
    expect(res.hasMore).toBe(true)

    await remote.pull('9', 100)
    expect(rpc).toHaveBeenLastCalledWith('sync_pull', { p_cursor: 9, p_limit: 100 })
  })

  it('keeps the previous cursor on an empty page', async () => {
    const rpc = vi.fn<Rpc>(async () => ok({ changes: [], cursor: null, hasMore: false }))
    expect((await createSupabaseRemote({ rpc }).pull('5', 10)).cursor).toBe('5')
    expect((await createSupabaseRemote({ rpc }).pull(null, 10)).cursor).toBe(null)
  })

  it('pulls from the start for a cursor that is not a server_seq (e.g. garbage in storage)', async () => {
    const rpc = vi.fn<Rpc>(async () => ok({ changes: [], cursor: null, hasMore: false }))
    await createSupabaseRemote({ rpc }).pull('abc', 10)
    expect(rpc).toHaveBeenCalledWith('sync_pull', { p_cursor: 0, p_limit: 10 })
  })

  it('throws a malformed pull body instead of treating it as empty', async () => {
    await expect(createSupabaseRemote({ rpc: async () => ok(null) }).pull(null, 10)).rejects.toThrow(/sync_pull/)
  })

  it('throws rpc errors as plain errors', async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: null, error: { message: 'too many changes', code: '54000' }, status: 400 }))
    const err = await createSupabaseRemote({ rpc }).push([]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SyncAuthError)
    expect((err as Error).message).toMatch('too many changes')
  })

  it('keeps network failures (status 0) as plain errors so the UI can say "couldn\'t reach"', async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 }))
    const err = await createSupabaseRemote({ rpc }).pull(null, 10).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(SyncAuthError)
    expect((err as Error).message).toMatch('Network request failed')
  })

  it.each([
    ['not authenticated (28000)', { message: 'not authenticated', code: '28000' }, 400],
    ['a 401 (anon role: no session)', { message: 'permission denied for function sync_push', code: '42501' }, 401],
    ['an expired JWT (PGRST301)', { message: 'JWT expired', code: 'PGRST301' }, 401],
    ['an invalid JWT (PGRST303)', { message: 'JWT claims validation failed', code: 'PGRST303' }, 401],
    ['"JWT expired" without a status', { message: 'JWT expired' }, undefined],
  ])('maps %s to SyncAuthError', async (_label, error, status) => {
    const rpc = vi.fn<Rpc>(async () => ({ data: null, error, status }))
    await expect(createSupabaseRemote({ rpc }).push([])).rejects.toBeInstanceOf(SyncAuthError)
    await expect(createSupabaseRemote({ rpc }).pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('maps a SyncAuthError thrown by the client (e.g. no session) through unchanged', async () => {
    const rpc = vi.fn<Rpc>(async () => { throw new SyncAuthError('no session') })
    await expect(createSupabaseRemote({ rpc }).push([])).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('times out an rpc that never settles', async () => {
    vi.useFakeTimers()
    const rpc = vi.fn<Rpc>(() => new Promise<RpcResponse>(() => {}))
    const p = createSupabaseRemote({ rpc }).pull(null, 10)
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })
})
