import { betterAuth } from 'better-auth'
import { expo } from '@better-auth/expo'
import { randomUUID } from 'node:crypto'
import { getPool } from './db'

// Server-only (self-hosted sync backend). Never import from a client component.

/**
 * `updated_at` of the profile created at sign-up. Older than any real device timestamp, so the
 * signing-up phone's first profile push wins last-write-wins even when its clock runs behind the
 * server (a `now()` here would make the pull overwrite its onboarding flag and timezone with the
 * defaults). One millisecond past the epoch rather than the epoch itself: a device that signs in
 * without pushing floors its local profile to the epoch (`claim` in @rock_ht/local-db), and pulls
 * only accept strictly newer rows. Not `-infinity`: clients parse it with `new Date()`.
 */
export const SIGNUP_PROFILE_UPDATED_AT = '1970-01-01T00:00:00.001Z'

// The literal placeholder .env.selfhost.example shipped before it started leaving this value empty.
// A copy-pasted .env.selfhost from that era would otherwise sign every session with a secret anyone
// who has ever read this repo also has.
const OLD_PLACEHOLDER_SECRET = 'generate-with-openssl-rand-base64-32'

function create() {
  if (process.env.BETTER_AUTH_SECRET === OLD_PLACEHOLDER_SECRET) {
    throw new Error(
      'BETTER_AUTH_SECRET is still the placeholder from an old .env.selfhost.example. ' +
      'Generate a real one (openssl rand -hex 32) and set it in .env.selfhost.',
    )
  }
  // Comma-separated IPs/CIDRs of reverse proxies in front of this server (nginx, Caddy). When set,
  // better-auth walks the forwarded-IP header chain right to left, skips trusted hops, and takes the
  // first untrusted address as the client IP; unset, it trusts only a single-value IP header. See the
  // README's self-host section for nginx/Caddy config that sets such a header.
  const trustedProxies = process.env.TRUSTED_PROXIES
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return betterAuth({
    database: getPool(),
    emailAndPassword: {
      enabled: true,
      // ALLOW_SIGNUP defaults to "true". Set to "false" once you've created your account(s) to close
      // sign-up on a self-hosted server reachable from the internet.
      disableSignUp: process.env.ALLOW_SIGNUP === 'false',
    },
    // Accepts the mobile client's `expo-origin` header (as the Origin of auth POSTs).
    plugins: [expo()],
    trustedOrigins: ['rockht://'],
    // uuid ids so they fit profiles.id / user_id uuid columns
    advanced: {
      database: { generateId: () => randomUUID() },
      // Explicit, so the auth routes' Origin/CSRF check also runs under NODE_ENV=test (Better
      // Auth skips it there by default) and the integration tests exercise production behavior.
      // The /api/sync routes don't go through it: they only read the session.
      disableOriginCheck: false,
      ...(trustedProxies && trustedProxies.length > 0 ? { ipAddress: { trustedProxies } } : {}),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getPool().query(
              `insert into public.profiles (id, email, display_name, updated_at) values ($1, $2, $3, $4)
               on conflict (id) do nothing`,
              [user.id, user.email, user.name || user.email.split('@')[0], SIGNUP_PROFILE_UPDATED_AT],
            )
          },
        },
      },
    },
  })
}

let instance: ReturnType<typeof create> | undefined

/** Lazy so `next build` works without DATABASE_URL. */
export function getAuth() {
  instance ??= create()
  return instance
}

/** The signed-in user's id from the request's better-auth session cookie, or null. */
export async function getSessionUserId(req: Request): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: req.headers })
  return session?.user.id ?? null
}
