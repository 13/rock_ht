// Server-only (self-hosted sync backend). Never import from a client component.

/**
 * True once both self-host env vars are set. `/api/auth/*` and `/api/sync/*` answer 404 instead of
 * running when this is false, so the Supabase-configured image (which ships without either) never
 * has its pool try to connect to `localhost:5432` or its auth throw for a missing
 * `BETTER_AUTH_SECRET` just because a request happened to hit one of these routes.
 */
export function isSelfHostConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL) && Boolean(process.env.BETTER_AUTH_SECRET)
}
