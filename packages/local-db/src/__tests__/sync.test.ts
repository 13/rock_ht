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

  describe('delete vs offline edit', () => {
    /** A and B share a synced habit; then A tombstones it and B edits it, both offline. */
    async function diverge(order: 'edit-then-delete' | 'delete-then-edit') {
      const { remote, server } = fakeServer()
      const a = await newStore()
      const b = await newStore()
      const h = await a.createHabit(U, { title: 'v0', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
      await runSync(a.sync, remote)
      await runSync(b.sync, remote)
      if (order === 'edit-then-delete') {
        await b.updateHabit({ id: h.id, title: 'from B' })
        await a.deleteHabit(h.id) // later clock: tombstone is newer
      } else {
        await a.deleteHabit(h.id)
        await b.updateHabit({ id: h.id, title: 'from B' }) // later clock: edit is newer
      }
      const edit = (await b.sync.getRow('habits', h.id))!
      const tombstone = (await a.sync.getRow('habits', h.id))!
      return { remote, server, a, b, id: h.id, edit, tombstone }
    }

    for (const first of ['a', 'b'] as const) {
      it(`tombstone newer: deleted on both (${first.toUpperCase()} syncs first)`, async () => {
        const { remote, server, a, b, id, edit, tombstone } = await diverge('edit-then-delete')
        const [x, y] = first === 'a' ? [a, b] : [b, a]
        await runSync(x.sync, remote)
        await runSync(y.sync, remote)
        await runSync(x.sync, remote)
        for (const s of [a, b]) {
          expect(await s.getHabit(id)).toBeNull()
          expect((await s.sync.getRow('habits', id))!.deleted_at).toBe(tombstone.deleted_at)
        }
        expect(server.get(`habits:${id}`)!.c.row.deleted_at).toBe(tombstone.deleted_at)

        // An echo of B's older live edit (re-pushed or re-pulled) never revives the newer tombstone.
        await remote.push([{ table: 'habits', row: edit }])
        for (const s of [a, b]) {
          await s.sync.applyRemote([{ table: 'habits', row: edit }], await s.sync.getCursor())
          await runSync(s.sync, remote)
          expect(await s.getHabit(id)).toBeNull()
        }
        expect(server.get(`habits:${id}`)!.c.row.deleted_at).toBe(tombstone.deleted_at)
      })

      it(`edit newer: alive with B's edit on both (${first.toUpperCase()} syncs first)`, async () => {
        const { remote, server, a, b, id } = await diverge('delete-then-edit')
        const [x, y] = first === 'a' ? [a, b] : [b, a]
        await runSync(x.sync, remote)
        await runSync(y.sync, remote)
        await runSync(x.sync, remote)
        for (const s of [a, b]) {
          const habit = await s.getHabit(id)
          expect(habit).not.toBeNull()
          expect(habit!.title).toBe('from B')
        }
        expect(server.get(`habits:${id}`)!.c.row.deleted_at).toBeNull()
      })
    }
  })
})
