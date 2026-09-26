import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET as authGET, POST as authPOST } from '../route'

// The Supabase-configured image ships without DATABASE_URL/BETTER_AUTH_SECRET. This route must 404
// in that case rather than have better-auth's pool try to connect to localhost.
describe('auth route 404s when self-host env vars are missing', () => {
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

  it('GET -> 404', async () => {
    const res = await authGET(new Request('http://localhost/api/auth/get-session'))
    expect(res.status).toBe(404)
  })

  it('POST -> 404', async () => {
    const res = await authPOST(new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))
    expect(res.status).toBe(404)
  })
})
