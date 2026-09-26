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

function create() {
  return betterAuth({
    database: getPool(),
    emailAndPassword: { enabled: true },
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
