import { describe, it, expect } from 'vitest'
import { MIGRATIONS, migrate } from '../schema'
import { openTestDriver } from './helpers'

describe('migrate', () => {
  it('creates all tables and is idempotent', async () => {
    const d = openTestDriver()
    await migrate(d)
    await migrate(d)
    const tables = await d.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    expect(tables.map((t) => t.name)).toEqual([
      'habit_completions', 'habits', 'journal_entries', 'meta', 'outbox', 'profiles',
    ])
    const v = await d.first<{ user_version: number }>('PRAGMA user_version')
    expect(v?.user_version).toBe(MIGRATIONS.length)
  })

  it('rolls a failed transaction back, including nested calls', async () => {
    const d = openTestDriver()
    await migrate(d)
    await expect(d.transaction(async (tx) => {
      await tx.run("INSERT INTO meta (key, value) VALUES ('a', '1')")
      await tx.transaction(async (inner) => {
        await inner.run("INSERT INTO meta (key, value) VALUES ('b', '2')")
      })
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await d.all('SELECT * FROM meta')).toEqual([])
  })

  it('backfills outbox.row_id for entries queued before migration 2', async () => {
    const d = openTestDriver()
    await d.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[0]!)
      await tx.exec('PRAGMA user_version = 1')
      await tx.run('INSERT INTO outbox (tbl, row_json) VALUES (?, ?)', ['habits', JSON.stringify({ id: 'h1' })])
    })
    await migrate(d)
    expect(await d.all('SELECT tbl, row_id FROM outbox')).toEqual([{ tbl: 'habits', row_id: 'h1' }])
  })
})
