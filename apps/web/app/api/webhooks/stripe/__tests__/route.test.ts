import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, eqFilters, updateValues, type FakeSupabase } from '@/test/supabase-fake'

const { fakeStripe, constructEvent, retrieveSubscription } = vi.hoisted(() => {
  const constructEvent = vi.fn()
  const retrieveSubscription = vi.fn()
  return {
    constructEvent,
    retrieveSubscription,
    fakeStripe: {
      webhooks: { constructEvent },
      subscriptions: { retrieve: retrieveSubscription },
    },
  }
})

let fakeSupabase: FakeSupabase
let headerValue: string | null = 'sig_test_123'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === 'stripe-signature' ? headerValue : null),
  })),
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => fakeStripe),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => fakeSupabase),
}))

import { POST } from '../route'

function makeRequest(body = '{}') {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body,
  })
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headerValue = 'sig_test_123'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    fakeSupabase = createFakeSupabase()
  })

  it('returns 400 and never verifies when the signature header is missing', async () => {
    headerValue = null

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    expect(constructEvent).not.toHaveBeenCalled()
  })

  it('returns 400 with a signature-verification message when constructEvent throws, and writes nothing', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad signature')
    })

    const res = await POST(makeRequest())
    const text = await res.text()

    expect(res.status).toBe(400)
    expect(text.toLowerCase()).toContain('signature verification failed')
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('calls constructEvent with the raw body, the signature header, and the webhook secret', async () => {
    constructEvent.mockReturnValue({ type: 'unknown.event', data: { object: {} } })
    const body = JSON.stringify({ id: 'evt_1' })

    await POST(makeRequest(body))

    expect(constructEvent).toHaveBeenCalledWith(body, 'sig_test_123', 'whsec_test_secret')
  })

  it('updates the subscription to pro on checkout.session.completed in subscription mode', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    })
    retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      current_period_end: 1_700_000_000,
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(retrieveSubscription).toHaveBeenCalledWith('sub_123')
    expect(fakeSupabase.from).toHaveBeenCalledWith('subscriptions')

    expect(fakeSupabase.queries).toHaveLength(1)
    const query = fakeSupabase.queries[0]!
    expect(updateValues(query)).toEqual({
      stripe_subscription_id: 'sub_123',
      plan: 'pro',
      status: 'active',
      current_period_end: new Date(1_700_000_000 * 1000).toISOString(),
    })
    expect(eqFilters(query)).toEqual([['stripe_customer_id', 'cus_123']])
  })

  it('does not write to the DB for checkout.session.completed in payment mode', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          customer: 'cus_123',
        },
      },
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(retrieveSubscription).not.toHaveBeenCalled()
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it.each([
    ['active', 'pro'],
    ['trialing', 'pro'],
    ['past_due', 'free'],
  ] as const)(
    'sets plan %s -> %s on customer.subscription.updated',
    async (status, expectedPlan) => {
      constructEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            status,
            current_period_end: 1_700_000_000,
            customer: 'cus_123',
          },
        },
      })

      const res = await POST(makeRequest())

      expect(res.status).toBe(200)
      expect(fakeSupabase.queries).toHaveLength(1)
      const query = fakeSupabase.queries[0]!
      expect(updateValues(query)).toEqual({
        stripe_subscription_id: 'sub_123',
        plan: expectedPlan,
        status,
        current_period_end: new Date(1_700_000_000 * 1000).toISOString(),
      })
      expect(eqFilters(query)).toEqual([['stripe_customer_id', 'cus_123']])
    }
  )

  it('clears the subscription on customer.subscription.deleted', async () => {
    constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
        },
      },
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(fakeSupabase.queries).toHaveLength(1)
    const query = fakeSupabase.queries[0]!
    expect(updateValues(query)).toEqual({
      plan: 'free',
      status: 'canceled',
      stripe_subscription_id: null,
      current_period_end: null,
    })
    expect(eqFilters(query)).toEqual([['stripe_customer_id', 'cus_123']])
  })

  it('returns 200 and writes nothing for an unknown event type', async () => {
    constructEvent.mockReturnValue({ type: 'some.other.event', data: { object: {} } })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})
