import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSelfHostConfigured } from '../self-host-config'

describe('isSelfHostConfigured', () => {
  let original: { DATABASE_URL?: string; BETTER_AUTH_SECRET?: string }

  beforeEach(() => {
    original = {
      DATABASE_URL: process.env.DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    }
  })

  afterEach(() => {
    if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original.DATABASE_URL
    if (original.BETTER_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = original.BETTER_AUTH_SECRET
  })

  it('is false when both are unset (e.g. the Supabase-configured image)', () => {
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    expect(isSelfHostConfigured()).toBe(false)
  })

  it('is false when only one is set', () => {
    delete process.env.DATABASE_URL
    process.env.BETTER_AUTH_SECRET = 'secret'
    expect(isSelfHostConfigured()).toBe(false)

    process.env.DATABASE_URL = 'postgres://x/y'
    delete process.env.BETTER_AUTH_SECRET
    expect(isSelfHostConfigured()).toBe(false)
  })

  it('is true when both are set', () => {
    process.env.DATABASE_URL = 'postgres://x/y'
    process.env.BETTER_AUTH_SECRET = 'secret'
    expect(isSelfHostConfigured()).toBe(true)
  })
})
