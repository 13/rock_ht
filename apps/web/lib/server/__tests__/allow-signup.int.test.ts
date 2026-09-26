// Integration test: ALLOW_SIGNUP=false closes sign-up (`emailAndPassword.disableSignUp`) without
// locking out accounts created before it was set. Run: npm run test:int --workspace=apps/web
//
// Sets `process.env.ALLOW_SIGNUP` and calls `vi.resetModules()` so `auth.ts`'s cached `getAuth()`
// instance picks up the new value on its next call. Safe here only because vitest gives each
// `*.int.test.ts` file its own isolated module registry (and its own `globalThis`) by default, so
// this never touches the auth instance the other integration test files build.
import { afterAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool } from '@/lib/server/db'

const BASE = process.env.BETTER_AUTH_URL!
const PASSWORD = 'correct-horse-battery-staple'
const EXPO_HEADERS = { 'content-type': 'application/json', 'expo-origin': 'rockht://' }

afterAll(async () => {
  delete process.env.ALLOW_SIGNUP
  await getPool().end()
})

describe('ALLOW_SIGNUP=false', () => {
  it('blocks new sign-ups but leaves sign-in for existing accounts working', async () => {
    const email = `${randomUUID()}@example.com`

    // ALLOW_SIGNUP unset (default "true"): sign-up is allowed, as today.
    const { POST: authPOST } = await import('@/app/api/auth/[...all]/route')
    const signUpOk = await authPOST(new Request(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST', headers: EXPO_HEADERS,
      body: JSON.stringify({ email, password: PASSWORD, name: 'Ada' }),
    }))
    expect(signUpOk.status).toBe(200)

    process.env.ALLOW_SIGNUP = 'false'
    vi.resetModules()
    const { POST: authPOSTClosed } = await import('@/app/api/auth/[...all]/route')

    const blocked = await authPOSTClosed(new Request(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST', headers: EXPO_HEADERS,
      body: JSON.stringify({ email: `${randomUUID()}@example.com`, password: PASSWORD, name: 'Grace' }),
    }))
    expect(blocked.status).toBe(400)

    const signIn = await authPOSTClosed(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST', headers: EXPO_HEADERS,
      body: JSON.stringify({ email, password: PASSWORD }),
    }))
    expect(signIn.status).toBe(200)
  })
})
