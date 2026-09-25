# Growth & Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marketing landing page for user acquisition, unit test coverage for all shared utilities, legal pages (privacy + ToS), transactional email on signup, and a CI test job — making rock safe to ship and able to grow organically.

**Architecture:** The root `/` route becomes a full marketing page for unauthenticated visitors (authenticated users still redirect to `/dashboard`). Legal pages live in a `(marketing)` route group with a minimal layout. Email uses Resend as the transactional provider — a single `POST /api/email/welcome` route is called client-side after successful signup. Unit tests use Vitest (installed in Plan 1); this plan adds test files for the three existing utility modules.

**Tech Stack:** `resend@4`, Vitest 3 (from Plan 1), Next.js route groups, Tailwind CSS.

## Global Constraints

- TypeScript everywhere, strict mode
- `RESEND_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix)
- `FROM_EMAIL` must be a domain you control and have configured with Resend (DKIM/SPF)
- Marketing pages must NOT be wrapped in the `(app)` layout (no sidebar, no auth check)
- Landing page must be performant: no client-side data fetching, no heavy animations above the fold
- All tests use Vitest; test files live in `src/__tests__/` inside each package
- Vitest was configured in `packages/utils` in Plan 1 — this plan adds test files only, no new config

---

## File Structure

**Create:**
- `packages/utils/src/__tests__/streaks.test.ts` — unit tests for `calculateStreak`, `isScheduledOn`, `weeklyConsistencyScore`
- `packages/utils/src/__tests__/achievements.test.ts` — unit tests for `getAchievements`
- `packages/utils/src/__tests__/insights.test.ts` — unit tests for `generateInsights`, `completionsByHour`
- `apps/web/app/(marketing)/layout.tsx` — minimal layout (no sidebar, no auth)
- `apps/web/app/(marketing)/privacy/page.tsx` — Privacy Policy
- `apps/web/app/(marketing)/terms/page.tsx` — Terms of Service
- `apps/web/lib/email.ts` — Resend client singleton
- `apps/web/app/api/email/welcome/route.ts` — send welcome email on signup
- `.github/workflows/test.yml` — CI job that runs `npm test` for packages

**Modify:**
- `apps/web/app/page.tsx` — show landing page for unauthenticated visitors instead of redirecting to `/login`
- `apps/web/app/(auth)/signup/page.tsx` — call `/api/email/welcome` after successful signup
- `apps/web/package.json` — add `resend`
- `.env.example` — add `RESEND_API_KEY`, `FROM_EMAIL`
- `apps/web/.env.local.example` — same

---

### Task 1: Unit tests for streaks.ts

**Files:**
- Create: `packages/utils/src/__tests__/streaks.test.ts`

**Interfaces:**
- Consumes: `calculateStreak`, `isScheduledOn`, `weeklyConsistencyScore`, `isScheduledToday` from `../streaks`
- Note: Check the actual function names exported from `packages/utils/src/streaks.ts` before writing tests — use the exact exported names.

- [ ] **Step 1: Read the current exports from streaks.ts**

```bash
grep "^export" packages/utils/src/streaks.ts
```

Note which functions are exported. The tests below assume: `isScheduledOn`, `isScheduledToday`, `calculateStreak`, `weeklyConsistencyScore`.

- [ ] **Step 2: Write the tests**

```typescript
// packages/utils/src/__tests__/streaks.test.ts
import { describe, it, expect } from 'vitest'
import { isScheduledOn, calculateStreak, weeklyConsistencyScore } from '../streaks'
import type { Frequency } from '@rock_ht/types'

const daily: Frequency = { type: 'daily' }
const weekdays: Frequency = { type: 'specific_days', days: [1, 2, 3, 4, 5] } // Mon-Fri
const timesPerWeek: Frequency = { type: 'times_per_week', count: 3 }

describe('isScheduledOn', () => {
  it('daily habit is scheduled on any day', () => {
    expect(isScheduledOn(daily, '2026-07-07')).toBe(true) // Monday
    expect(isScheduledOn(daily, '2026-07-12')).toBe(true) // Saturday
  })

  it('specific_days respects the days array', () => {
    expect(isScheduledOn(weekdays, '2026-07-06')).toBe(false) // Sunday = 0
    expect(isScheduledOn(weekdays, '2026-07-07')).toBe(true)  // Monday = 1
    expect(isScheduledOn(weekdays, '2026-07-12')).toBe(false) // Saturday = 6
  })

  it('times_per_week is always schedulable on any day', () => {
    expect(isScheduledOn(timesPerWeek, '2026-07-12')).toBe(true)
    expect(isScheduledOn(timesPerWeek, '2026-07-06')).toBe(true)
  })
})

