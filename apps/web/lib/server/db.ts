import { Pool } from 'pg'

// Server-only (self-hosted sync backend). Never import from a client component.

// Cached on globalThis, not in a module variable: dev HMR re-evaluates this module, and each
// reload would otherwise open another pool and leak the previous one's connections.
const cache = globalThis as typeof globalThis & { __rockPgPool?: Pool }

/** One pool per server process, created on first use so `next build` works without DATABASE_URL. */
export function getPool(): Pool {
  if (!cache.__rockPgPool) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    // An idle client's connection dropping (Postgres restart, network blip) is emitted on the
    // pool; without a listener that 'error' event crashes the Node process. The pool discards
    // the broken client itself, so logging is enough.
    pool.on('error', (err) => {
      console.error('[db] idle Postgres client error', err)
    })
    cache.__rockPgPool = pool
  }
  return cache.__rockPgPool
}
