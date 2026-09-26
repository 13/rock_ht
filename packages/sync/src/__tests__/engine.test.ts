import { describe, it, expect } from 'vitest'
import { runSync } from '../engine'
import type { OutboxEntry, PullResult, SyncChange, SyncLocal, SyncRemote, SyncRow, SyncTable } from '../types'

function fakeLocal(rows: SyncChange[] = [], outbox: SyncChange[] = []) {
  const data = new Map<string, SyncRow>(rows.map((c) => [`${c.table}:${c.row.id}`, c.row]))
  let entries: OutboxEntry[] = outbox.map((change, i) => ({ seq: i + 1, change }))
  let cursor: string | null = null
  const local: SyncLocal = {
    async readOutbox(limit) { return entries.slice(0, limit) },
    async ackOutbox(upto) { entries = entries.filter((e) => e.seq > upto) },
    async getRow(table: SyncTable, id) { return data.get(`${table}:${id}`) ?? null },
    async getCursor() { return cursor },
    async applyRemote(changes, c) {
      for (const ch of changes) data.set(`${ch.table}:${ch.row.id}`, ch.row)
      cursor = c
    },
  }
  return { local, data, outbox: () => entries, cursor: () => cursor }
}

/** Server with a global sequence and LWW upsert, like sync_push_for/sync_pull_for. */
function fakeRemote() {
  const rows = new Map<string, { seq: number; change: SyncChange }>()
  let seq = 0
  const remote: SyncRemote = {
    async push(changes) {
      for (const c of changes) {
        const key = `${c.table}:${c.row.id}`
        const cur = rows.get(key)
        if (!cur || cur.change.row.updated_at < c.row.updated_at) rows.set(key, { seq: ++seq, change: c })
      }
    },
    async pull(cursor, limit): Promise<PullResult> {
      const after = cursor ? Number(cursor) : 0
      const all = [...rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq)
      const page = all.slice(0, limit)
      return {
        changes: page.map((r) => r.change),
        cursor: page.length ? String(page[page.length - 1]!.seq) : cursor,
        hasMore: all.length > limit,
      }
    },
  }
  return { remote, rows }
}

const habit = (id: string, updated_at: string, title = 'x'): SyncChange => ({
  table: 'habits',
  row: { id, updated_at, deleted_at: null, title },
})

describe('runSync', () => {
  it('pushes the outbox and clears it', async () => {
    const l = fakeLocal([], [habit('h1', '2026-01-01T00:00:00.000Z')])
    const r = fakeRemote()
    const report = await runSync(l.local, r.remote)
    expect(report.pushed).toBe(1)
    expect(l.outbox()).toHaveLength(0)
    expect(r.rows.has('habits:h1')).toBe(true)
  })

  it('pulls remote rows and advances the cursor', async () => {
    const r = fakeRemote()
    await r.remote.push([habit('h2', '2026-01-01T00:00:00.000Z', 'remote')])
    const l = fakeLocal()
    const report = await runSync(l.local, r.remote)
    expect(report.pulled).toBe(1)
    expect(l.data.get('habits:h2')?.title).toBe('remote')
    expect(l.cursor()).toBe('1')
  })

  it('does not overwrite a newer local row with an older remote row', async () => {
    const r = fakeRemote()
    await r.remote.push([habit('h3', '2026-01-01T00:00:00.000Z', 'old')])
    const l = fakeLocal([habit('h3', '2026-02-01T00:00:00.000Z', 'new')])
    await runSync(l.local, r.remote)
    expect(l.data.get('habits:h3')?.title).toBe('new')
  })

  it('pages through more rows than the batch size', async () => {
    const r = fakeRemote()
    await r.remote.push(Array.from({ length: 5 }, (_, i) => habit(`p${i}`, '2026-01-01T00:00:00.000Z')))
    const l = fakeLocal()
    const report = await runSync(l.local, r.remote, { batchSize: 2 })
    expect(report.pulled).toBe(5)
    expect(l.cursor()).toBe('5')
  })

  it('pushes an outbox larger than the batch size in several batches', async () => {
    const out = Array.from({ length: 5 }, (_, i) => habit(`o${i}`, '2026-01-01T00:00:00.000Z'))
    const l = fakeLocal([], out)
    const r = fakeRemote()
    const report = await runSync(l.local, r.remote, { batchSize: 2 })
    expect(report.pushed).toBe(5)
    expect(l.outbox()).toHaveLength(0)
    expect(r.rows.size).toBe(5)
  })

  it('keeps the outbox when a push fails, so the next run retries it', async () => {
    const l = fakeLocal([], [habit('h5', '2026-01-01T00:00:00.000Z')])
    const r = fakeRemote()
    const failing: SyncRemote = { ...r.remote, push: async () => { throw new Error('offline') } }
    await expect(runSync(l.local, failing)).rejects.toThrow('offline')
    expect(l.outbox()).toHaveLength(1)
    await runSync(l.local, r.remote)
    expect(l.outbox()).toHaveLength(0)
  })

  it('converges two devices editing the same row offline (last write wins)', async () => {
    const r = fakeRemote()
    const a = fakeLocal([], [habit('h4', '2026-01-01T10:00:00.000Z', 'from A')])
    const b = fakeLocal([], [habit('h4', '2026-01-01T11:00:00.000Z', 'from B')])
    await runSync(a.local, r.remote)
    await runSync(b.local, r.remote)
    await runSync(a.local, r.remote)
    expect(a.data.get('habits:h4')?.title).toBe('from B')
    expect(r.rows.get('habits:h4')?.change.row.title).toBe('from B')
  })
})
