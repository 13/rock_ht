import { expect, test } from '@playwright/test'

// Boots the production build (see playwright.config.ts webServer) against a
// dummy public Supabase URL. These pages must render for a signed-out
// visitor with no live Supabase instance: with no session cookie, the
// server-side `supabase.auth.getUser()` calls in middleware and on `/`
// resolve locally (AuthSessionMissingError) without ever hitting the
// network, so no backend is required here.

test('the landing page renders and shows the product name', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBeLessThan(400)
  // The <title> ("rock habit tracker — ...", set in app/layout.tsx metadata)
  // is a stable place to assert the product name — more stable than any one
  // piece of marketing copy on the page.
  await expect(page).toHaveTitle(/rock/i)
})

test('the login page renders a form with an email input', async ({ page }) => {
  const response = await page.goto('/login')
  expect(response?.status()).toBeLessThan(400)
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

test('the web manifest resolves and links to a working icon', async ({ page, request }) => {
  await page.goto('/')

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()

  const manifestResponse = await request.get(manifestHref!)
  expect(manifestResponse.status()).toBe(200)
  expect(manifestResponse.headers()['content-type']).toContain('json')

  const manifest = await manifestResponse.json()
  expect(typeof manifest.name).toBe('string')
  expect(manifest.name.length).toBeGreaterThan(0)

  expect(Array.isArray(manifest.icons)).toBe(true)
  expect(manifest.icons.length).toBeGreaterThan(0)

  const iconResponse = await request.get(manifest.icons[0].src)
  expect(iconResponse.status()).toBe(200)
})

test('/api/health returns 200', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  const json = await response.json()
  expect(json).toEqual({ status: 'ok' })
})
