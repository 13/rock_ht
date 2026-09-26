import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))

afterEach(() => {
  vi.unstubAllEnvs()
})

function unconfigure() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
}

describe('isSupabaseConfigured', () => {
  it('is true only when both the URL and the anon key are set', async () => {
    const { isSupabaseConfigured } = await import('../config')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    expect(isSupabaseConfigured()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(isSupabaseConfigured()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(isSupabaseConfigured()).toBe(false)
  })
})

describe('without Supabase config', () => {
  it('the server createClient throws "Supabase not configured"', async () => {
    unconfigure()
    const { createClient } = await import('../server')
    await expect(createClient()).rejects.toThrow('Supabase not configured')
  })

  it('the browser createClient throws "Supabase not configured"', async () => {
    unconfigure()
    const { createClient } = await import('../client')
    expect(() => createClient()).toThrow('Supabase not configured')
  })

  it('the middleware passes every request through (no login redirect)', async () => {
    unconfigure()
    const { updateSession } = await import('../middleware')
    const res = await updateSession(new NextRequest('http://localhost:3000/dashboard'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
