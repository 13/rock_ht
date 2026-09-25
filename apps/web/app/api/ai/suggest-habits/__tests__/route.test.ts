import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/test/supabase-fake'

const anthropic = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropic.createMock }
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
}))
vi.mock('@rock_ht/db', () => db)

import { POST } from '../route'


function anthropicTextResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

function setPlan(plan: string | null) {
  service.from = createFakeSupabase({
    resolve: () => (plan ? { data: { plan }, error: null } : { data: null, error: null }),
  }).from
}

const suggestionsJson = JSON.stringify([
  { icon: '🧘', title: 'Meditate', reason: 'Complements your morning routine.' },
  { icon: '📖', title: 'Read', reason: 'Pairs well with your evening wind-down.' },
])

describe('POST /api/ai/suggest-habits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    auth.user = { id: 'user_1' }
    setPlan('pro')
    rateLimit.fn.mockReturnValue(true)
    db.getHabits.mockResolvedValue([])
    anthropic.createMock.mockResolvedValue(anthropicTextResponse(suggestionsJson))
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('returns 500 when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const res = await POST()

    expect(res.status).toBe(500)
  })

  it('returns 401 when there is no authenticated user', async () => {
    auth.user = null

    const res = await POST()

    expect(res.status).toBe(401)
  })

  it('returns 403 and never calls Anthropic when the plan is not pro', async () => {
    setPlan('free')

    const res = await POST()

    expect(res.status).toBe(403)
    expect(anthropic.createMock).not.toHaveBeenCalled()
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    rateLimit.fn.mockReturnValue(false)

    const res = await POST()

    expect(res.status).toBe(429)
    expect(anthropic.createMock).not.toHaveBeenCalled()
  })

  it('returns 200 with { suggestions } calling Anthropic with the expected model and a system prompt', async () => {
    const res = await POST()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      suggestions: [
        { icon: '🧘', title: 'Meditate', reason: 'Complements your morning routine.' },
        { icon: '📖', title: 'Read', reason: 'Pairs well with your evening wind-down.' },
      ],
    })

    expect(anthropic.constructorMock).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' })
    expect(anthropic.createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        system: expect.any(String),
      })
    )
  })

  it('returns an empty suggestions array when Anthropic replies with unparsable JSON', async () => {
    anthropic.createMock.mockResolvedValue(anthropicTextResponse('not json'))

    const res = await POST()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ suggestions: [] })
  })
})
