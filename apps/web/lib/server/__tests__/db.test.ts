import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getPool', () => {
  afterEach(() => {
    delete (globalThis as { __rockPgPool?: unknown }).__rockPgPool
    vi.resetModules()
  })

  it('reuses one pool across module reloads (dev HMR) via globalThis', async () => {
    const first = (await import('../db')).getPool()
    vi.resetModules()
    const second = (await import('../db')).getPool()
    expect(second).toBe(first)
    await first.end()
  })

  it('logs idle-client errors instead of crashing the process', async () => {
    const pool = (await import('../db')).getPool()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(pool.listenerCount('error')).toBeGreaterThan(0)
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    await pool.end()
  })
})
