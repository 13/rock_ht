# Reliability & Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rock safe to operate in production: fix the broken auth middleware, add security response headers, rate-limit AI API routes, instrument Sentry for error visibility, and add PostHog for product analytics.

**Architecture:** Security headers and rate limiting are handled at the middleware/config layer. Sentry captures unhandled exceptions and is initialized server-side in `instrumentation.ts` and client-side in `instrumentation-client.ts`. PostHog is a lightweight client-side event tracker wrapped in a provider. Rate limiting uses a per-process in-memory store (sufficient for single-instance deployments; swap to Upstash Redis for multi-instance).

**Tech Stack:** `@sentry/nextjs@9`, `posthog-js`, Next.js security headers, in-memory rate limiter.

## Global Constraints

- TypeScript everywhere, strict mode
- The `proxy.ts` file is a bug: Next.js requires the middleware file be named `middleware.ts` exporting `middleware`. Fix this in Task 1 before anything else.
- Sentry DSN is a server env var (`SENTRY_DSN`) — also expose as `NEXT_PUBLIC_SENTRY_DSN` for client-side
- PostHog key is safe to expose as `NEXT_PUBLIC_POSTHOG_KEY` (it's a write-only client key)
- Rate limiter is initialized per Node.js process — does not persist across restarts or across multiple instances
- AI routes already have `export const runtime = 'nodejs'` — preserve this when modifying them
- CSP must allow Supabase domains for realtime websockets (`wss://*.supabase.co`)

---

## File Structure

**Create:**
- `apps/web/lib/rate-limit.ts` — sliding-window in-memory rate limiter
- `apps/web/instrumentation.ts` — Sentry server + edge initialization (Next.js 15+ instrumentation hook)
- `apps/web/instrumentation-client.ts` — Sentry client-side initialization
- `apps/web/lib/posthog.ts` — PostHog singleton for server-side events
- `apps/web/providers/posthog-provider.tsx` — PostHog client provider component

**Rename/Modify:**
- `apps/web/proxy.ts` → `apps/web/middleware.ts` — fix: rename file and export name to `middleware`
- `apps/web/next.config.mjs` — add security response headers + `withSentryConfig` wrapper
- `apps/web/app/layout.tsx` — wrap children in PostHog provider
- `apps/web/app/api/ai/coach/route.ts` — add per-user rate limit (20 req/hour)
- `apps/web/app/api/ai/suggest-habits/route.ts` — add rate limit (5 req/day)
- `apps/web/app/api/ai/journal-prompt/route.ts` — add rate limit (10 req/day)
- `apps/web/package.json` — add `@sentry/nextjs`, `posthog-js`
- `.env.example` — add `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- `apps/web/.env.local.example` — same
- `apps/mobile/app/_layout.tsx` — initialize Sentry for React Native
- `apps/mobile/package.json` — add `@sentry/react-native`

---

### Task 1: Fix broken auth middleware

**Files:**
- Delete: `apps/web/proxy.ts`
- Create: `apps/web/middleware.ts`

**Why this is critical:** `proxy.ts` exports `proxy` (not `middleware`) and is not named `middleware.ts`. Next.js ignores it entirely, meaning the `updateSession` function that refreshes Supabase auth cookies never runs. This causes sporadic auth failures on server-rendered pages when cookies expire mid-session.

- [ ] **Step 1: Create correct middleware.ts**

```typescript
// apps/web/middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Delete proxy.ts**

```bash
rm apps/web/proxy.ts
```

- [ ] **Step 3: Verify middleware runs**

```bash
npm run dev:web
```

Open the app in browser and navigate to a protected route while logged out. Verify redirect to `/login` works consistently. Check the Next.js console — you should see no warnings about missing middleware.

- [ ] **Step 4: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/middleware.ts
git rm apps/web/proxy.ts
git commit -m "fix(auth): rename proxy.ts to middleware.ts so auth session refresh actually runs"
```

---

### Task 2: Security response headers

**Files:**
- Modify: `apps/web/next.config.mjs`

**Interfaces:**
- Produces: HTTP headers on every response: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP

- [ ] **Step 1: Update next.config.mjs with security headers**

Replace the entire content of `apps/web/next.config.mjs`:

```javascript
// apps/web/next.config.mjs

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : '*.supabase.co'

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com https://*.posthog.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://${supabaseHost};
  font-src 'self';
  connect-src 'self'
    https://${supabaseHost}
    wss://${supabaseHost}
    https://api.anthropic.com
    https://js.stripe.com
    https://api.stripe.com
    https://*.ingest.sentry.io
    https://*.posthog.com
    https://app.posthog.com;
  frame-src https://js.stripe.com https://hooks.stripe.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`.replace(/\s{2,}/g, ' ').trim()

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@rock_ht/db', '@rock_ht/types', '@rock_ht/utils'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 2: Verify headers are present**

```bash
npm run dev:web
# In a separate terminal:
curl -I http://localhost:3000 | grep -E "strict-transport|x-frame|content-security|x-content-type"
```

Expected: All 4 headers appear in the response.

- [ ] **Step 3: Check app still works**

Open the app in browser. Verify no CSP errors in browser DevTools console (errors appear as red `Content-Security-Policy` messages). If errors appear, widen the relevant directive.

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.mjs
git commit -m "feat(security): add HSTS, X-Frame-Options, CSP, and other security headers"
```

---

### Task 3: In-memory rate limiter + apply to AI routes

**Files:**
- Create: `apps/web/lib/rate-limit.ts`
- Modify: `apps/web/app/api/ai/coach/route.ts`
- Modify: `apps/web/app/api/ai/suggest-habits/route.ts`
- Modify: `apps/web/app/api/ai/journal-prompt/route.ts`

**Interfaces:**
- Produces: `rateLimit(key: string, limit: number, windowMs: number): boolean` — returns `true` if request is allowed, `false` if over limit

- [ ] **Step 1: Implement rate limiter**

```typescript
// apps/web/lib/rate-limit.ts

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Prune expired entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key)
  }
}, 10 * 60 * 1000)

