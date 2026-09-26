/**
 * Whether this build has a Supabase project to talk to. The self-hosted image (docker-compose.selfhost.yml)
 * is built without one: it serves the marketing pages, /api/auth and /api/sync, and web login is disabled.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so the answer is the same on the server and in the
 * browser bundle of a given build.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export const SUPABASE_NOT_CONFIGURED = 'Supabase not configured'
