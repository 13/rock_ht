import { afterEach, describe, expect, it, vi } from 'vitest'

const resend = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/email', () => ({ getResend: () => ({ emails: { send: resend.send } }) }))

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
  throwOnCreate: false,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    if (auth.throwOnCreate) throw new Error('Supabase not configured')
    return { auth: { getUser: vi.fn(async () => ({ data: { user: auth.user } })) } }
  }),
}))

import { POST } from '../route'

function req(body: unknown) {
  return new Request('http://localhost/api/email/welcome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/email/welcome', () => {
  afterEach(() => {
    resend.send.mockReset()
    auth.user = null
    auth.throwOnCreate = false
  })

  it('401s without a signed-in Supabase user', async () => {
    const res = await POST(req({ email: 'attacker@evil.com', name: 'X' }))
    expect(res.status).toBe(401)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('401s when Supabase is not configured (self-host image, or the guard from createClient)', async () => {
    auth.throwOnCreate = true
    const res = await POST(req({ name: 'Ada' }))
    expect(res.status).toBe(401)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it("sends only to the signed-in user's own email, ignoring any address in the body", async () => {
    auth.user = { email: 'real-user@example.com' }
    resend.send.mockResolvedValue({ data: {}, error: null })
    const res = await POST(req({ email: 'attacker@evil.com', name: 'Ada' }))
    expect(res.status).toBe(200)
    expect(resend.send).toHaveBeenCalledTimes(1)
    const call = resend.send.mock.calls[0]![0] as { to: string }
    expect(call.to).toBe('real-user@example.com')
  })

  it('HTML-escapes the name', async () => {
    auth.user = { email: 'real-user@example.com' }
    resend.send.mockResolvedValue({ data: {}, error: null })
    await POST(req({ name: '<script>alert(1)</script>' }))
    const call = resend.send.mock.calls[0]![0] as { html: string }
    expect(call.html).not.toContain('<script>alert(1)</script>')
    expect(call.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('falls back to the email local-part when name is missing', async () => {
    auth.user = { email: 'jane.doe@example.com' }
    resend.send.mockResolvedValue({ data: {}, error: null })
    await POST(req({}))
    const call = resend.send.mock.calls[0]![0] as { html: string }
    expect(call.html).toContain('Welcome, jane.doe!')
  })

  it('returns ok:false with 200 (not a thrown error) when Resend errors', async () => {
    auth.user = { email: 'real-user@example.com' }
    resend.send.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await POST(req({ name: 'Ada' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })
})
