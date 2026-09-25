import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/test/supabase-fake'

const anthropic = vi.hoisted(() => ({
  streamMock: vi.fn(),
  constructorMock: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: anthropic.streamMock }
    constructor(opts: { apiKey: string }) {
      anthropic.constructorMock(opts)
    }
  },
}))

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: auth.user } })) },
  })),
}))

const service = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: service.from })),
}))

const rateLimit = vi.hoisted(() => ({ fn: vi.fn(() => true) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimit.fn }))

const db = vi.hoisted(() => ({
  getHabits: vi.fn(),
  getStreaks: vi.fn(),
  getLast30DaysCompletions: vi.fn(),
  getProfile: vi.fn(),
}))
vi.mock('@rock_ht/db', () => db)

import { POST } from '../route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/ai/coach', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function fakeStream(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
    },
  }
}

function setPlan(plan: string | null) {
  service.from = createFakeSupabase({
    resolve: () => (plan ? { data: { plan }, error: null } : { data: null, error: null }),
  }).from
}

describe('POST /api/ai/coach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    auth.user = { id: 'user_1' }
    setPlan('pro')
    rateLimit.fn.mockReturnValue(true)
    db.getHabits.mockResolvedValue([])
    db.getStreaks.mockResolvedValue([])
    db.getLast30DaysCompletions.mockResolvedValue([])
    db.getProfile.mockResolvedValue({ timezone: 'UTC' })
    anthropic.streamMock.mockReturnValue(fakeStream('Hi there'))
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    vi.useRealTimers()
  })

  it('returns 500 when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(500)
  })

  it('returns 401 when there is no authenticated user', async () => {
    auth.user = null

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(401)
  })

  it('returns 403 and never calls Anthropic when the plan is not pro', async () => {
    setPlan('free')

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(403)
    expect(anthropic.streamMock).not.toHaveBeenCalled()
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    rateLimit.fn.mockReturnValue(false)

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(429)
    expect(anthropic.streamMock).not.toHaveBeenCalled()
  })

  it('returns 400 when messages is missing or empty', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)

    const res2 = await POST(makeRequest({ messages: [] }))
    expect(res2.status).toBe(400)
  })

  it('streams a 200 response calling Anthropic with the expected model and a system prompt', async () => {
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/plain')

    const text = await res.text()
    expect(text).toBe('Hi there')

    expect(anthropic.constructorMock).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' })
    expect(anthropic.streamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        system: expect.any(String),
        messages: [{ role: 'user', content: 'hi' }],
      })
    )
  })

  it("uses todayIn(profile.timezone) to fetch completions, for a timezone where the date differs from UTC", async () => {
    vi.useFakeTimers()
    // 05:00 UTC on 2026-01-15 is still 2026-01-14 in Pacific/Pago_Pago (UTC-11).
    vi.setSystemTime(new Date('2026-01-15T05:00:00Z'))
    db.getProfile.mockResolvedValue({ timezone: 'Pacific/Pago_Pago' })

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(200)
    expect(db.getLast30DaysCompletions).toHaveBeenCalledWith(
      expect.anything(),
      'user_1',
      '2026-01-14'
    )
  })

  it('falls back to UTC and still returns 200 when getProfile rejects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T05:00:00Z'))
    db.getProfile.mockRejectedValue(new Error('profile lookup failed'))

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(res.status).toBe(200)
    expect(db.getLast30DaysCompletions).toHaveBeenCalledWith(
      expect.anything(),
      'user_1',
      '2026-01-15'
    )
  })
})
