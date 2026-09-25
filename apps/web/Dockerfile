# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f apps/web/Dockerfile -t rock_ht-web .

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo

# Copy manifests for all workspaces so npm ci can resolve everything
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/

RUN npm ci --prefer-offline

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

# Copy whole deps tree: root node_modules plus any nested workspace node_modules
COPY --from=deps /repo ./

# Copy full source (packages first so Next can transpile them)
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY tsconfig.base.json turbo.json ./

# Build-time env vars (public only — no secrets needed at build time)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /repo/apps/web
# public/ is optional in the repo but the runner stage copies it
RUN mkdir -p public && npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Next.js standalone output bundles everything needed. In a monorepo it mirrors
# the repo layout, so server.js lands in apps/web/.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static   ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public          ./apps/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
