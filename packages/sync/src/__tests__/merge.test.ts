import { describe, it, expect } from 'vitest'
import { isNewer, normalizeTimestamp } from '../merge'
import type { SyncRow } from '../types'

const row = (updated_at: string): SyncRow => ({ id: 'a', updated_at, deleted_at: null })

describe('isNewer', () => {
  it('accepts when no local row exists', () => {
    expect(isNewer(row('2026-01-01T00:00:00.000Z'), null)).toBe(true)
  })
  it('accepts strictly newer timestamps', () => {
    expect(isNewer(row('2026-01-02T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(true)
  })
  it('rejects equal timestamps (echo of our own push)', () => {
    expect(isNewer(row('2026-01-01T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(false)
  })
  it('rejects older timestamps', () => {
    expect(isNewer(row('2025-12-31T00:00:00.000Z'), row('2026-01-01T00:00:00.000Z'))).toBe(false)
  })
})

describe('normalizeTimestamp', () => {
  it('converts Postgres offset format to toISOString format', () => {
    expect(normalizeTimestamp('2026-09-24T20:00:00.123+00:00')).toBe('2026-09-24T20:00:00.123Z')
  })
  it('truncates microseconds to milliseconds', () => {
    expect(normalizeTimestamp('2026-09-24T20:00:00.123456+00:00')).toBe('2026-09-24T20:00:00.123Z')
  })
})
