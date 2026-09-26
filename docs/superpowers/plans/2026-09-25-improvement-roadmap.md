# rock Improvement Roadmap (2026-09-25)

A prioritised list of improvements, based on this session's CI runs, the code reviews and a quick audit. Each item names the evidence, the fix and the size (S < 1h, M ≈ half a day, L = multi-day, which needs its own plan). Items marked ★ are real user-facing bugs.

## Status (2026-09-26)

- **Done:** P0 #1–#4; #5–#7 APK pipeline (`2026-09-25-apk-release-pipeline.md`); #8 web test safety net (vitest route tests + Playwright smoke); #9/#10 clean build; #16/#17 timezone fixes (migration 007); #11 offline-first milestones M1, M2 (sync engine, sync settings) and M3 (self-hosted server, `docker-compose.selfhost.yml`).
- **Also done:** mobile gaps (bottom sheet scroll, reminder time picker, five themes, persisted reminders switch), About section + in-app updates from GitHub releases (`2026-09-26-about-and-updates.md`).
- **Owner actions pending:** push `main`; upload signing secrets to the `release` environment; tag `v0.3.0` then bump `app.json` to 0.4.0; make `ghcr.io/13/rock_ht-web` public; deploy migration 007 to the hosted Supabase.
- **Next:** M4 (Supabase as optional sync backend, Tasks 14–15, carry-over lists in the plan); #12 rate limiter across replicas; #13 Docker HEALTHCHECK; #14 split large web pages; #15 Dependabot / pinned actions; iOS verification of the time picker and updater.

## P0: broken now (small, do first)

| # | Item | Evidence | Fix | Size |
|---|---|---|---|---|
| 1 ★ | **Local vs UTC date mix** | `packages/db/src/completions.ts` `getLast30DaysCompletions` and `packages/db/src/journal.ts` `createJournalEntry` build dates with `toISOString().split("T")`, which gives the UTC date, while `@rock_ht/utils` `today()` uses the local date. For users east of UTC between 00:00 and their UTC offset, the 30-day window and the default journal date are one day off. The test helper `daysAgo` in `streaks.test.ts`/`insights.test.ts` has the same bug, so 3 tests fail locally around midnight CEST. | Use `today()` / `formatDate(subDays(new Date(), n))` from `@rock_ht/utils` everywhere. Fix the test helpers the same way. Add a CI matrix that runs tests under `TZ=Pacific/Kiritimati` (UTC+14) and `TZ=Pacific/Pago_Pago` (UTC−11) so the bug can't come back. | S |
| 2 | **Mobile typed-route errors CI can't see** | `npx tsc` in `apps/mobile` shows 4 errors: `"/(tabs)/"` is not a valid route (`app/_layout.tsx:43,62`, `app/index.tsx:4`, `app/onboarding.tsx:325`). CI passes only because `.expo/types` (the generated route types) is gitignored and never created in CI. | Change the four strings to `"/(tabs)"`. In CI, generate the route types before type-checking (`npx expo customize tsconfig.json` doesn't do this; run `npx expo-router-generate-types`-style generation via `npx expo start --non-interactive` with a timeout, or commit `apps/mobile/expo-env.d.ts` plus the generated `.expo/types/router.d.ts`). | S |
| 3 | **Deploy workflows red on every push** | `Deploy web` fails because the Supabase secrets are missing (prerender of `/terms` needs Supabase). `Deploy mobile` runs `eas build` on every push to `apps/mobile/**` with no `EXPO_TOKEN`. | Either add the secrets, or: (a) make the web build Supabase-optional (offline-sync plan Task 10), and (b) gate `deploy-mobile.yml` with `if: ${{ secrets.EXPO_TOKEN != '' }}` (via an env indirection) or make it `workflow_dispatch`-only. | S |
| 4 | **Tracked build artifact and a stray folder** | `apps/web/tsconfig.tsbuildinfo` (2.4 MB) is committed and changes on every build; there's an empty untracked `apps/web/lib/{supabase}/` folder, left by a shell brace-expansion accident. | `git rm --cached apps/web/tsconfig.tsbuildinfo`, add `*.tsbuildinfo` to `.gitignore`, and `rmdir 'apps/web/lib/{supabase}'`. | S |

## P1: release quality

