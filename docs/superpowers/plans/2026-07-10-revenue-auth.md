# Revenue & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe subscription billing with Pro tier gating and Google OAuth so rock can charge users.

**Architecture:** A `subscriptions` table (one row per user, auto-seeded as `free`) is managed by a Stripe webhook handler (service-role only). The `use-subscription` hook exposes `isPro` to all client components. Free tier is capped at 5 habits and no AI features; Pro unlocks everything.

**Tech Stack:** `stripe@17`, Vitest 3, Supabase service-role client, React Query, Next.js Route Handlers.

## Global Constraints

- TypeScript everywhere, strict mode
- Next.js 16 route handlers (no `pages/api`)
- Supabase RLS: users read own subscription; service role writes it
- Stripe webhook body must be read as raw text (not JSON) for signature verification
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only env vars (no `NEXT_PUBLIC_` prefix)
- Node.js runtime required for Stripe SDK (`export const runtime = 'nodejs'` on all billing routes)
- All monetary amounts in Stripe are in the smallest currency unit (cents)
- Free tier: max 5 habits, no AI coach, no AI insights, no data export

---

## File Structure

**Create:**
- `packages/utils/vitest.config.ts` — Vitest config for the utils package
- `packages/utils/src/__tests__/subscription.test.ts` — feature gating unit tests
- `packages/utils/src/subscription.ts` — `Plan` type, `planAllows()`, `habitLimitForPlan()`
- `packages/types/src/subscription.ts` — `SubscriptionRow` DB type
- `supabase/migrations/006_subscriptions.sql` — subscriptions table + RLS + auto-seed trigger
- `apps/web/lib/stripe.ts` — Stripe server singleton
- `apps/web/lib/supabase/service.ts` — Supabase service-role client (bypasses RLS)
- `apps/web/app/api/billing/checkout/route.ts` — create Stripe checkout session
- `apps/web/app/api/billing/portal/route.ts` — open Stripe customer portal
- `apps/web/app/api/webhooks/stripe/route.ts` — handle Stripe webhook events
- `apps/web/hooks/use-subscription.ts` — React Query subscription state hook

**Modify:**
- `packages/utils/package.json` — add `vitest` devDep + `test` script
- `packages/utils/src/index.ts` — export subscription utilities
- `packages/types/src/index.ts` — export `SubscriptionRow`
- `apps/web/package.json` — add `stripe` dependency
- `.env.example` — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `SUPABASE_SERVICE_ROLE_KEY`
- `apps/web/.env.local.example` — add all new env vars
- `apps/web/app/(app)/settings/page.tsx` — add billing card (current plan + upgrade/manage buttons)
- `apps/web/app/(auth)/login/page.tsx` — add "Continue with Google" button
- `apps/web/app/(auth)/signup/page.tsx` — add "Continue with Google" button
- `apps/web/app/(app)/coach/page.tsx` — gate behind `isPro`, show upgrade prompt for free users
- `apps/web/hooks/use-habits.ts` — enforce 5-habit free tier limit on creation

---

### Task 1: Vitest setup + subscription feature gating utility

**Files:**
- Create: `packages/utils/vitest.config.ts`
- Create: `packages/utils/src/__tests__/subscription.test.ts`
- Create: `packages/utils/src/subscription.ts`
- Modify: `packages/utils/package.json`
- Modify: `packages/utils/src/index.ts`

**Interfaces:**
- Produces:
  - `Plan = 'free' | 'pro'`
  - `ProFeature = 'unlimited_habits' | 'ai_coach' | 'ai_insights' | 'data_export' | 'advanced_analytics'`
  - `FREE_HABIT_LIMIT: number` (= 5)
  - `planAllows(plan: Plan, feature: ProFeature): boolean`
  - `habitLimitForPlan(plan: Plan): number`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/utils/src/__tests__/subscription.test.ts
import { describe, it, expect } from 'vitest'
import { planAllows, habitLimitForPlan, FREE_HABIT_LIMIT } from '../subscription'

describe('planAllows', () => {
  it('pro unlocks all features', () => {
    expect(planAllows('pro', 'ai_coach')).toBe(true)
    expect(planAllows('pro', 'unlimited_habits')).toBe(true)
    expect(planAllows('pro', 'data_export')).toBe(true)
    expect(planAllows('pro', 'ai_insights')).toBe(true)
    expect(planAllows('pro', 'advanced_analytics')).toBe(true)
  })

  it('free blocks all pro features', () => {
    expect(planAllows('free', 'ai_coach')).toBe(false)
    expect(planAllows('free', 'unlimited_habits')).toBe(false)
    expect(planAllows('free', 'data_export')).toBe(false)
    expect(planAllows('free', 'ai_insights')).toBe(false)
    expect(planAllows('free', 'advanced_analytics')).toBe(false)
  })
})