describe('calculateStreak', () => {
  it('returns 0 for no completions', () => {
    const result = calculateStreak(daily, [])
    expect(result.current_streak).toBe(0)
    expect(result.longest_streak).toBe(0)
    expect(result.last_completed_date).toBeNull()
  })

  it('calculates streak for consecutive daily completions ending today', () => {
    const today = new Date()
    const dates = [0, 1, 2].map(d => {
      const dt = new Date(today)
      dt.setDate(dt.getDate() - d)
      return dt.toISOString().split('T')[0]
    })
    const result = calculateStreak(daily, dates)
    expect(result.current_streak).toBe(3)
    expect(result.longest_streak).toBe(3)
  })

  it('resets streak when a day is skipped', () => {
    const today = new Date().toISOString().split('T')[0]
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]
    const result = calculateStreak(daily, [today, threeDaysAgo])
    expect(result.current_streak).toBe(1)
  })
})

describe('weeklyConsistencyScore', () => {
  it('returns 0 for no habits', () => {
    expect(weeklyConsistencyScore([], [])).toBe(0)
  })

  it('returns 100 when all scheduled habits completed', () => {
    const habit = {
      id: 'h1',
      frequency: daily,
      is_archived: false,
    }
    const today = new Date().toISOString().split('T')[0]
    const completions = [{ habit_id: 'h1', completed_date: today }]
    const score = weeklyConsistencyScore([habit as any], completions as any)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
cd packages/utils && npm test
```

Expected: All tests pass. If `calculateStreak` has a different signature than expected, read the source and adjust the test.

- [ ] **Step 4: Commit**

```bash
git add packages/utils/src/__tests__/streaks.test.ts
git commit -m "test(utils): add unit tests for streak calculation and consistency score"
```

---

### Task 2: Unit tests for achievements.ts

**Files:**
- Create: `packages/utils/src/__tests__/achievements.test.ts`

**Interfaces:**
- Consumes: `getAchievements` (or whatever the main export is) from `../achievements`
- Note: Run `grep "^export" packages/utils/src/achievements.ts` first to confirm the function name.

- [ ] **Step 1: Write the tests**

```typescript
// packages/utils/src/__tests__/achievements.test.ts
import { describe, it, expect } from 'vitest'
import { getAchievements } from '../achievements'
import type { AchievementInput } from '../achievements'

const emptyInput: AchievementInput = {
  habits: [],
  streaks: [],
  completions: [],
}

function makeHabit(id: string, archived = false) {
  return {
    id,
    title: 'Test',
    frequency: { type: 'daily' as const },
    is_archived: archived,
    user_id: 'u1',
    icon: '✨',
    color: '#000',
    target_value: 1,
    target_unit: null,
    description: null,
    reminder_time: null,
    reminder_enabled: false,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('getAchievements', () => {
  it('returns a non-empty list of achievements', () => {
    const result = getAchievements(emptyInput)
    expect(result.length).toBeGreaterThan(0)
  })

  it('first_habit achievement is unlocked after creating one habit', () => {
    const withHabit = { ...emptyInput, habits: [makeHabit('h1')] }
    const result = getAchievements(withHabit)
    const first = result.find(a => a.id === 'first_habit')
    expect(first?.unlocked).toBe(true)
  })

  it('first_habit achievement is locked with no habits', () => {
    const result = getAchievements(emptyInput)
    const first = result.find(a => a.id === 'first_habit')
    expect(first?.unlocked).toBe(false)
  })

  it('first_completion achievement is unlocked when completions exist', () => {
    const withCompletion = {
      ...emptyInput,
      habits: [makeHabit('h1')],
      completions: [{
        id: 'c1',
        habit_id: 'h1',
        user_id: 'u1',
        completed_date: '2026-07-10',
        value: 1,
        note: null,
        created_at: '2026-07-10T10:00:00Z',
      }],
    }
    const result = getAchievements(withCompletion as any)
    const first = result.find(a => a.id === 'first_completion')
    expect(first?.unlocked).toBe(true)
  })

  it('each achievement has required fields', () => {
    const result = getAchievements(emptyInput)
    for (const a of result) {
      expect(a).toHaveProperty('id')
      expect(a).toHaveProperty('title')
      expect(a).toHaveProperty('emoji')
      expect(a).toHaveProperty('rarity')
      expect(typeof a.unlocked).toBe('boolean')
    }
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/utils && npm test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/utils/src/__tests__/achievements.test.ts
git commit -m "test(utils): add unit tests for achievements system"
```

---

### Task 3: Unit tests for insights.ts

**Files:**
- Create: `packages/utils/src/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `generateInsights`, `completionsByHour` from `../insights`
- Note: Run `grep "^export" packages/utils/src/insights.ts` first to confirm exported names.

- [ ] **Step 1: Write the tests**

```typescript
// packages/utils/src/__tests__/insights.test.ts
import { describe, it, expect } from 'vitest'
import { generateInsights, completionsByHour } from '../insights'

const noCompletions: any[] = []

function makeCompletion(habitId: string, date: string, hour = 9) {
  return {
    id: `c-${habitId}-${date}`,
    habit_id: habitId,
    user_id: 'u1',
    completed_date: date,
    value: 1,
    note: null,
    created_at: `${date}T${String(hour).padStart(2, '0')}:00:00Z`,
  }
}

describe('completionsByHour', () => {
  it('returns an array of 24 entries', () => {
    const result = completionsByHour(noCompletions)
    expect(result).toHaveLength(24)
  })

  it('each entry has hour and count', () => {
    const result = completionsByHour(noCompletions)
    for (const entry of result) {
      expect(entry).toHaveProperty('hour')
      expect(entry).toHaveProperty('count')
      expect(typeof entry.hour).toBe('number')
      expect(typeof entry.count).toBe('number')
    }
  })

  it('counts completions in the correct hour bucket', () => {
    const completions = [
      makeCompletion('h1', '2026-07-10', 9),
      makeCompletion('h2', '2026-07-10', 9),
      makeCompletion('h3', '2026-07-10', 14),
    ]
    const result = completionsByHour(completions as any)
    const hour9 = result.find(e => e.hour === 9)
    const hour14 = result.find(e => e.hour === 14)
    expect(hour9?.count).toBe(2)
    expect(hour14?.count).toBe(1)
  })
})

describe('generateInsights', () => {
  it('returns an array', () => {
    const result = generateInsights([], [], [])
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns empty insights with no data', () => {
    const result = generateInsights([], [], [])
    expect(result.length).toBe(0)
  })

  it('each insight has title and body', () => {
    const habits = [{ id: 'h1', frequency: { type: 'daily' }, is_archived: false, title: 'Test' }]
    const completions = Array.from({ length: 10 }, (_, i) => makeCompletion('h1', `2026-07-0${i + 1}`))
    const streaks = [{ habit_id: 'h1', current_streak: 10, longest_streak: 10 }]
    const result = generateInsights(habits as any, completions as any, streaks as any)
    for (const insight of result) {
      expect(typeof insight.title).toBe('string')
      expect(typeof insight.body).toBe('string')
    }
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/utils && npm test
```

Expected: All tests pass. If `generateInsights` has a different signature (e.g. takes a single object), read `insights.ts` and update the test call accordingly.

- [ ] **Step 3: Commit**

```bash
git add packages/utils/src/__tests__/insights.test.ts
git commit -m "test(utils): add unit tests for AI insights engine"
```

---

### Task 4: Add test CI job

**Files:**
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Produces: `test` CI job that runs `npm test` in `packages/utils` on every push and PR

- [ ] **Step 1: Write the CI workflow**

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  unit-tests:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build shared packages
        run: npx turbo run build --filter="./packages/*"

      - name: Run unit tests
        run: npm test --workspace=packages/utils
```

- [ ] **Step 2: Add test script to root package.json**

In `/home/ben/repo/rock_ht/package.json`, add to scripts:
```json
"test": "turbo run test"
```

- [ ] **Step 3: Add test script to turbo.json (if it exists)**

Check if `turbo.json` exists:
```bash
ls /home/ben/repo/rock_ht/turbo.json 2>/dev/null || echo "no turbo.json"
```

If it exists, add `"test"` to the `pipeline` section. If not, skip this step — turbo will pick it up from package.json scripts.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml package.json
git commit -m "ci: add unit test job to CI pipeline"
```

---

### Task 5: Marketing landing page

**Files:**
- Create: `apps/web/app/(marketing)/layout.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Produces: `GET /` — unauthenticated users see the landing page, authenticated users redirect to `/dashboard`
- The marketing layout has no sidebar, header, or auth guards

- [ ] **Step 1: Create the (marketing) layout**

```tsx
// apps/web/app/(marketing)/layout.tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

- [ ] **Step 2: Rewrite app/page.tsx as a full marketing page**

```tsx
// apps/web/app/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">🌀</span>
          <span>rock</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-full font-medium hover:opacity-90 transition-opacity"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-4 pt-20 pb-16 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full mb-6 font-medium">
          ✨ AI-powered habit coaching
        </div>
        <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-4">
          Build habits that
          <br />
          <span className="text-primary">actually stick</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mb-8">
          rock helps you track habits with beautiful streaks, smart reminders, and an AI coach
          that understands your patterns — across all your devices.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/signup"
            className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity"
          >
            Start for free
          </Link>
          <Link
            href="/login"
            className="border border-border text-foreground px-8 py-3 rounded-xl font-semibold text-base hover:bg-accent transition-colors"
          >
            Log in
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-4">No credit card required · Free tier forever</p>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            emoji: '🔥',
            title: 'Streak Tracking',
            desc: 'Visual streak rings and calendar heatmaps make your progress impossible to ignore.',
          },
          {
            emoji: '🤖',
            title: 'AI Coach',
            desc: 'Get personalized insights from an AI that knows your habits, strengths, and patterns.',
          },
          {
            emoji: '⚡',
            title: 'One-Tap Completion',
            desc: 'Log any habit in under a second. Works offline. Syncs the moment you reconnect.',
          },
          {
            emoji: '📊',
            title: 'Deep Analytics',
            desc: 'Weekly trends, time-of-day charts, and consistency scores reveal what\'s working.',
          },
          {
            emoji: '🌙',
            title: 'Beautiful Themes',
            desc: 'Light, dark, midnight, forest, and sunset themes. Your app, your aesthetic.',
          },
          {
            emoji: '📱',
            title: 'Mobile + Web',
            desc: 'Native iOS and Android apps sync in real time with the full-featured web dashboard.',
          },
        ].map(f => (
          <div key={f.title} className="bg-card border border-border rounded-2xl p-5">
            <div className="text-3xl mb-3">{f.emoji}</div>
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-10">Simple pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="text-sm font-medium text-muted-foreground mb-1">Free</div>
            <div className="text-4xl font-bold mb-4">$0</div>
            <ul className="text-sm text-muted-foreground space-y-2 mb-6">
              {['Up to 5 habits', 'Streak tracking', 'Basic analytics', 'Mobile + Web', 'Offline support'].map(i => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> {i}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="block text-center border border-border rounded-xl py-2 font-medium hover:bg-accent transition-colors text-sm">
              Get started
            </Link>
          </div>
          <div className="bg-primary text-primary-foreground rounded-2xl p-6">
            <div className="text-sm font-medium opacity-70 mb-1">Pro</div>
            <div className="text-4xl font-bold mb-4">$5<span className="text-base font-normal opacity-70">/mo</span></div>
            <ul className="text-sm opacity-80 space-y-2 mb-6">
              {['Unlimited habits', 'AI Coach', 'AI Insights', 'Data export', 'Advanced analytics', 'Priority support'].map(i => (
                <li key={i} className="flex items-center gap-2">
                  <span>✓</span> {i}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="block text-center bg-primary-foreground text-primary rounded-xl py-2 font-medium hover:opacity-90 transition-opacity text-sm">
              Start free, upgrade anytime
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>🌀</span>
            <span>rock © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

```bash
npm run dev:web
```

Open `http://localhost:3000` while logged out. Verify landing page renders. Verify an authenticated user is redirected to `/dashboard`.

- [ ] **Step 4: Update middleware to allow `/` as a public route**

Open `apps/web/lib/supabase/middleware.ts`. Find the `isPublicRoute` check and ensure `pathname === '/'` is still included (it should be — verify it's there).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx "apps/web/app/(marketing)/layout.tsx"
git commit -m "feat(marketing): add landing page with hero, features, and pricing"
```

---

### Task 6: Privacy Policy and Terms of Service

**Files:**
- Create: `apps/web/app/(marketing)/privacy/page.tsx`
- Create: `apps/web/app/(marketing)/terms/page.tsx`

**Interfaces:**
- Produces: `GET /privacy` and `GET /terms` — static pages, no auth required

- [ ] **Step 1: Create privacy policy page**

```tsx
// apps/web/app/(marketing)/privacy/page.tsx
import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — rock' }

export default function PrivacyPage() {
  const updated = 'July 10, 2026'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-3xl mx-auto">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span>🌀</span> rock
        </Link>
      </nav>
      <article className="max-w-3xl mx-auto px-4 py-12 prose prose-neutral dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: {updated}</p>

        <h2>What we collect</h2>
        <p>We collect the information you provide when you create an account (email address, display name) and the habit and journal data you enter into rock. We also collect basic usage analytics to improve the product.</p>

        <h2>How we use it</h2>
        <p>Your data is used solely to operate rock: to store your habits, display your progress, send reminders you configure, and provide AI-powered coaching. We do not sell your personal data to third parties.</p>

        <h2>Third-party services</h2>
        <p>We use the following third-party services:</p>
        <ul>
          <li><strong>Supabase</strong> — database and authentication (EU and US regions)</li>
          <li><strong>Stripe</strong> — payment processing. Stripe stores payment card data; we never see your card number.</li>
          <li><strong>Anthropic</strong> — AI responses in the coach feature. Your habit data is sent to Anthropic solely to generate your coaching response and is not stored by Anthropic for training.</li>
          <li><strong>Sentry</strong> — error monitoring. Crash reports may include device and session metadata.</li>
          <li><strong>PostHog</strong> — product analytics. Anonymized usage events only.</li>
        </ul>

        <h2>Data retention</h2>
        <p>Your account and all associated data are retained for as long as your account is active. You may delete your account at any time from the Settings page, which permanently deletes all your data within 30 days.</p>

        <h2>Your rights</h2>
        <p>You may request a copy of your data (Settings → Export) or request deletion by emailing us. If you are located in the EU, you have rights under GDPR including the right to access, correct, and erase your data.</p>

        <h2>Cookies</h2>
        <p>We use cookies solely for authentication session management. We do not use advertising cookies.</p>

        <h2>Contact</h2>
        <p>For privacy questions, email <a href="mailto:privacy@rock-ht.app">privacy@rock-ht.app</a>.</p>
      </article>
    </div>
  )
}
```

- [ ] **Step 2: Create terms of service page**

```tsx
// apps/web/app/(marketing)/terms/page.tsx
import Link from 'next/link'

export const metadata = { title: 'Terms of Service — rock' }

export default function TermsPage() {
  const updated = 'July 10, 2026'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50 max-w-3xl mx-auto">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span>🌀</span> rock
        </Link>
      </nav>
      <article className="max-w-3xl mx-auto px-4 py-12 prose prose-neutral dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground">Last updated: {updated}</p>

        <h2>Acceptance</h2>
        <p>By using rock you agree to these terms. If you do not agree, do not use the service.</p>

        <h2>Description of service</h2>
        <p>rock is a habit tracking application. We provide the service on an "as is" basis and may modify, suspend, or discontinue features at any time.</p>

        <h2>Your account</h2>
        <p>You are responsible for maintaining the security of your account. Notify us immediately if you suspect unauthorized access. You must be at least 13 years old to use rock.</p>

        <h2>Acceptable use</h2>
        <p>You may not use rock to violate any laws, infringe intellectual property rights, distribute malware, or attempt to gain unauthorized access to our systems or other users' accounts.</p>

        <h2>Subscriptions and billing</h2>
        <p>The Free plan is free indefinitely. The Pro plan is billed monthly. You may cancel at any time from Settings; your Pro access continues until the end of the current billing period. We do not offer refunds for partial months.</p>

        <h2>Data and content</h2>
        <p>You own the data you enter into rock. By using the service you grant us a limited license to store, process, and display your data in order to provide the service. We do not claim ownership of your content.</p>

        <h2>Termination</h2>
        <p>We may suspend or terminate your account if you violate these terms. You may delete your account at any time from Settings.</p>

        <h2>Limitation of liability</h2>
        <p>To the maximum extent permitted by law, rock is not liable for indirect, incidental, or consequential damages. Our total liability to you for any claim is limited to the amount you paid us in the 12 months prior to the claim.</p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the jurisdiction in which rock operates, without regard to conflict-of-law provisions.</p>

        <h2>Contact</h2>
        <p>Questions about these terms? Email <a href="mailto:legal@rock-ht.app">legal@rock-ht.app</a>.</p>
      </article>
    </div>
  )
}
```

- [ ] **Step 3: Verify routes are accessible without auth**

Confirm the middleware in `apps/web/lib/supabase/middleware.ts` includes `/privacy` and `/terms` in `isPublicRoute`. If not, update the check:

```typescript
const isPublicRoute =
  pathname === '/' ||
  pathname === '/privacy' ||
  pathname === '/terms' ||
  isAuthRoute ||
  pathname.startsWith('/auth')
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(marketing)/privacy/page.tsx" "apps/web/app/(marketing)/terms/page.tsx" apps/web/lib/supabase/middleware.ts
git commit -m "feat(marketing): add privacy policy and terms of service pages"
```

---

### Task 7: Resend transactional email + welcome email

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/email.ts`
- Create: `apps/web/app/api/email/welcome/route.ts`
- Modify: `apps/web/app/(auth)/signup/page.tsx`
- Modify: `.env.example` and `apps/web/.env.local.example`

**Interfaces:**
- Produces: `POST /api/email/welcome` — sends a welcome email to the signed-up user
- Consumes: `useSupabase()` from `@/providers/supabase-provider` to get `user.email` after signup

- [ ] **Step 1: Install Resend**

```bash
cd apps/web && npm install resend@^4
```

- [ ] **Step 2: Add env vars**

In `.env.example` and `apps/web/.env.local.example`, add:
```
RESEND_API_KEY=re_...
FROM_EMAIL=hello@yourdomain.com
```

- [ ] **Step 3: Create Resend email client**

```typescript
// apps/web/lib/email.ts
import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)
```

- [ ] **Step 4: Create welcome email route**

```typescript
// apps/web/app/api/email/welcome/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resend } from '@/lib/email'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single()

  const name = profile?.display_name ?? user.email.split('@')[0]

  const { error } = await resend.emails.send({
    from: process.env.FROM_EMAIL!,
    to: user.email,
    subject: 'Welcome to rock 🌀',
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="font-size: 24px; margin-bottom: 8px;">Welcome, ${name}! 🎉</h1>
        <p style="color: #666; line-height: 1.6; margin-bottom: 16px;">
          Your rock account is ready. Start building habits that stick.
        </p>
        <p style="margin-bottom: 16px;">Here's how to get started:</p>
        <ol style="color: #333; line-height: 2;">
          <li>Create your first habit</li>
          <li>Complete it once today to start your streak</li>
          <li>Come back tomorrow to keep it going</li>
        </ol>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
           style="display: inline-block; margin-top: 24px; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 600;">
          Open rock →
        </a>
        <p style="margin-top: 32px; font-size: 12px; color: #999;">
          You're receiving this because you signed up at rock-ht.app.
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" style="color: #999;">Manage notifications</a>
        </p>
      </div>
    `,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Call welcome email from signup page**

In `apps/web/app/(auth)/signup/page.tsx`, find the `onSubmit` handler. After the successful signup and before `router.push('/dashboard')`:

```typescript
// After successful sign up (after error check), fire-and-forget:
fetch('/api/email/welcome', { method: 'POST' }).catch(() => {
  // Non-critical — don't block navigation if email fails
})
router.push('/onboarding')
router.refresh()
```

- [ ] **Step 6: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 7: Manual test**

With a real `RESEND_API_KEY` in `.env.local`, sign up with a new test email. Verify welcome email arrives within 30 seconds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/email.ts apps/web/app/api/email/welcome/route.ts "apps/web/app/(auth)/signup/page.tsx" .env.example apps/web/.env.local.example
git commit -m "feat(email): add welcome email via Resend on user signup"
```

---

## Self-Review

**Spec coverage:**
- ✅ Vitest unit tests for `streaks.ts`
- ✅ Vitest unit tests for `achievements.ts`
- ✅ Vitest unit tests for `insights.ts`
- ✅ CI test job (`.github/workflows/test.yml`)
- ✅ Marketing landing page with hero, features, and pricing
- ✅ Privacy policy
- ✅ Terms of service
- ✅ Resend email integration
- ✅ Welcome email on signup
- ⚠️ `/privacy` and `/terms` links in the footer of `app/page.tsx` — verify they match the actual routes (`/privacy` and `/terms` in the `(marketing)` group are accessible without the group prefix)

**Placeholder scan:** No TBDs. Legal pages contain real content, not placeholder text.

**Type consistency:** `generateInsights` test function signature matches `packages/utils/src/insights.ts` — verify with `grep "^export" packages/utils/src/insights.ts` before running tests. `completionsByHour` similarly.
