# rock habit tracker

A cross-platform habit tracker with real-time sync, AI coaching, and streak analytics.

- **Web** — Next.js 14 (App Router), deployed via Docker or Vercel
- **Mobile** — React Native + Expo (iOS & Android)
- **Backend** — Supabase (PostgreSQL, Auth, Realtime)
- **Monorepo** — npm workspaces + Turborepo

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Project structure](#project-structure)
- [Quickstart](#quickstart)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Supabase setup](#supabase-setup)
- [Building](#building)
- [Docker](#docker)
- [Deployment](#deployment)
- [GitHub Actions](#github-actions)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | `engines` field enforced |
| npm | ≥ 11 | comes with Node 20 |
| Docker | ≥ 24 | required for local Supabase dev |
| Expo CLI | latest | optional, mobile only |

**Note:** Supabase CLI is included as a dev dependency—no global install needed.

---

## Project structure

```
rock_ht/
├── apps/
│   ├── web/          # Next.js web app
│   └── mobile/       # Expo React Native app
├── packages/
│   ├── db/           # Supabase query helpers (shared)
│   ├── types/        # Shared TypeScript types
│   └── utils/        # Shared business logic (streaks, insights, …)
├── supabase/
│   ├── migrations/   # SQL migrations (apply in order)
│   └── seed.sql      # Optional seed data
├── .github/
│   └── workflows/    # CI and deploy pipelines
├── turbo.json
└── package.json
```

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/your-org/rock_ht.git
cd rock_ht

# 2. Install all workspace dependencies
npm install

# 3. Copy and fill in environment variables
cp .env.example .env.local
cp apps/web/.env.local.example apps/web/.env.local
# Edit both files — see Environment variables below

# 4. Start local Supabase (PostgreSQL + Auth + Realtime)
npm run db:start

# 5. Apply database migrations
npm run db:reset

# 6. Start dev servers in new terminal
npm run dev
```

**URLs:**
- Web app: http://localhost:3000
- Supabase Studio: http://localhost:54323
- Mobile: Expo will show QR code in terminal

**Useful commands:**
```bash
npm run db:stop        # Stop local Supabase
npm run db:start       # Restart Supabase
npm run dev:web        # Web only
npm run dev:mobile     # Mobile only
```

---

## Environment variables

### Root `.env.local`

Consumed by shared packages and Turborepo.

```env
# Supabase — from Project Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-side only

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### `apps/web/.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

NEXT_PUBLIC_APP_URL=http://localhost:3000

# AI Coach — from console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...
```

### Mobile (`apps/mobile`)

The mobile app needs **no env vars**: it runs fully offline, with local SQLite as its store,
no login and no network required. Optionally set `EXPO_PUBLIC_SENTRY_DSN` in
`apps/mobile/.env` for crash reporting (Sentry is a no-op without it); see
`apps/mobile/.env.local.example`. Build with `scripts/build-apk.sh` (`--install <serial>`
also installs on a connected device).

> Variables prefixed `EXPO_PUBLIC_` are bundled into the app. Never put service-role keys here.

---

## Development

### All apps in parallel

```bash
npm run dev
```

Turborepo starts the web dev server and Expo simultaneously.

### Web only

```bash
npm run dev:web
# or
cd apps/web && npm run dev
```

### Mobile only

```bash
npm run dev:mobile
# or
cd apps/mobile && npx expo start
```

Press `i` for iOS simulator, `a` for Android emulator, `w` for web.

### Useful commands

```bash
npm run type-check   # TypeScript across all packages
npm run lint         # ESLint across all packages
npm run build        # Production build (web + packages)
npm run clean        # Remove build artifacts and node_modules
```

---

## Supabase setup

### Option A — Supabase cloud (recommended for production)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the **Project URL** and **anon key** from *Project Settings → API*
3. Copy the **service role key** for server-side routes (keep it secret)
4. Apply migrations:

```bash
# Link to your project (one-time)
supabase link --project-ref <project-ref>

# Push all migrations
supabase db push
```

5. (Optional) Load seed data:

```bash
supabase db execute --file supabase/seed.sql
```

### Option B — Local Supabase (recommended for development)

```bash
# Start local stack (PostgreSQL + Auth + Studio + Realtime)
npm run db:start

# Apply migrations and seed
npm run db:reset

# Stop when done
npm run db:stop
```

Local endpoints:
- API: http://localhost:54321
- Studio: http://localhost:54323
- DB: postgresql://postgres:postgres@localhost:54322/postgres

When running locally, `.env.local` should use these defaults (usually already configured).

### Migrations

Migration files live in `supabase/migrations/` and run in filename order:

| File | Description |
|------|-------------|
| `001_initial_schema.sql` | Core tables: habits, completions, streaks, journal |
| `002_rls_policies.sql` | Row-level security — users see only their own data |
| `003_functions_triggers.sql` | Streak computation triggers, helper functions |

---

## Building

### Web

```bash
npm run build
# or
cd apps/web && npm run build
```

Output: `apps/web/.next/`

### Packages (required before web build)

Turborepo handles build order automatically — packages are built before apps.

### Mobile (EAS)

```bash
cd apps/mobile

# Development build
npx eas build --profile development --platform all

# Production
npx eas build --profile production --platform all
```

Requires an Expo account and `eas.json` configured with your credentials.

---

## Docker

The web app ships as a self-contained Docker image using Next.js [standalone output](https://nextjs.org/docs/app/api-reference/next-config-js/output).

### Build the image

```bash
docker build -f apps/web/Dockerfile -t rock_ht-web .
```

The build context is the **repo root** so the shared packages are available.

### Run the container

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -e NEXT_PUBLIC_APP_URL=https://yourdomain.com \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  rock_ht-web
```

### Docker Compose (local full-stack)

```bash
# Copy and fill in the compose env file
cp .env.example .env

docker compose up
```

Services started:
- `web` — Next.js on port 3000

> Supabase is not included in Compose because it is best run via the Supabase CLI locally or consumed as a cloud service in staging/production. See [Supabase setup](#supabase-setup).

### Self-hosted sync server (no Supabase)

`docker-compose.selfhost.yml` runs a sync server for the mobile app: Postgres 17 (schema from `db/selfhost/init`, loaded when the volume is first created) and the `ghcr.io/13/rock_ht-web` image, which serves Better Auth at `/api/auth` and sync at `/api/sync`. The image is built without Supabase config, so the web UI only shows the landing page and the login pages say "This server has no web login configured".

```bash
cp .env.selfhost.example .env.selfhost   # set POSTGRES_PASSWORD, BETTER_AUTH_SECRET, PUBLIC_URL (WEB_PORT, default 3000)
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/sync/pull   # 401 = up, not signed in
```

In the app: Settings → Sync → Self-hosted → your `PUBLIC_URL` → Create account. Plain `http://` LAN URLs work for testing (the Android emulator reaches the host at `http://10.0.2.2:<WEB_PORT>`); for anything reachable from the internet, put HTTPS in front (e.g. Caddy) and use the `https://` URL.

> The `ghcr.io/13/rock_ht-web` package must be **public** (Package settings → Change visibility) or an anonymous `docker compose pull` will get a 401/denied. This is a one-time setting for whoever owns the GHCR package/repo.

#### Upgrading

`db/selfhost/init` only runs against a brand-new `pgdata` volume — an existing deployment's schema is *not* touched by pulling a new image. To move an existing self-host deployment to a newer release:

1. Pull the checkout at the release tag you're upgrading to (`git fetch --tags && git checkout vX.Y.Z`), so the SQL below matches the image you're about to run.
2. Set `ROCK_HT_VERSION` in `.env.selfhost` to that tag **without its leading `v`** (e.g. `v1.4.0` → `1.4.0`) — that's the tag suffix the self-host image is published under (`ghcr.io/13/rock_ht-web:selfhost-1.4.0`).
3. Pull and restart the containers:
   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost pull
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
   ```
4. Apply `db/selfhost/init/02_sync.sql` (functions and triggers only — see below for why `01_schema.sql` isn't included here) against the running database, using the actual user/db from `.env.selfhost`/the compose file (`rock_ht`/`rock_ht` unless you changed them):
   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db \
     psql -U rock_ht -d rock_ht -v ON_ERROR_STOP=1 -1 < db/selfhost/init/02_sync.sql
   ```

`02_sync.sql` is idempotent (`create or replace function/trigger`, and `drop function if exists` before the one function whose signature changed) and safe to re-run against an already-upgraded database. `01_schema.sql` is **not** idempotent (plain `create table`/`create sequence`/`create index`, no `if not exists`) — it only ever runs once, against a fresh volume. A future schema change ships as a new, numbered upgrade script (e.g. `db/selfhost/upgrades/002_*.sql`) with its own instructions here, not as an edit to `01_schema.sql`.

---

## Deployment

### Web — Vercel (simplest)

1. Import the repo on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `apps/web`
3. Add all environment variables from `apps/web/.env.local`
4. Deploy

### Web — Docker (self-hosted / Railway / Fly.io)

```bash
# Build
docker build -f apps/web/Dockerfile -t ghcr.io/your-org/rock_ht-web:latest .

# Push
docker push ghcr.io/your-org/rock_ht-web:latest
```

Then deploy the image to any container platform, passing env vars via platform secrets.

### Mobile — Expo Application Services

```bash
cd apps/mobile
npx eas submit --platform ios
npx eas submit --platform android
```

---

## GitHub Actions

Three workflows are included:

### `ci.yml` — runs on every PR and push

- Type-check all packages and apps
- Lint the web app
- Build packages (validates compilation)

### `deploy-web.yml` — runs on push to `main`

- Builds the Docker image
- Pushes to GitHub Container Registry (`ghcr.io`)
- Tagged with `latest` and the git SHA

### `deploy-mobile.yml` — runs on push to `main` or workflow dispatch

- Triggers an EAS build for both platforms
- Requires `EXPO_TOKEN` stored as a repository secret

### Required secrets

Configure these in *Settings → Secrets and variables → Actions*:

| Secret | Used by | Description |
|--------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `deploy-web` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `deploy-web` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `deploy-web` | Supabase service role key |
| `NEXT_PUBLIC_APP_URL` | `deploy-web` | Production app URL |
| `ANTHROPIC_API_KEY` | `deploy-web` | Anthropic API key |
| `EXPO_TOKEN` | `deploy-mobile` | Expo personal access token |
