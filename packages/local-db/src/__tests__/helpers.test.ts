import { describe, it, expect } from 'vitest'
import { migrate } from '../schema'
import { openTestDriver } from './helpers'

// The test driver must behave like apps/mobile/lib/sqlite-driver.ts: bare statements share the
// transaction queue, so misuse that deadlocks on device fails loudly in tests instead.
describe('openTestDriver', () => {
  it('rejects a bare statement on the outer driver issued inside a transaction', async () => {
    const d = openTestDriver()
    await migrate(d)
    await expect(d.transaction(async () => {
      await d.run("INSERT INTO meta (key, value) VALUES ('a', '1')")
    })).rejects.toThrow(/outer driver/)
    expect(await d.all('SELECT * FROM meta')).toEqual([])
  })

  it('runs a concurrent caller\'s bare statement after an open transaction, not inside it', async () => {
    const d = openTestDriver()
    await migrate(d)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let opened!: () => void
    const isOpen = new Promise<void>((r) => { opened = r })
    const tx = d.transaction(async (t) => {
      await t.run("INSERT INTO meta (key, value) VALUES ('tx', '1')")
      opened()
      await gate
      throw new Error('rollback')
    })
    await isOpen
    // Issued by an unrelated caller while the transaction is open: must wait for it, so the
    // rollback can't take this write with it.
    const bare = d.run("INSERT INTO meta (key, value) VALUES ('bare', '1')")
    await new Promise((r) => setTimeout(r, 0))
    release()
    await expect(tx).rejects.toThrow('rollback')
    await bare
    expect(await d.all('SELECT key FROM meta')).toEqual([{ key: 'bare' }])
  })
})