/**
 * Returns true if the request is within the rate limit, false if it should be blocked.
 * key: unique identifier (e.g. `ai_coach:user-uuid`)
 * limit: max requests allowed in windowMs
 * windowMs: time window in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false

  entry.count++
  return true
}
```

- [ ] **Step 2: Apply to AI coach route**

In `apps/web/app/api/ai/coach/route.ts`, add after the user auth check (the line `if (!user) return ...`):

```typescript
import { rateLimit } from '@/lib/rate-limit'

// ... after the auth check:
const allowed = rateLimit(`ai_coach:${user.id}`, 20, 60 * 60 * 1000) // 20 req/hour
if (!allowed) {
  return Response.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
}
```

- [ ] **Step 3: Apply to suggest-habits route**

In `apps/web/app/api/ai/suggest-habits/route.ts`, add after the user auth check:

```typescript
import { rateLimit } from '@/lib/rate-limit'

// after auth check:
const allowed = rateLimit(`ai_suggest:${user.id}`, 5, 24 * 60 * 60 * 1000) // 5 req/day
if (!allowed) {
  return Response.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429 })
}
```

- [ ] **Step 4: Apply to journal-prompt route**

In `apps/web/app/api/ai/journal-prompt/route.ts`, add after the user auth check:

```typescript
import { rateLimit } from '@/lib/rate-limit'

// after auth check:
const allowed = rateLimit(`ai_journal:${user.id}`, 10, 24 * 60 * 60 * 1000) // 10 req/day
if (!allowed) {
  return Response.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429 })
}
```

- [ ] **Step 5: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/rate-limit.ts apps/web/app/api/ai/coach/route.ts apps/web/app/api/ai/suggest-habits/route.ts apps/web/app/api/ai/journal-prompt/route.ts
git commit -m "feat(security): add per-user rate limiting to all AI API routes"
```

---

### Task 4: Sentry for web (error monitoring)

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/instrumentation.ts`
- Create: `apps/web/instrumentation-client.ts`
- Modify: `apps/web/next.config.mjs`
- Modify: `.env.example`
- Modify: `apps/web/.env.local.example`

**Interfaces:**
- Produces: Unhandled server and client exceptions automatically captured in Sentry

- [ ] **Step 1: Install Sentry**

```bash
cd apps/web && npm install @sentry/nextjs@^9
```

Expected: No errors.

- [ ] **Step 2: Add env vars to .env.example**

In `.env.example`, add:
```
# Sentry error monitoring
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_AUTH_TOKEN=sntrys_...
```

In `apps/web/.env.local.example`, add the same three lines.

- [ ] **Step 3: Create server/edge instrumentation**

```typescript
// apps/web/instrumentation.ts
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
      sendDefaultPii: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
      sendDefaultPii: false,
    })
  }
}

export const onRequestError = Sentry.captureRequestError
```

- [ ] **Step 4: Create client instrumentation**

```typescript
// apps/web/instrumentation-client.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
})
```

- [ ] **Step 5: Wrap next.config.mjs with withSentryConfig**

Update `apps/web/next.config.mjs` — change the last two lines:
```javascript
// Replace:
export default nextConfig

// With:
import { withSentryConfig } from '@sentry/nextjs'

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  hideSourceMaps: true,
  disableLogger: true,
})
```

Also add this import at the top of `next.config.mjs`. The full file should start with the import before the `supabaseHost` line.

- [ ] **Step 6: Type-check and build**

```bash
cd apps/web && npm run type-check && npm run build
```

Expected: Builds successfully. Sentry source map upload will fail if `SENTRY_AUTH_TOKEN` is not set — that's OK locally; it's only needed in CI/CD.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/instrumentation.ts apps/web/instrumentation-client.ts apps/web/next.config.mjs .env.example apps/web/.env.local.example
git commit -m "feat(observability): add Sentry error monitoring for web (server + client)"
```

---

### Task 5: Sentry for mobile

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/.env.local.example`

**Interfaces:**
- Produces: Unhandled React Native exceptions automatically captured in Sentry

- [ ] **Step 1: Install Sentry React Native**

```bash
cd apps/mobile && npm install @sentry/react-native
```

- [ ] **Step 2: Add env var**

In `apps/mobile/.env.local.example`, add:
```
EXPO_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
```

- [ ] **Step 3: Initialize Sentry in mobile layout**

Open `apps/mobile/app/_layout.tsx`. At the top, add:

```typescript
import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  enabled: !__DEV__,
})
```

Wrap the root component export with `Sentry.wrap`:

Find the default export (e.g. `export default function RootLayout(...)`) and wrap the function body or the export itself. At the bottom of the file, if there's a default export like:

```typescript
// existing:
export default function RootLayout({ children }: ...) { ... }

// change to:
function RootLayout({ children }: ...) { ... }
export default Sentry.wrap(RootLayout)
```

- [ ] **Step 4: Type-check**

```bash
cd apps/mobile && npm run type-check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/app/_layout.tsx apps/mobile/.env.local.example
git commit -m "feat(observability): add Sentry error monitoring for React Native"
```

---

### Task 6: PostHog product analytics

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/posthog.ts`
- Create: `apps/web/providers/posthog-provider.tsx`
- Modify: `apps/web/providers/providers.tsx`
- Modify: `.env.example` and `apps/web/.env.local.example`

**Interfaces:**
- Produces: `PostHogProvider` wrapping the app, capturing `$pageview` automatically, and a `posthog` singleton for manual event capture

- [ ] **Step 1: Install PostHog**

```bash
cd apps/web && npm install posthog-js
```

- [ ] **Step 2: Add env vars**

In `.env.example` and `apps/web/.env.local.example`, add:
```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

- [ ] **Step 3: Create PostHog client singleton**

```typescript
// apps/web/lib/posthog.ts
import posthog from 'posthog-js'

export function initPostHog() {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  if (posthog.__loaded) return

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    capture_pageview: false, // we fire manually on route change
    persistence: 'localStorage+cookie',
  })
}

export { posthog }
```

- [ ] **Step 4: Create PostHog provider**

```tsx
// apps/web/providers/posthog-provider.tsx
'use client'
import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { initPostHog, posthog } from '@/lib/posthog'

function PostHogPageview() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (pathname) {
      let url = window.origin + pathname
      if (searchParams.toString()) url += `?${searchParams.toString()}`
      posthog.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </>
  )
}
```

- [ ] **Step 5: Add PostHogProvider to the providers wrapper**

Open `apps/web/providers/providers.tsx`. Import and wrap with `PostHogProvider`:

```tsx
import { PostHogProvider } from './posthog-provider'

// Wrap the outermost provider:
// Change: return <ExistingProviders>{children}</ExistingProviders>
// To:    return <PostHogProvider><ExistingProviders>{children}</ExistingProviders></PostHogProvider>
```

- [ ] **Step 6: Add key habit events to posthog**

In `apps/web/hooks/use-completions.ts` (or wherever `logCompletion` is defined), after a successful completion:
```typescript
import { posthog } from '@/lib/posthog'
// After successful DB write:
posthog.capture('habit_completed', { habit_id: habitId })
```

In `apps/web/hooks/use-habits.ts`, after a successful `createHabit`:
```typescript
import { posthog } from '@/lib/posthog'
posthog.capture('habit_created')
```

- [ ] **Step 7: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 8: Verify in browser**

Start dev server. Open browser DevTools → Network tab, filter for `posthog`. Navigate between pages. Verify `$pageview` events fire. Navigate to PostHog dashboard to confirm events arrive.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/posthog.ts apps/web/providers/posthog-provider.tsx apps/web/providers/providers.tsx apps/web/hooks/use-completions.ts apps/web/hooks/use-habits.ts .env.example apps/web/.env.local.example
git commit -m "feat(analytics): add PostHog product analytics with pageview + key habit events"
```

---

## Self-Review

**Spec coverage:**
- ✅ Middleware naming bug fixed (auth session refresh now runs)
- ✅ Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- ✅ Rate limiting on all 3 AI routes
- ✅ Sentry web (server + client)
- ✅ Sentry mobile
- ✅ PostHog pageview tracking + key events
- ⚠️ Rate limiter is in-memory only — for multi-instance production, swap `store` in `rate-limit.ts` for Upstash Redis with `@upstash/ratelimit`

**Placeholder scan:** No TBDs or TODOs.

**Type consistency:** `rateLimit` function signature is consistent across all 3 route usages.
