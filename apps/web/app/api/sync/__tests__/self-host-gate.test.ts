import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POST as pushPOST } from '../push/route'
import { GET as pullGET } from '../pull/route'

// The Supabase-configured image ships without DATABASE_URL/BETTER_AUTH_SECRET. These routes must
// 404 in that case rather than have their pool try to connect to localhost or their auth throw.
describe('sync routes 404 when self-host env vars are missing', () => {
  let original: { DATABASE_URL?: string; BETTER_AUTH_SECRET?: string }

  beforeEach(() => {
    original = {
      DATABASE_URL: process.env.DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    }
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
  })

  afterEach(() => {
    if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original.DATABASE_URL
    if (original.BETTER_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = original.BETTER_AUTH_SECRET
  })

  it('POST /api/sync/push -> 404, without touching the request body or session', async () => {
    const res = await pushPOST(new Request('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"changes":[]}',
    }))
    expect(res.status).toBe(404)
  })

  it('GET /api/sync/pull -> 404, without touching the session', async () => {
    const res = await pullGET(new Request('http://localhost/api/sync/pull'))
    expect(res.status).toBe(404)
  })
})
