import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { rateLimit as RateLimitFn } from '../rate-limit'

// The module keeps its state (`store`, the prune `setInterval`) at module
// scope, so each test re-imports a fresh copy via `vi.resetModules()` rather
// than sharing state across tests.
async function freshRateLimit(): Promise<typeof RateLimitFn> {
  vi.resetModules()
  const mod = await import('../rate-limit')
  return mod.rateLimit
}

describe('rateLimit', () => {
  beforeEach(() => {
    // Fake timers so the module's prune `setInterval` never schedules a real
    // OS timer, and so we can advance past `windowMs` deterministically.
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first call for a key', async () => {
    const rateLimit = await freshRateLimit()
    expect(rateLimit('key', 3, 1000)).toBe(true)
  })

  it('allows calls up to the limit', async () => {
    const rateLimit = await freshRateLimit()
    expect(rateLimit('key', 3, 1000)).toBe(true)
    expect(rateLimit('key', 3, 1000)).toBe(true)
    expect(rateLimit('key', 3, 1000)).toBe(true)
  })

  it('blocks the call after the limit is reached', async () => {
    const rateLimit = await freshRateLimit()
    rateLimit('key', 3, 1000)
    rateLimit('key', 3, 1000)
    rateLimit('key', 3, 1000)
    expect(rateLimit('key', 3, 1000)).toBe(false)
  })

  it('resets the key once windowMs has elapsed', async () => {
    const rateLimit = await freshRateLimit()
    rateLimit('key', 1, 1000)
    expect(rateLimit('key', 1, 1000)).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(rateLimit('key', 1, 1000)).toBe(true)
  })

  it('tracks independent keys separately', async () => {
    const rateLimit = await freshRateLimit()
    rateLimit('key-a', 1, 1000)
    expect(rateLimit('key-a', 1, 1000)).toBe(false)
    // A different key has its own budget.
    expect(rateLimit('key-b', 1, 1000)).toBe(true)
  })
})
