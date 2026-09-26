import type { SqlDriver } from './driver'

// Mirrors the Postgres tables (see supabase/migrations) plus sync columns.
// Append new migrations; never edit a shipped one.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    row_json TEXT NOT NULL
  );
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    theme TEXT NOT NULL DEFAULT 'dark',
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    time_format TEXT NOT NULL DEFAULT '12h',
    date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE habits (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    frequency TEXT NOT NULL,
    target_value INTEGER NOT NULL DEFAULT 1,
    target_unit TEXT,
    reminder_time TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE habit_completions (
    id TEXT PRIMARY KEY NOT NULL,
    habit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_date TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (habit_id, completed_date)
  );
  CREATE INDEX completions_date_idx ON habit_completions (completed_date);
  CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    habit_id TEXT,
    entry_date TEXT NOT NULL,
    content TEXT NOT NULL,
    mood INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX journal_date_idx ON journal_entries (entry_date);
  `,
  // 2: outbox compaction per (tbl, row_id) — see `enqueue` in store.ts.
  `
  ALTER TABLE outbox ADD COLUMN row_id TEXT;
  UPDATE outbox SET row_id = json_extract(row_json, '$.id');
  CREATE INDEX outbox_row_idx ON outbox (tbl, row_id);
  `,
]

export async function migrate(driver: SqlDriver): Promise<void> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version')
  const current = row?.user_version ?? 0
  for (let v = current; v < MIGRATIONS.length; v++) {
    await driver.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[v]!)
      await tx.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}
