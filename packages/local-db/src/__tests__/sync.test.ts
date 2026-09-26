import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { runSync, type SyncChange, type SyncRemote } from '@rock_ht/sync'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()
const U = 'local-user'

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

/** Global sequence + LWW upsert, like sync_push_for/sync_pull_for. */
function fakeServer() {
  const seq = { n: 0 }
  const server = new Map<string, { seq: number; c: SyncChange }>()
  const remote: SyncRemote = {
    async push(cs) {
      for (const c of cs) {
        const k = `${c.table}:${c.row.id}`
        const cur = server.get(k)
        if (!cur || cur.c.row.updated_at < c.row.updated_at) server.set(k, { seq: ++seq.n, c })
      }
    },
    async pull(cursor, limit) {
      const all = [...server.values()].filter((r) => r.seq > Number(cursor ?? 0)).sort((a, b) => a.seq - b.seq)
      const page = all.slice(0, limit)
      return { changes: page.map((r) => r.c), cursor: page.at(-1) ? String(page.at(-1)!.seq) : cursor, hasMore: all.length > limit }
    },
  }
  return { remote, server }
}

describe('local store + sync engine', () => {
  it('syncs two stores through a shared fake remote', async () => {
    const { remote } = fakeServer()
    const a = await newStore()
    const b = await newStore()
    const h = await a.createHabit(U, { title: 'Shared', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await a.setCompletion(U, { habit_id: h.id, date: '2026-01-02' }, true)
    await runSync(a.sync, remote)
    await runSync(b.sync, remote)
    expect((await b.listHabits(U))[0]!.title).toBe('Shared')
    expect(await b.listCompletions(U)).toHaveLength(1)
  })

  it('converges two stores that edited the same habit offline, and propagates deletes', async () => {
    const { remote, server } = fakeServer()
    const a = await newStore()
    const b = await newStore()
    const h = await a.createHabit(U, { title: 'v0', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await runSync(a.sync, remote)
    await runSync(b.sync, remote)

    await a.updateHabit({ id: h.id, title: 'from A' })
    await b.updateHabit({ id: h.id, title: 'from B' }) // later clock: wins
    await b.setCompletion(U, { habit_id: h.id, date: '2026-01-03' }, true)
    await runSync(a.sync, remote)
    await runSync(b.sync, remote)
    await runSync(a.sync, remote)

    expect((await a.getHabit(h.id))!.title).toBe('from B')
    expect((await b.getHabit(h.id))!.title).toBe('from B')
    expect(await a.listCompletions(U)).toHaveLength(1)

    await a.setCompletion(U, { habit_id: h.id, date: '2026-01-03' }, false)
    await runSync(a.sync, remote)
    await runSync(b.sync, remote)
    expect(await b.listCompletions(U)).toHaveLength(0)
    expect(await a.sync.readOutbox(10)).toEqual([])
    expect(await b.sync.readOutbox(10)).toEqual([])
    expect(server.size).toBe(2)
  })
})
