---
name: project-sisigo
description: sisiGo MVP project context - monorepo structure, tech stack, and architecture decisions
metadata:
  type: project
---

sisiGo is a cross-platform habit tracker app built as a monorepo.

**Why:** Help users build consistency with minimal friction. Philosophy: fast, calm, minimal, emotional.

**Monorepo layout:**
- `apps/web` — Next.js 14, Tailwind CSS, Framer Motion, TanStack Query, Zustand
- `apps/mobile` — Expo SDK 52, Expo Router, NativeWind v4, Reanimated 3
- `packages/types` — Supabase DB types + domain types (no runtime)
- `packages/utils` — Streak algorithms, date helpers, habit logic (pure, no React)
- `packages/db` — Supabase query layer + realtime subscriptions

**Backend:** Supabase (PostgreSQL + Auth + Realtime). Tables: `profiles`, `habits`, `habit_completions`, `habit_streaks`, `journal_entries`.

**Key architecture decisions:**
- Streak cache maintained by DB triggers (`recalculate_streak` function)
- Optimistic updates on completion toggle (instant UI feedback)
- `TypedSupabaseClient = SupabaseClient<Database, any, any>` in packages/db to avoid Supabase SDK v2.105 generic type mismatch between @supabase/ssr browser client and @supabase/supabase-js
- Five themes via CSS variables: light, dark, midnight, forest, sunset
- Auth: @supabase/ssr for web (cookie sessions + middleware), expo-secure-store for mobile
- npm workspaces + Turborepo (not pnpm — pnpm wasn't installed)
- NativeWind v4 className fix: `expo-env.d.ts` with `/// <reference types="nativewind/types" />` (resolves className TS errors)
- Offline queue: AsyncStorage-backed queue for completions when offline; flushed in root `_layout.tsx` on NetInfo connectivity restore
- Push notifications: `apps/mobile/lib/notifications.ts` using expo-notifications with `DAILY` trigger type
- Journal: `packages/db/src/journal.ts` CRUD; web has `/journal` page; mobile has `(tabs)/journal.tsx`
- `SpecificDaysFrequency.days` is `number[]` (0=Sun..6=Sat) and `TimesPerWeekFrequency` uses `count` (not `times`)

**Build phases completed:**
- Phase 1: Monorepo setup, DB schema, auth, shared packages
- Phase 2: Habit CRUD UI, realtime sync, drag-to-reorder (web), swipe gestures (mobile), bottom sheet
- Phase 3: Journal (web + mobile), push notifications, offline queue, enhanced analytics (stats overview + weekly bar chart), mobile settings with notification toggle

**How to apply:** When continuing development, use this folder structure and these patterns. The db package functions accept `any` client but return explicit types.