| # | Item | Evidence | Fix | Size |
|---|---|---|---|---|
| 5 | **Release APK signed with the debug key** | `android/app/build.gradle` has `release { signingConfig signingConfigs.debug }`. Anyone with the public debug key can sign an "update", and Play Store rejects the APK. | Generate an upload keystore. Store it base64-encoded as a GitHub secret together with its passwords, have the workflow decode it into `android/app/release.keystore`, and add a `signingConfigs.release` that reads `ROCK_HT_UPLOAD_*` gradle properties and falls back to debug when they're absent (local builds). | M |
| 6 | **APK is 106 MB** | A universal APK ships 4 ABIs; `enableMinifyInReleaseBuilds` and `shrinkResources` are off. | Build `arm64-v8a` only for releases (`-PreactNativeArchitectures=arm64-v8a`), or enable ABI splits and attach one APK per ABI. Turn on R8 minify and shrinkResources, with a keep-rules check. Expect about 30–40 MB. | S–M |
| 7 | **versionCode/versionName don't follow tags** | `app.json` says `1.0.0` and the gradle versionCode is fixed, so every tagged APK has the same version and Android refuses to install it over an older build. | In `android-apk.yml`, derive `versionName` from the tag (`v0.1.1` → `0.1.1`) and `versionCode` from `github.run_number`, and pass them as gradle `-P` properties read in `build.gradle`. | S |
| 8 | **No tests outside `@rock_ht/utils`** | 55 tests, all in `packages/utils`. The billing webhook, the AI routes, the rate limiter, the `@rock_ht/db` query builders and all UI are untested. | (a) vitest route-handler tests for `api/webhooks/stripe` (signature failure, subscription upsert) and the AI routes (auth, rate limit, Pro gating), with SDKs mocked at the module edge. (b) A Playwright smoke test for the web (landing → login page → manifest/icons load). (c) Later: Maestro flows for mobile (onboarding → create habit → toggle). | M |
| 9 | **17 lint warnings** | Mostly unused variables, plus 4 `react-hooks/set-state-in-effect` warnings (habits, journal, completion note, web notifications) and one `react-hooks/incompatible-library` warning on `watch()`. | Remove the unused variables. Refactor the 4 effects to derive state or initialise lazily (web notifications: `useSyncExternalStore`). Then turn the rule back to `error`. | S–M |
| 10 | **Sentry build warning** | `next build` prints "ACTION REQUIRED … export `onRouterTransitionStart`". | Add `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;` to `apps/web/instrumentation-client.ts`. | S |

## P2: architecture and product

| # | Item | Notes | Size |
|---|---|---|---|
| 11 | **Offline-first mobile + pluggable sync** | Plan ready: `docs/superpowers/plans/2026-09-24-offline-first-sync.md` (12 tasks). It removes the Supabase hard dependency from mobile and fixes the placeholder-secret problems in CI. | L (plan exists) |
| 12 | **Rate limiter is per process, in memory** | `apps/web/lib/rate-limit.ts` resets on redeploy and doesn't work across replicas. It's fine for one container. For more than one, use Postgres (`insert … on conflict` with a window) or Upstash, and add a `Retry-After` header (noted in an earlier review). | S–M |
| 13 | **Docker runtime health** | `/api/health` exists but the image has no `HEALTHCHECK`, and the compose/self-host setup needs one for `depends_on`. Add `HEALTHCHECK CMD wget -qO- localhost:3000/api/health \|\| exit 1`. | S |
| 14 | **Large page components** | `settings/page.tsx` (468 lines), `dashboard/page.tsx` (347) and `journal/page.tsx` (330) mix data, state and markup. Split the sections into `components/settings/*` when these pages are next touched, not as a standalone refactor. | M |
| 15 | **Dependency/CI hygiene** | Add Dependabot (npm + GitHub Actions); pin actions to SHAs; approve `unrs-resolver` in `npm install-scripts`; cache Gradle and Metro in the APK workflow (the APK job takes about 8 min). | S |

## Follow-ups found during P0

| # | Item | Evidence | Fix | Size |
|---|---|---|---|---|
| 16 ★ | **Done — Streak trigger uses the server's UTC date** | `supabase/migrations/003_functions_triggers.sql:110`. `recalculate_streak` compares against `current_date`, which is UTC on the DB server. For a user west of UTC in the evening after UTC midnight, un-toggling today's completion zeroes a live streak. The displayed streaks come from `habit_streaks` via `getStreaks` on both web and mobile. | Fixed in `supabase/migrations/007_timezone_streaks.sql`: `recalculate_streak` now computes "today" as `(now() at time zone p.timezone)::date`, resolving `profiles.timezone` against `pg_timezone_names` and falling back to UTC. The web app also now writes the browser's IANA time zone onto `profiles.timezone` on load (`apps/web/components/layout/timezone-sync.tsx`), so the column stops being stuck at the `'UTC'` default. | S–M |
| 17 | **Done — Server-side "today" for AI routes** | `apps/web/app/api/ai/journal-prompt/route.ts:37` and `api/ai/coach` (via `getLast30DaysCompletions`) run in the container timezone (UTC), not the user's. | Fixed: both routes load `profile.timezone` and compute `todayIn(profile?.timezone ?? "UTC")` (new `@rock_ht/utils` helper), passed to `getTodayCompletions` and `getLast30DaysCompletions(db, user.id, todayStr)`. | S |

## Suggested order

1. **P0 #1–#4** as one small branch: bugs plus CI green (about 2 h).
2. **P1 #5–#7**, the APK release pipeline: signed, smaller, versioned (half a day).
3. **P1 #10 + #9**, clean build and lint.
4. **P1 #8**, the test safety net, before…
5. **P2 #11**, the offline-first sync plan (multi-day).
6. The rest as they become relevant.
