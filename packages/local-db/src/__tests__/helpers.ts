import Database from 'better-sqlite3'
import type { SqlDriver, SqlParam } from '../driver'

export function openTestDriver(): SqlDriver {
  const db = new Database(':memory:')

  function make(inTx: boolean): SqlDriver {
    const driver: SqlDriver = {
      async exec(sql) { db.exec(sql) },
      async run(sql, params = []) { db.prepare(sql).run(...params) },
      async all<T>(sql: string, params: SqlParam[] = []) { return db.prepare(sql).all(...params) as T[] },
      async first<T>(sql: string, params: SqlParam[] = []) { return (db.prepare(sql).get(...params) ?? null) as T | null },
      async transaction(fn) {
        // Already inside a transaction: run flat, like the device driver.
        if (inTx) return fn(driver)
        db.exec('BEGIN IMMEDIATE')
        try { await fn(make(true)); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
      },
    }
    return driver
  }

  return make(false)
}
