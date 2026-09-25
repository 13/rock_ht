import * as SQLite from "expo-sqlite";
import type { SqlDriver, SqlParam } from "@rock_ht/local-db";

export async function createExpoSqliteDriver(name = "rock_ht.db"): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;");

  // Single promise-chain mutex per database, shared by every top-level (non-transaction) statement AND
  // every transaction() call below. withExclusiveTransactionAsync opens its own native connection with
  // a deferred BEGIN (node_modules/expo-sqlite/src/SQLiteDatabase.ts), separate from `db`'s main
  // connection — so a bare statement on `db` (e.g. ensureProfile's upsert, ackOutbox, setMeta) issued
  // while a transaction is open competes with it for the database file and can still raise SQLITE_BUSY
  // / BUSY_SNAPSHOT even though `busy_timeout` is set on both connections. Routing every top-level call
  // — bare statement or transaction() — through this one queue means the JS side never issues a bare
  // statement while a transaction promise is outstanding, and never opens a transaction while a bare
  // statement is outstanding, so the two connections are never actually exercised concurrently. The
  // `busy_timeout` PRAGMAs are a second, independent line of defense for anything outside this queue's
  // control (e.g. WAL checkpoints), not the primary guarantee.
  let queue: Promise<unknown> = Promise.resolve();

  /** Chains `op` onto `queue`; a rejection never stalls the next caller. */
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = queue.then(op);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * `inTx`: `conn` is the connection of a running exclusive transaction. This driver's methods then
   * run flat, directly against `conn`, bypassing `enqueue` — the transaction() call that opened `conn`
   * already holds this call's place in `queue` (see below), so a nested call re-entering `enqueue`
   * here would wait on a queue slot occupied by its own, not-yet-resolved caller and deadlock.
   */
  function wrap(conn: SQLite.SQLiteDatabase, inTx: boolean): SqlDriver {
    const driver: SqlDriver = {
      exec: (sql) => (inTx ? conn.execAsync(sql) : enqueue(() => conn.execAsync(sql))),
      run: (sql, params: SqlParam[] = []) => {
        const op = async () => {
          await conn.runAsync(sql, params);
        };
        return inTx ? op() : enqueue(op);
      },
      all: <T,>(sql: string, params: SqlParam[] = []) =>
        inTx ? conn.getAllAsync<T>(sql, params) : enqueue(() => conn.getAllAsync<T>(sql, params)),
      first: <T,>(sql: string, params: SqlParam[] = []) =>
        inTx ? conn.getFirstAsync<T>(sql, params) : enqueue(() => conn.getFirstAsync<T>(sql, params)),
      // Exclusive: a background sync applyRemote can't interleave with a user write,
      // which withTransactionAsync (shared connection) would allow.
      transaction: (fn) => {
        if (inTx) return fn(driver);
        return enqueue(() =>
          conn.withExclusiveTransactionAsync(async (txn) => {
            // This connection is opened fresh per transaction, so it doesn't inherit the
            // busy_timeout PRAGMA set on `db`'s connection above.
            await txn.execAsync("PRAGMA busy_timeout = 5000;");
            await fn(wrap(txn, true));
          }),
        );
      },
    };
    return driver;
  }

  return wrap(db, false);
}