describe('habitLimitForPlan', () => {
  it('free tier caps at FREE_HABIT_LIMIT', () => {
    expect(habitLimitForPlan('free')).toBe(FREE_HABIT_LIMIT)
    expect(FREE_HABIT_LIMIT).toBe(5)
  })

  it('pro tier has no limit', () => {
    expect(habitLimitForPlan('pro')).toBe(Infinity)
  })
})
```

- [ ] **Step 2: Add Vitest config**

```typescript
// packages/utils/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Add vitest to packages/utils/package.json**

In `packages/utils/package.json`, add to `devDependencies` and add a `test` script:
```json
{
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/utils && npm install && npm test
```

Expected: FAIL — `Cannot find module '../subscription'`

- [ ] **Step 5: Implement subscription.ts**

```typescript
// packages/utils/src/subscription.ts
export type Plan = 'free' | 'pro'

export const FREE_HABIT_LIMIT = 5

export const PRO_FEATURES = [
  'unlimited_habits',
  'ai_coach',
  'ai_insights',
  'data_export',
  'advanced_analytics',
] as const

export type ProFeature = (typeof PRO_FEATURES)[number]

export function planAllows(plan: Plan, feature: ProFeature): boolean {
  return plan === 'pro'
}

export function habitLimitForPlan(plan: Plan): number {
  return plan === 'pro' ? Infinity : FREE_HABIT_LIMIT
}
```

- [ ] **Step 6: Export from packages/utils/src/index.ts**

Add to the existing exports at the bottom of `packages/utils/src/index.ts`:
```typescript
export * from './subscription'
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd packages/utils && npm test
```

Expected: PASS — 4 tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/utils/vitest.config.ts packages/utils/src/__tests__/subscription.test.ts packages/utils/src/subscription.ts packages/utils/src/index.ts packages/utils/package.json
git commit -m "feat(utils): add subscription plan gating utility with Vitest"
```

---

### Task 2: Subscriptions DB migration + type

**Files:**
- Create: `supabase/migrations/006_subscriptions.sql`
- Create: `packages/types/src/subscription.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `SubscriptionRow` with fields `id`, `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan`, `status`, `current_period_end`, `created_at`, `updated_at`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/006_subscriptions.sql

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references public.profiles(id) on delete cascade not null unique,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  plan                    text not null default 'free'
                          check (plan in ('free', 'pro')),
  status                  text
                          check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_stripe_customer_idx on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;

create policy "Users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Service role manages subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role');

