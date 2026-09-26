import { AsyncLocalStorage } from 'node:async_hooks'
import Database from 'better-sqlite3'
import type { SqlDriver, SqlParam } from '../driver'

/**
 * better-sqlite3 driver that mirrors apps/mobile/lib/sqlite-driver.ts: every top-level call — bare
 * statement or transaction() — goes through one promise queue, so a bare statement from an unrelated
 * caller waits for an open transaction instead of running inside it.
 *
 * On device, a bare statement on the outer driver issued from *inside* a transaction callback waits
 * on the queue slot its own transaction holds and deadlocks silently. Here the same misuse is detected
 * (the callback runs in an AsyncLocalStorage context) and rejected, so it fails tests loudly.
 */
export function openTestDriver(): SqlDriver {
  const db = new Database(':memory:')
  const insideTx = new AsyncLocalStorage<true>()
  let queue: Promise<unknown> = Promise.resolve()

  /** Chains `op` onto `queue`; a rejection never stalls the next caller. */
  function enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    if (insideTx.getStore()) {
      return Promise.reject(new Error(
        'outer driver used inside a transaction callback: use the tx argument (this deadlocks on device)',
      ))
    }
    const result = queue.then(op)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  function make(inTx: boolean): SqlDriver {
    const call = <T>(op: () => T): Promise<T> => (inTx ? Promise.resolve().then(op) : enqueue(op))
    const driver: SqlDriver = {
      exec: (sql) => call(() => { db.exec(sql) }),
      run: (sql, params = []) => call(() => { db.prepare(sql).run(...params) }),
      all: <T>(sql: string, params: SqlParam[] = []) => call(() => db.prepare(sql).all(...params) as T[]),
      first: <T>(sql: string, params: SqlParam[] = []) =>
        call(() => (db.prepare(sql).get(...params) ?? null) as T | null),
      async transaction(fn) {
        // Already inside a transaction: run flat, like the device driver.
        if (inTx) return fn(driver)
        return enqueue(async () => {
          db.exec('BEGIN IMMEDIATE')
          try {
            await insideTx.run(true, () => fn(make(true)))
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
        })
      },
    }
    return driver
  }

  return make(false)
}
