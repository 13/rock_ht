interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Prune expired entries every 10 minutes to prevent memory leaks
const pruneInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key)
  }
}, 10 * 60 * 1000)
// Don't let this interval keep the process (or a test runner) alive.
pruneInterval.unref?.()

/**
 * Returns true if the request is within the rate limit, false if it should be blocked.
 * key: unique identifier (e.g. `ai_coach:user-uuid`)
 * limit: max requests allowed in windowMs
 * windowMs: time window in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false

  entry.count++
  return true
}