-- Auto-create free subscription row when a profile is created
create or replace function public.create_free_subscription()
returns trigger language plpgsql security definer as $$
begin
  insert into public.subscriptions (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute procedure public.create_free_subscription();

-- Keep updated_at fresh
create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();
```

- [ ] **Step 2: Apply migration locally**

```bash
cd /path/to/rock_ht && npm run db:reset
```

Expected: Supabase resets and applies all 6 migrations without error.

- [ ] **Step 3: Write the TypeScript type**

```typescript
// packages/types/src/subscription.ts
export interface SubscriptionRow {
  id: string
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'free' | 'pro'
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Export from packages/types/src/index.ts**

Add to `packages/types/src/index.ts`:
```typescript
export * from './subscription'
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/006_subscriptions.sql packages/types/src/subscription.ts packages/types/src/index.ts
git commit -m "feat(db): add subscriptions table with free-tier auto-seeding trigger"
```

---

### Task 3: Stripe dependency + env + server clients

**Files:**
- Modify: `apps/web/package.json`
- Modify: `.env.example`
- Modify: `apps/web/.env.local.example`
- Create: `apps/web/lib/stripe.ts`
- Create: `apps/web/lib/supabase/service.ts`

**Interfaces:**
- Produces: `stripe` singleton from `apps/web/lib/stripe.ts` (type: `Stripe`)
- Produces: `createServiceClient()` from `apps/web/lib/supabase/service.ts` (returns typed Supabase client with service-role key)

- [ ] **Step 1: Install Stripe SDK**

```bash
cd apps/web && npm install stripe@^17
```

Expected: package-lock.json updated, no errors.

- [ ] **Step 2: Add env vars to .env.example**

In `.env.example`, add after the existing vars:
```
# Stripe billing
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
```

In `apps/web/.env.local.example`, add:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [ ] **Step 3: Create the Stripe singleton**

```typescript
// apps/web/lib/stripe.ts
import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})
```

- [ ] **Step 4: Create the Supabase service client**

```typescript
// apps/web/lib/supabase/service.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@rock_ht/types'

export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 5: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/stripe.ts apps/web/lib/supabase/service.ts .env.example apps/web/.env.local.example
git commit -m "feat(billing): add Stripe SDK and service-role Supabase client"
```

---

### Task 4: Stripe checkout session API route

**Files:**
- Create: `apps/web/app/api/billing/checkout/route.ts`

**Interfaces:**
- Consumes: `stripe` from `apps/web/lib/stripe.ts`, `createClient` from `@/lib/supabase/server`
- Produces: `POST /api/billing/checkout` → `{ url: string }` or `{ error: string }`

- [ ] **Step 1: Implement the route**

```typescript
// apps/web/app/api/billing/checkout/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  let customerId = sub?.stripe_customer_id ?? null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabase
      .from('subscriptions')
      .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' })
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  })

  return NextResponse.json({ url: session.url })
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 3: Manual smoke test**

Start dev server (`npm run dev:web`). In browser, open DevTools. Run:
```javascript
fetch('/api/billing/checkout', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```
Expected while unauthenticated: `{ error: 'Unauthorized' }`. (Full test requires Stripe test keys in `.env.local`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/billing/checkout/route.ts
git commit -m "feat(billing): add Stripe checkout session route"
```

---

### Task 5: Stripe webhook handler

**Files:**
- Create: `apps/web/app/api/webhooks/stripe/route.ts`

**Interfaces:**
- Consumes: `stripe` from `@/lib/stripe`, `createServiceClient` from `@/lib/supabase/service`
- Produces: `POST /api/webhooks/stripe` — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

- [ ] **Step 1: Implement the webhook handler**

```typescript
// apps/web/app/api/webhooks/stripe/route.ts
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = (await headers()).get('stripe-signature')

  if (!sig) return new Response('Missing stripe-signature header', { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 })
  }

  const supabase = createServiceClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription' || !session.subscription) break
      const customerId = session.customer as string
      const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string)
      await supabase.from('subscriptions').update({
        stripe_subscription_id: stripeSub.id,
        plan: 'pro',
        status: stripeSub.status,
        current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const isActive = ['active', 'trialing'].includes(sub.status)
      await supabase.from('subscriptions').update({
        stripe_subscription_id: sub.id,
        plan: isActive ? 'pro' : 'free',
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      }).eq('stripe_customer_id', sub.customer as string)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await supabase.from('subscriptions').update({
        plan: 'free',
        status: 'canceled',
        stripe_subscription_id: null,
        current_period_end: null,
      }).eq('stripe_customer_id', sub.customer as string)
      break
    }

    default:
      // Unhandled event type — acknowledge receipt so Stripe stops retrying
      break
  }

  return new Response('ok', { status: 200 })
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 3: Smoke test with Stripe CLI (requires Stripe test keys)**

```bash
# In terminal 1: start Next.js
npm run dev:web

# In terminal 2: forward Stripe events to local webhook
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# In terminal 3: trigger a test event
stripe trigger checkout.session.completed
```

Expected: webhook handler returns 200, subscription row in DB updated to pro.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/webhooks/stripe/route.ts
git commit -m "feat(billing): add Stripe webhook handler for subscription lifecycle"
```

---

### Task 6: Billing portal API route

**Files:**
- Create: `apps/web/app/api/billing/portal/route.ts`

**Interfaces:**
- Consumes: `stripe` from `@/lib/stripe`, Supabase server client
- Produces: `POST /api/billing/portal` → `{ url: string }` or `{ error: string }`

- [ ] **Step 1: Implement the route**

```typescript
// apps/web/app/api/billing/portal/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
  })

  return NextResponse.json({ url: session.url })
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/billing/portal/route.ts
git commit -m "feat(billing): add Stripe billing portal route"
```

---

### Task 7: use-subscription hook

**Files:**
- Create: `apps/web/hooks/use-subscription.ts`

**Interfaces:**
- Consumes: Supabase `subscriptions` table (select)
- Produces: `useSubscription()` → `{ plan: Plan, isPro: boolean, status: string | null, currentPeriodEnd: string | null, isLoading: boolean }`

- [ ] **Step 1: Implement the hook**

```typescript
// apps/web/hooks/use-subscription.ts
'use client'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Plan } from '@rock_ht/utils'

export function useSubscription() {
  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .single()
      return data
    },
    staleTime: 60_000,
  })

  const plan = (data?.plan ?? 'free') as Plan

  return {
    plan,
    isPro: plan === 'pro',
    status: data?.status ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
    isLoading,
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/use-subscription.ts
git commit -m "feat(billing): add useSubscription hook"
```

---

### Task 8: Free tier enforcement + AI coach gate

**Files:**
- Modify: `apps/web/hooks/use-habits.ts` — export `isAtHabitLimit` derived from subscription + habit count
- Modify: `apps/web/app/(app)/coach/page.tsx` — gate behind `isPro`

**Interfaces:**
- Consumes: `useSubscription()` from `./use-subscription`, `habitLimitForPlan` from `@rock_ht/utils`
- Produces: `useHabits()` now additionally returns `isAtHabitLimit: boolean`

- [ ] **Step 1: Open apps/web/hooks/use-habits.ts and add the limit check**

Find the return statement of `useHabits()` and add:

```typescript
// Near the top of the hook, add import:
import { useSubscription } from './use-subscription'
import { habitLimitForPlan } from '@rock_ht/utils'

// Inside useHabits(), before the return:
const { plan } = useSubscription()
const limit = habitLimitForPlan(plan)
const activeHabits = habits.filter(h => !h.is_archived)
const isAtHabitLimit = activeHabits.length >= limit

// In the return object, add:
// isAtHabitLimit,
```

In the habit creation form/modal (wherever `createHabit` is called), show a "Upgrade to Pro" message when `isAtHabitLimit` is true and disable the create button.

Find `apps/web/components/habits/habit-form.tsx` and at the top of the component:

```tsx
import { useSubscription } from '@/hooks/use-subscription'
import { useHabits } from '@/hooks/use-habits'
// ... existing imports

// Inside component, before render:
const { isPro } = useSubscription()
const { habits } = useHabits()
const activeCount = habits.filter(h => !h.is_archived).length
const atLimit = !isPro && activeCount >= 5
```

Then in the form JSX, wrap the submit button:
```tsx
{atLimit ? (
  <div className="text-sm text-amber-500 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
    Free plan is limited to 5 habits.{' '}
    <button
      type="button"
      className="font-medium underline"
      onClick={() => fetch('/api/billing/checkout', { method: 'POST' })
        .then(r => r.json())
        .then(d => window.location.href = d.url)}
    >
      Upgrade to Pro
    </button>
  </div>
) : (
  <Button type="submit" ...>Save habit</Button>
)}
```

- [ ] **Step 2: Gate the AI coach page**

Open `apps/web/app/(app)/coach/page.tsx`. Add at the top of the component:

```tsx
import { useSubscription } from '@/hooks/use-subscription'

// Inside component, before the existing JSX:
const { isPro, isLoading } = useSubscription()

if (!isLoading && !isPro) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="text-4xl">✨</div>
      <h2 className="text-xl font-semibold">AI Coach is a Pro feature</h2>
      <p className="text-muted-foreground max-w-sm">
        Get personalized habit coaching powered by AI. Upgrade to Pro to unlock.
      </p>
      <button
        className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-medium hover:opacity-90 transition-opacity"
        onClick={() => fetch('/api/billing/checkout', { method: 'POST' })
          .then(r => r.json())
          .then(d => window.location.href = d.url)}
      >
        Upgrade to Pro
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 4: Manual verification**

Start dev server. Log in as a user with no subscription (should be auto-seeded as free). Navigate to `/habits`, try to add a 6th habit — should see the upgrade prompt. Navigate to `/coach` — should see the Pro gate screen.

- [ ] **Step 5: Commit**

```bash
git add apps/web/hooks/use-habits.ts apps/web/components/habits/habit-form.tsx "apps/web/app/(app)/coach/page.tsx"
git commit -m "feat(billing): enforce free tier limits and gate AI coach behind Pro"
```

---

### Task 9: Settings billing card

**Files:**
- Modify: `apps/web/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useSubscription()` → `{ isPro, plan, currentPeriodEnd }`

- [ ] **Step 1: Add billing card to settings page**

In `apps/web/app/(app)/settings/page.tsx`, add at the top (with other hook imports):
```typescript
import { useSubscription } from '@/hooks/use-subscription'
import { CreditCard, Sparkles } from 'lucide-react'
```

Inside the component, add:
```typescript
const { isPro, plan, currentPeriodEnd } = useSubscription()

async function handleUpgrade() {
  const res = await fetch('/api/billing/checkout', { method: 'POST' })
  const { url } = await res.json()
  window.location.href = url
}

async function handleManageBilling() {
  const res = await fetch('/api/billing/portal', { method: 'POST' })
  const { url } = await res.json()
  window.location.href = url
}
```

Add this Card before the sign-out section in the JSX:
```tsx
<Card>
  <CardHeader>
    <div className="flex items-center gap-2">
      <CreditCard className="h-4 w-4 text-muted-foreground" />
      <CardTitle className="text-base">Plan & Billing</CardTitle>
    </div>
    <CardDescription>Manage your subscription</CardDescription>
  </CardHeader>
  <CardContent className="flex items-center justify-between">
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium capitalize">{plan}</span>
        {isPro && (
          <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            <Sparkles className="h-3 w-3" /> Pro
          </span>
        )}
      </div>
      {isPro && currentPeriodEnd && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Renews {new Date(currentPeriodEnd).toLocaleDateString()}
        </p>
      )}
      {!isPro && (
        <p className="text-xs text-muted-foreground mt-0.5">
          5 habits · No AI features
        </p>
      )}
    </div>
    {isPro ? (
      <Button variant="outline" size="sm" onClick={handleManageBilling}>
        Manage billing
      </Button>
    ) : (
      <Button size="sm" onClick={handleUpgrade}>
        Upgrade to Pro
      </Button>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 2: Type-check and verify**

```bash
cd apps/web && npm run type-check
```

Navigate to `/settings` in browser. Verify billing card renders with correct plan.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/settings/page.tsx"
git commit -m "feat(billing): add billing card to settings page"
```

---

### Task 10: Google OAuth on login and signup

**Files:**
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Modify: `apps/web/app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `useSupabase()` → `supabase.auth.signInWithOAuth()`
- Note: Requires Google OAuth configured in Supabase Dashboard → Authentication → Providers → Google. Add `NEXT_PUBLIC_APP_URL/auth/callback` as an authorized redirect URI in Google Cloud Console.

- [ ] **Step 1: Add Google OAuth button to login.tsx**

In `apps/web/app/(auth)/login/page.tsx`, find the imports and add:
```typescript
import { Chrome } from 'lucide-react'
```

Inside the component, add the handler (below existing form handlers):
```typescript
async function handleGoogleLogin() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) setServerError(error.message)
}
```

In the JSX, after the closing `</form>` tag and before the signup link, add:
```tsx
<div className="relative my-4">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-border" />
  </div>
  <div className="relative flex justify-center text-xs">
    <span className="bg-card px-2 text-muted-foreground">or</span>
  </div>
</div>
<Button
  type="button"
  variant="outline"
  className="w-full"
  onClick={handleGoogleLogin}
>
  <Chrome className="mr-2 h-4 w-4" />
  Continue with Google
</Button>
```

- [ ] **Step 2: Apply same pattern to signup.tsx**

Make the identical changes in `apps/web/app/(auth)/signup/page.tsx`:
- Import `Chrome` from lucide-react
- Add `handleGoogleSignup` (identical to `handleGoogleLogin` — Supabase handles both cases)
- Add the same divider + Google button JSX after the form

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: No errors.

- [ ] **Step 4: Manual verification**

Navigate to `/login` and `/signup`. Verify Google button renders. Clicking it should redirect to Google (if provider is enabled in Supabase dashboard) or show an error from Supabase if not yet configured — either is expected.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(auth)/login/page.tsx" "apps/web/app/(auth)/signup/page.tsx"
git commit -m "feat(auth): add Google OAuth to login and signup pages"
```

---

## Self-Review

**Spec coverage:**
- ✅ Stripe checkout flow
- ✅ Stripe webhook (subscription lifecycle)
- ✅ Stripe billing portal
- ✅ DB subscriptions table with RLS
- ✅ Feature gating utility (tested)
- ✅ Free tier: 5 habit limit
- ✅ Free tier: AI coach gated
- ✅ Pro: unlimited habits + AI coach
- ✅ Google OAuth
- ✅ Settings billing card
- ⚠️ AI insights (`/analytics`) not gated behind Pro — if needed, apply same pattern as coach gate in Task 8

**Placeholder scan:** No TBDs or TODOs found.

**Type consistency:** `Plan` type used consistently from `@rock_ht/utils`. `SubscriptionRow` from `@rock_ht/types`. `planAllows` and `habitLimitForPlan` match between test and implementation.
