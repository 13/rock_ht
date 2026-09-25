import * as SQLite from "expo-sqlite";
import type { SqlDriver, SqlParam } from "@rock_ht/local-db";

export async function createExpoSqliteDriver(name = "rock_ht.db"): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  // busy_timeout: statements run outside a transaction on this (main) connection — e.g.
  // ensureProfile's upsert, ackOutbox, setMeta — use expo-sqlite's own connection, separate from the
  // one withExclusiveTransactionAsync opens for a transaction() call below. Without a busy timeout,
  // one of those bare statements landing while an exclusive transaction is open raises SQLITE_BUSY
  // immediately instead of waiting for the transaction to finish.
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;");
  // Serializes concurrent top-level transaction() calls: SqlDriver.transaction() promises "one
  // exclusive transaction" (packages/local-db/src/driver.ts) — a second caller must wait for the
  // first's commit/rollback, never interleave or throw "database is locked". Plain
  // withExclusiveTransactionAsync calls queue on the native side per-database, but that queuing isn't
  // part of its documented contract, so a promise-chain mutex makes the guarantee explicit and testable
  // (mirrors packages/local-db/src/__tests__/helpers.ts's openTestDriver, whose race test depends on it).
  let queue: Promise<unknown> = Promise.resolve();

  /**
   * `inTx`: `conn` is the connection of a running exclusive transaction; nested
   * `transaction()` calls then run flat on it.
   */
  function wrap(conn: SQLite.SQLiteDatabase, inTx: boolean): SqlDriver {
    const driver: SqlDriver = {
      exec: (sql) => conn.execAsync(sql),
      run: async (sql, params: SqlParam[] = []) => { await conn.runAsync(sql, params); },
      all: <T,>(sql: string, params: SqlParam[] = []) => conn.getAllAsync<T>(sql, params),
      first: <T,>(sql: string, params: SqlParam[] = []) => conn.getFirstAsync<T>(sql, params),
      // Exclusive: a background sync applyRemote can't interleave with a user write,
      // which withTransactionAsync (shared connection) would allow.
      transaction: (fn) => {
        if (inTx) return fn(driver);
        const result = queue.then(() =>
          conn.withExclusiveTransactionAsync((txn) => fn(wrap(txn, true))),
        );
        queue = result.catch(() => undefined);
        return result;
      },
    };
    return driver;
  }

  return wrap(db, false);
}
