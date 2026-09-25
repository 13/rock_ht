import { describe, it, expect } from 'vitest'
import { completionId } from '../ids'

describe('completionId', () => {
  it('is deterministic for the same habit and date', () => {
    const h = '0b5c6a1e-2f3d-4c5b-8a9e-1f2d3c4b5a6e'
    expect(completionId(h, '2026-09-24')).toBe(completionId(h, '2026-09-24'))
  })
  it('differs across dates', () => {
    const h = '0b5c6a1e-2f3d-4c5b-8a9e-1f2d3c4b5a6e'
    expect(completionId(h, '2026-09-24')).not.toBe(completionId(h, '2026-09-25'))
  })
  it('is a version-5 uuid', () => {
    expect(completionId('x', '2026-09-24')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
