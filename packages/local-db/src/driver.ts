export type SqlParam = string | number | null

/** Minimal async SQLite surface; implemented by expo-sqlite on device and better-sqlite3 in tests. */
export interface SqlDriver {
  exec(sql: string): Promise<void>
  run(sql: string, params?: SqlParam[]): Promise<void>
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>
  /**
   * Runs `fn` in one exclusive transaction. Use only `tx` inside `fn`.
   * `tx.transaction(g)` runs `g(tx)` flat inside the same transaction.
   * Concurrent top-level calls are serialized: a second caller's `fn` starts only after the first's
   * transaction commits or rolls back — implementations must queue, never interleave or reject as busy.
   */
  transaction(fn: (tx: SqlDriver) => Promise<void>): Promise<void>
}
