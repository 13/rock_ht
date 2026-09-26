import { Pool } from 'pg'

// Server-only (self-hosted sync backend). Never import from a client component.

let pool: Pool | undefined

/** One pool per server process, created on first use so `next build` works without DATABASE_URL. */
export function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL })
  return pool
}
