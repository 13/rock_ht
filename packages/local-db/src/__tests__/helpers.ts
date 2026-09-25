import Database from 'better-sqlite3'
import type { SqlDriver, SqlParam } from '../driver'

export function openTestDriver(): SqlDriver {
  const db = new Database(':memory:')
  // Serializes concurrent top-level transaction() calls on this single connection, the way a
  // well-behaved async SQLite driver (e.g. expo-sqlite) would: only one exclusive transaction runs
  // at a time, and a second caller waits for the first to commit/rollback instead of racing it.
  let queue: Promise<unknown> = Promise.resolve()

  function make(inTx: boolean): SqlDriver {
    const driver: SqlDriver = {
      async exec(sql) { db.exec(sql) },
      async run(sql, params = []) { db.prepare(sql).run(...params) },
      async all<T>(sql: string, params: SqlParam[] = []) { return db.prepare(sql).all(...params) as T[] },
      async first<T>(sql: string, params: SqlParam[] = []) { return (db.prepare(sql).get(...params) ?? null) as T | null },
      async transaction(fn) {
        // Already inside a transaction: run flat, like the device driver.
        if (inTx) return fn(driver)
        const result = queue.then(async () => {
          db.exec('BEGIN IMMEDIATE')
          try { await fn(make(true)); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
        })
        // Keep the queue moving even if this transaction failed; don't let its rejection leak
        // into unrelated callers queued behind it.
        queue = result.catch(() => undefined)
        return result
      },
    }
    return driver
  }

  return make(false)
}
