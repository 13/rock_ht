import { describe, it, expect } from 'vitest'
import { todayIn } from '../dates'

describe('todayIn', () => {
  it('returns the previous UTC calendar date in a zone behind UTC', () => {
    const result = todayIn('Pacific/Pago_Pago', new Date('2026-03-10T05:00:00Z'))
    expect(result).toBe('2026-03-09')
  })

  it('returns the next UTC calendar date in a zone ahead of UTC', () => {
    const result = todayIn('Pacific/Kiritimati', new Date('2026-03-10T11:00:00Z'))
    expect(result).toBe('2026-03-11')
  })

  it('matches the UTC calendar date for the UTC zone', () => {
    const result = todayIn('UTC', new Date('2026-03-10T23:59:59Z'))
    expect(result).toBe('2026-03-10')
  })

  it('falls back to UTC for an invalid time zone', () => {
    const result = todayIn('Not/AZone', new Date('2026-03-10T23:00:00Z'))
    expect(result).toBe('2026-03-10')
  })
})
