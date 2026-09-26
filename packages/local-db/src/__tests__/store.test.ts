import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { completionId, isNewer, type SyncChange, type SyncRow } from '@rock_ht/sync'
import { addDaysToDate, today } from '@rock_ht/utils'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import type { SqlDriver } from '../driver'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()
const U = 'local-user'

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

describe('LocalStore', () => {
  let s: LocalStore
  beforeEach(async () => { s = await newStore() })

  it('creates and lists habits with parsed frequency', async () => {
    await s.createHabit(U, { title: 'Read', icon: '📚', color: '#6366f1', frequency: { type: 'daily' } })
    const list = await s.listHabits(U)
    expect(list).toHaveLength(1)
    expect(list[0]!.frequency).toEqual({ type: 'daily' })
  })

  it('writes an outbox entry per mutated row', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    const out = await s.sync.readOutbox(10)
    expect(out.map((e) => e.change.table)).toEqual(['habits', 'habit_completions'])
  })

  it('toggles completions with deterministic ids and tombstones', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    expect((await s.listCompletions(U))[0]!.id).toBe(completionId(h.id, '2026-01-05'))
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, false)
    expect(await s.listCompletions(U)).toHaveLength(0)
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    expect(await s.listCompletions(U)).toHaveLength(1)
  })

  it('soft-deletes habits', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.deleteHabit(h.id)
    expect(await s.listHabits(U, { includeArchived: true })).toHaveLength(0)
    const last = (await s.sync.readOutbox(10)).at(-1)!
    expect(last.change.row.deleted_at).not.toBeNull()
  })

  it('applyRemote writes rows without outbox entries and stores cursor', async () => {
    const change: SyncChange = {
      table: 'journal_entries',
      row: { id: 'j1', user_id: U, habit_id: null, entry_date: '2026-01-01', content: 'hi', mood: 3,
             created_at: now(), updated_at: now(), deleted_at: null },
    }
    await s.sync.applyRemote([change], '42')
    expect(await s.sync.readOutbox(10)).toHaveLength(0)
    expect(await s.sync.getCursor()).toBe('42')
    expect((await s.listJournal(U))[0]!.content).toBe('hi')
  })

  it('resetCursor clears a stored pull cursor (e.g. on disconnect, before a switch to a different backend)', async () => {
    await s.sync.applyRemote([], '42')
    expect(await s.sync.getCursor()).toBe('42')
    await s.sync.resetCursor()
    expect(await s.sync.getCursor()).toBeNull()
  })

  it('claim on sign-up pushes the local profile and re-queues every row', async () => {
    await s.ensureProfile(U)
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    await s.createJournal(U, { content: 'hi' })
    await s.sync.applyRemote([], '7')
    const before = (await s.sync.readOutbox(100)).length

    await s.claim('account-1', { pushLocalProfile: true })

    expect(await s.listHabits('account-1')).toHaveLength(1)
    expect(await s.getProfile('account-1')).not.toBeNull()
    expect((await s.listCompletions('account-1'))[0]!.user_id).toBe('account-1')
    expect((await s.listJournal('account-1'))[0]!.user_id).toBe('account-1')
    const out = await s.sync.readOutbox(100)
    expect(out.length).toBeGreaterThan(before)
    expect(out.some((e) => e.change.table === 'profiles')).toBe(true)
    expect(await s.sync.getCursor()).toBeNull()
  })

  it('claim on sign-in keeps the server profile: rewrites it locally without queuing or bumping it', async () => {
    const original = await s.ensureProfile(U)
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    await s.createJournal(U, { content: 'hi' })
    await s.sync.applyRemote([], '7')

    await s.claim('account-1', { pushLocalProfile: false })

    const profile = await s.getProfile('account-1')
    expect(profile).not.toBeNull()
    // Floored to the epoch (not left at `original.updated_at`) so a genuinely older but real
    // server profile still satisfies isNewer() on the next pull instead of losing to the placeholder.
    expect(profile!.updated_at).toBe('1970-01-01T00:00:00.000Z')
    expect((await s.listCompletions('account-1'))[0]!.user_id).toBe('account-1')
    expect((await s.listJournal('account-1'))[0]!.user_id).toBe('account-1')
    const out = await s.sync.readOutbox(100)
    expect(out.some((e) => e.change.table === 'profiles')).toBe(false)
    expect(out.some((e) => e.change.table === 'habits')).toBe(true)
    expect(await s.sync.getCursor()).toBeNull()
  })

  it('claim on sign-in floors the local profile so an older-but-real server profile still wins the next pull', async () => {
    const original = await s.ensureProfile(U)
    await s.claim('account-1', { pushLocalProfile: false })

    // A server profile last edited before this device's very first launch: older than the
    // placeholder's original timestamp, but still newer than the epoch floor.
    const serverUpdatedAt = new Date(new Date(original.updated_at).getTime() - 1000).toISOString()
    const serverRow: SyncRow = {
      ...(await s.sync.getRow('profiles', 'account-1'))!,
      email: 'real@example.com', theme: 'forest', updated_at: serverUpdatedAt,
    }

    expect(isNewer(serverRow, await s.sync.getRow('profiles', 'account-1'))).toBe(true)

    await s.sync.applyRemote([{ table: 'profiles', row: serverRow }], null)
    const profile = await s.getProfile('account-1')
    expect(profile!.email).toBe('real@example.com')
    expect(profile!.theme).toBe('forest')
  })

  it('claim succeeds when a stale local profile row already holds the target id', async () => {
    // e.g. left over from a previous sign-in to account-1, later disconnected.
    await s.ensureProfile('account-1')
    await s.ensureProfile(U)
    await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })

    await (await s.claim('account-1', { pushLocalProfile: true })).completed

    expect(await s.listHabits('account-1')).toHaveLength(1)
    expect(await s.getProfile('account-1')).not.toBeNull()
  })

  it('updateProfile ignores undefined fields instead of nulling them', async () => {
    const original = await s.ensureProfile(U)
    const updated = await s.updateProfile(U, { theme: undefined, display_name: 'X' })
    expect(updated.display_name).toBe('X')
    expect(updated.theme).toBe(original.theme)
    expect(await s.getProfile(U)).toMatchObject({ display_name: 'X', theme: original.theme })
  })

  it('does not lose a completion toggle to a read-before-write race', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await Promise.all([
      s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true),
      s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, false),
    ])
    expect(await s.listCompletions(U)).toHaveLength(0)
  })

  it('toggleCompletion resolves two concurrent toggles to not-completed', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const [first, second] = await Promise.all([
      s.toggleCompletion(U, { habit_id: h.id, date: '2026-01-05' }),
      s.toggleCompletion(U, { habit_id: h.id, date: '2026-01-05' }),
    ])
    // Serialized inside the store: not-done -> done -> not-done, regardless of call order.
    expect([first, second]).toEqual([true, false])
    expect(await s.listCompletions(U)).toHaveLength(0)
  })

  it('toggleCompletion revives a tombstoned completion', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, false)
    expect(await s.listCompletions(U)).toHaveLength(0)

    const done = await s.toggleCompletion(U, { habit_id: h.id, date: '2026-01-05' })

    expect(done).toBe(true)
    expect(await s.listCompletions(U)).toHaveLength(1)
  })

  it('excludes completions of a deleted habit from listCompletions', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    expect(await s.listCompletions(U)).toHaveLength(1)

    await s.deleteHabit(h.id)

    expect(await s.listCompletions(U)).toHaveLength(0)
  })

  it('dates journal entries with the local calendar date by default', async () => {
    const j = await s.createJournal(U, { content: 'hi' })
    expect(j.entry_date).toBe(today())
  })

  it('stores the device timezone on new profiles', async () => {
    const p = await s.ensureProfile(U)
    expect(p.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('ackOutbox deletes entries up to and including the given seq', async () => {
    for (const title of ['A', 'B', 'C']) {
      await s.createHabit(U, { title, icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    }
    const out = await s.sync.readOutbox(10)
    await s.sync.ackOutbox(out[1]!.seq)
    expect((await s.sync.readOutbox(10)).map((e) => e.change.row.title)).toEqual(['C'])
  })

  it('updateJournal changes only the given fields, bumps updated_at and queues the row', async () => {
    const j = await s.createJournal(U, { content: 'hi', mood: 2, entry_date: '2026-01-02' })
    const updated = await s.updateJournal({ id: j.id, content: 'edited' })
    expect(updated).toMatchObject({ content: 'edited', mood: 2, entry_date: '2026-01-02' })
    expect(updated.updated_at > j.updated_at).toBe(true)
    expect((await s.listJournal(U))[0]!.content).toBe('edited')
    const last = (await s.sync.readOutbox(10)).at(-1)!
    expect(last.change.row).toMatchObject({ id: j.id, content: 'edited' })
    await expect(s.updateJournal({ id: 'missing', content: 'x' })).rejects.toThrow('not found')
  })

  it('deleteJournal tombstones the entry and queues the tombstone', async () => {
    const j = await s.createJournal(U, { content: 'hi' })
    await s.deleteJournal(j.id)
    expect(await s.listJournal(U)).toEqual([])
    const row = await s.sync.getRow('journal_entries', j.id)
    expect(row!.deleted_at).not.toBeNull()
    expect(row!.updated_at).toBe(row!.deleted_at)
    expect((await s.sync.readOutbox(10)).at(-1)!.change.row.deleted_at).toBe(row!.deleted_at)
    await expect(s.updateJournal({ id: j.id, content: 'x' })).rejects.toThrow('not found')
  })

  it('setCompletionNote sets and clears the note of a live completion only', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    await s.setCompletionNote(h.id, '2026-01-05', 'felt good')
    expect((await s.listCompletions(U))[0]!.note).toBe('felt good')
    await s.setCompletionNote(h.id, '2026-01-05', '')
    expect((await s.listCompletions(U))[0]!.note).toBeNull()

    // No completion (or a tombstoned one): a no-op that queues nothing.
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-07' }, true)
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-07' }, false)
    const before = await s.sync.readOutbox(100)
    await s.setCompletionNote(h.id, '2026-01-06', 'ghost')
    await s.setCompletionNote(h.id, '2026-01-07', 'ghost')
    expect(await s.sync.getRow('habit_completions', completionId(h.id, '2026-01-06'))).toBeNull()
    expect((await s.sync.getRow('habit_completions', completionId(h.id, '2026-01-07')))!.note).toBeNull()
    expect(await s.sync.readOutbox(100)).toEqual(before)
  })

  it('listCompletions filters by habit and inclusive date range', async () => {
    const a = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const b = await s.createHabit(U, { title: 'B', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      await s.setCompletion(U, { habit_id: a.id, date: d }, true)
      await s.setCompletion(U, { habit_id: b.id, date: d }, true)
    }
    await s.setCompletion('other-user', { habit_id: a.id, date: '2026-01-04' }, true)

    const dates = (rows: { completed_date: string }[]) => rows.map((r) => r.completed_date)
    expect(await s.listCompletions(U)).toHaveLength(6)
    expect(await s.listCompletions('other-user')).toHaveLength(1)
    expect(dates(await s.listCompletions(U, { habitId: a.id }))).toEqual(['2026-01-03', '2026-01-02', '2026-01-01'])
    expect(dates(await s.listCompletions(U, { habitId: a.id, startDate: '2026-01-02' }))).toEqual(['2026-01-03', '2026-01-02'])
    expect(dates(await s.listCompletions(U, { habitId: b.id, endDate: '2026-01-02' }))).toEqual(['2026-01-02', '2026-01-01'])
    expect(dates(await s.listCompletions(U, { startDate: '2026-01-02', endDate: '2026-01-02' })))
      .toEqual(['2026-01-02', '2026-01-02'])
  })
})

describe('LocalStore outbox compaction', () => {
  let s: LocalStore
  beforeEach(async () => { s = await newStore() })

  it('keeps one outbox entry with the latest row after N edits of one habit', async () => {
    const h = await s.createHabit(U, { title: 'v0', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    for (let i = 1; i <= 5; i++) await s.updateHabit({ id: h.id, title: `v${i}` })
    const out = await s.sync.readOutbox(100)
    expect(out).toHaveLength(1)
    expect(out[0]!.change.row.title).toBe('v5')
    expect(out[0]!.change.row).toEqual(await s.sync.getRow('habits', h.id))
  })

  it('keeps a compacted parent ahead of the children queued after it', async () => {
    // The server drops a completion whose habit it doesn't have yet, so a later edit of the habit
    // must not move the habit's entry behind its completion.
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    await s.updateHabit({ id: h.id, title: 'B' })
    const out = await s.sync.readOutbox(100)
    expect(out.map((e) => [e.change.table, e.change.row.title])).toEqual([
      ['habits', 'B'], ['habit_completions', undefined],
    ])
  })

  it('never rewrites an entry that a push has already read, so its ack cannot drop a newer edit', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const inFlight = await s.sync.readOutbox(100)
    await s.updateHabit({ id: h.id, title: 'B' })
    await s.updateHabit({ id: h.id, title: 'C' })
    await s.sync.ackOutbox(inFlight.at(-1)!.seq)
    const out = await s.sync.readOutbox(100)
    expect(out.map((e) => e.change.row.title)).toEqual(['C'])
  })
})

describe('LocalStore sync.applyRemote', () => {
  let s: LocalStore
  beforeEach(async () => { s = await newStore() })

  it('compares against the local row inside its own transaction and keeps a newer local row', async () => {
    const h = await s.createHabit(U, { title: 'local', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const older: SyncRow = { ...(await s.sync.getRow('habits', h.id))!, title: 'remote', updated_at: '2025-01-01T00:00:00.000Z' }
    await s.sync.applyRemote([{ table: 'habits', row: older }], '9')
    expect((await s.getHabit(h.id))!.title).toBe('local')
    expect(await s.sync.getCursor()).toBe('9')
  })

  it('does not let a pre-read override a local write that lands before the apply', async () => {
    const h = await s.createHabit(U, { title: 'v1', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    const base = (await s.sync.getRow('habits', h.id))!
    // Newer than what an engine read before applying, older than the local edit that lands in between.
    const remote: SyncRow = {
      ...base, title: 'remote', updated_at: new Date(new Date(base.updated_at).getTime() + 500).toISOString(),
    }
    await Promise.all([
      s.updateHabit({ id: h.id, title: 'local edit' }),
      s.sync.applyRemote([{ table: 'habits', row: remote }], '1'),
    ])
    expect((await s.getHabit(h.id))!.title).toBe('local edit')
  })

  it('applies more rows than one chunk across several transactions and stores the cursor', async () => {
    const { store, transactions } = await countingStore()
    const changes: SyncChange[] = Array.from({ length: 450 }, (_, i) => ({
      table: 'habits',
      row: habitRow(`h${i}`, '2026-01-01T00:00:00.000Z'),
    }))
    const before = transactions()
    await store.sync.applyRemote(changes, '450')
    expect(transactions() - before).toBe(3)
    expect(await store.listHabits(U)).toHaveLength(450)
    expect(await store.sync.getCursor()).toBe('450')
  })

  it('keeps the old cursor when a later chunk fails, so the page is pulled again', async () => {
    const { store } = await countingStore()
    await store.sync.applyRemote([], 'old')
    const changes: SyncChange[] = Array.from({ length: 450 }, (_, i) => ({
      table: 'habits',
      row: habitRow(`h${i}`, '2026-01-01T00:00:00.000Z', i === 449 ? null : 'x'),
    }))
    await expect(store.sync.applyRemote(changes, 'new')).rejects.toThrow()
    expect(await store.sync.getCursor()).toBe('old')
    // Earlier chunks stay committed; re-applying the page later is idempotent.
    expect(await store.listHabits(U)).toHaveLength(400)
  })
})

describe('LocalStore claim', () => {
  it('keeps every re-queued row\'s original updated_at and bumps only the profile on sign-up', async () => {
    const s = await newStore()
    await s.ensureProfile(U)
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    const j = await s.createJournal(U, { content: 'hi' })
    const stamps = async (user: string) => ({
      habit: (await s.getHabit(h.id))!.updated_at,
      completion: (await s.listCompletions(user)).length === 1
        ? (await s.sync.getRow('habit_completions', completionId(h.id, '2026-01-05')))!.updated_at
        : 'missing',
      journal: (await s.listJournal(user)).find((e) => e.id === j.id)!.updated_at,
    })
    const before = await stamps(U)
    const profileBefore = (await s.getProfile(U))!.updated_at

    await s.claim('account-1', { pushLocalProfile: true })

    expect(await stamps('account-1')).toEqual(before)
    const out = await s.sync.readOutbox(100)
    const byTable = Object.fromEntries(out.map((e) => [e.change.table, e.change.row.updated_at]))
    expect(byTable).toMatchObject({
      habits: before.habit, habit_completions: before.completion, journal_entries: before.journal,
    })
    expect((await s.getProfile('account-1'))!.updated_at > profileBefore).toBe(true)
  })

  it('re-queues more rows than one chunk, parents first', async () => {
    const { store } = await countingStore()
    await store.ensureProfile(U)
    const h = await store.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await store.sync.applyRemote(completionRows(h.id, 450), null)
    await store.claim('account-1', { pushLocalProfile: true })
    const out = await store.sync.readOutbox(1000)
    expect(out).toHaveLength(452)
    expect(out.slice(0, 2).map((e) => e.change.table)).toEqual(['profiles', 'habits'])
    expect(new Set(out.map((e) => e.change.row.id)).size).toBe(452)
    expect(out.filter((e) => e.change.table !== 'profiles').every((e) => e.change.row.user_id === 'account-1')).toBe(true)
  })

  it('finishes an interrupted chunked claim before the next push reads the outbox', async () => {
    const { store, failTransaction, transactions } = await countingStore()
    await store.ensureProfile(U)
    const h = await store.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await store.sync.applyRemote(completionRows(h.id, 450), null)
    // Let the first transaction (rewrite + profile/habits) and one completion chunk commit, then crash.
    failTransaction(transactions() + 3)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { completed } = await store.claim('account-1', { pushLocalProfile: true })
      await expect(completed).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    const out = await store.sync.readOutbox(1000)
    expect(out).toHaveLength(452)
    expect(new Set(out.map((e) => e.change.row.id)).size).toBe(452)
  })

  it('switches identity and ownership atomically: a failed re-queue chunk still leaves the device on the account', async () => {
    const { store, failTransaction, transactions } = await countingStore()
    await store.ensureProfile(U)
    const h = await store.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await store.createJournal(U, { content: 'hi' })
    await store.sync.applyRemote(completionRows(h.id, 450), null)
    // The first transaction commits; the very first re-queue chunk fails.
    failTransaction(transactions() + 2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { completed } = await store.claim('account-1', { pushLocalProfile: true })
      expect(await store.getMeta('account_user_id')).toBe('account-1')
      await completed
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('claim'), expect.any(Error))
    } finally {
      warn.mockRestore()
    }
    expect(await store.listHabits('account-1')).toHaveLength(1)
    expect(await store.listHabits(U)).toHaveLength(0)
    expect(await store.listCompletions('account-1')).toHaveLength(450)
    expect(await store.listJournal('account-1')).toHaveLength(1)
    expect(await store.getProfile('account-1')).not.toBeNull()
    expect(await store.getProfile(U)).toBeNull()
    // The next push resumes the re-queue before reading.
    const out = await store.sync.readOutbox(1000)
    expect(out).toHaveLength(453)
    expect(new Set(out.map((e) => e.change.row.id)).size).toBe(453)
  })

  it('claim to the account that already owns every row only sets account_user_id', async () => {
    const s = await newStore()
    // e.g. signed in to account-1 earlier, disconnected (rows stay under account-1), signing in again.
    await s.ensureProfile('account-1')
    await s.updateProfile('account-1', { display_name: 'Ada' })
    const h = await s.createHabit('account-1', { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion('account-1', { habit_id: h.id, date: '2026-01-05' }, true)
    await s.sync.applyRemote([], '9')
    const outBefore = (await s.sync.readOutbox(100)).map((e) => e.seq)
    const profileBefore = await s.getProfile('account-1')

    await (await s.claim('account-1', { pushLocalProfile: false })).completed

    expect(await s.getMeta('account_user_id')).toBe('account-1')
    expect(await s.getProfile('account-1')).toEqual(profileBefore)
    expect(await s.sync.getCursor()).toBe('9')
    expect((await s.sync.readOutbox(100)).map((e) => e.seq)).toEqual(outBefore)
    expect(await s.listHabits('account-1')).toHaveLength(1)
    expect(await s.listCompletions('account-1')).toHaveLength(1)
  })

  it('claim still rewrites when a single row (even a tombstone) belongs to someone else', async () => {
    const s = await newStore()
    await s.ensureProfile('account-1')
    const j = await s.createJournal(U, { content: 'offline' })
    await s.deleteJournal(j.id)

    await (await s.claim('account-1', { pushLocalProfile: false })).completed

    expect((await s.sync.getRow('journal_entries', j.id))!.user_id).toBe('account-1')
  })

  it('leaves identity and rows untouched when the first transaction fails', async () => {
    const { store, failTransaction, transactions } = await countingStore()
    await store.ensureProfile(U)
    await store.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    failTransaction(transactions() + 1)
    await expect(store.claim('account-1', { pushLocalProfile: true })).rejects.toThrow('crash')
    expect(await store.getMeta('account_user_id')).toBeNull()
    expect(await store.listHabits(U)).toHaveLength(1)
  })

  it('previousAccounts is empty for a never-claimed device and lists every account after claims', async () => {
    const s = await newStore()
    expect(await s.previousAccounts()).toEqual([])
    await s.ensureProfile(U)
    await s.claim('account-1', { pushLocalProfile: true })
    expect(await s.previousAccounts()).toEqual(['account-1'])
    await s.setMeta('local_user_id', 'account-1')
    await s.setMeta('account_user_id', null)
    await s.claim('account-2', { pushLocalProfile: true })
    expect(await s.previousAccounts()).toEqual(['account-1', 'account-2'])
  })
})

/** Everything in a table, tombstones included, straight from the store's own reader. */
async function allRows(s: LocalStore, table: 'habits' | 'habit_completions' | 'journal_entries', ids: string[]) {
  return (await Promise.all(ids.map((id) => s.sync.getRow(table, id)))).filter((r) => r !== null)
}

/**
 * A device that signed up as account A, pushed everything, and was disconnected (rows stay under A,
 * `local_user_id` = A, `account_user_id` = null), the state Task 13's end-to-end run found.
 */
async function syncedThenDisconnected(s: LocalStore, account = 'account-A') {
  await s.ensureProfile(U)
  const h1 = await s.createHabit(U, { title: 'Run', icon: '🏃', color: '#f00', frequency: { type: 'daily' } })
  const h2 = await s.createHabit(U, { title: 'Gone', icon: '✨', color: '#0f0', frequency: { type: 'daily' } })
  await s.setCompletion(U, { habit_id: h1.id, date: '2026-01-05' }, true)
  await s.setCompletion(U, { habit_id: h1.id, date: '2026-01-06' }, true)
  await s.setCompletion(U, { habit_id: h1.id, date: '2026-01-07' }, true)
  await s.setCompletion(U, { habit_id: h1.id, date: '2026-01-07' }, false) // tombstone
  await s.setCompletion(U, { habit_id: h2.id, date: '2026-01-05' }, true)
  const j1 = await s.createJournal(U, { content: 'linked', habit_id: h1.id })
  const j2 = await s.createJournal(U, { content: 'deleted' })
  await s.deleteJournal(j2.id)
  const j3 = await s.createJournal(U, { content: 'about a deleted habit', habit_id: h2.id })
  await s.deleteHabit(h2.id)
  await (await s.claim(account, { pushLocalProfile: true })).completed
  // A sync run: everything pushed and acked, then a pull stored a cursor.
  const out = await s.sync.readOutbox(1000)
  await s.sync.ackOutbox(out.at(-1)!.seq)
  await s.sync.applyRemote([], '5')
  // disconnectSync (apps/mobile/lib/sync/account.ts).
  await s.setMeta('local_user_id', account)
  await s.setMeta('account_user_id', null)
  return { h1, h2, j1, j2, j3 }
}

describe('LocalStore claim to a different account (copy into the new account)', () => {
  it('re-keys every row when the rows were already synced under another account', async () => {
    const s = await newStore()
    const { h1, h2, j1, j2, j3 } = await syncedThenDisconnected(s)
    const oldCompletionIds = ['2026-01-05', '2026-01-06', '2026-01-07'].map((d) => completionId(h1.id, d))
      .concat(completionId(h2.id, '2026-01-05'))

    await (await s.claim('account-B', { pushLocalProfile: true })).completed

    // No row keeps an id the server already has under account A.
    expect(await allRows(s, 'habits', [h1.id, h2.id])).toEqual([])
    expect(await allRows(s, 'habit_completions', oldCompletionIds)).toEqual([])
    expect(await allRows(s, 'journal_entries', [j1.id, j2.id, j3.id])).toEqual([])

    const habits = await s.listHabits('account-B', { includeArchived: true })
    expect(habits.map((h) => h.title)).toEqual(['Run'])
    const run = habits[0]!
    expect(run.id).not.toBe(h1.id)
    expect(run).toMatchObject({ icon: '🏃', color: '#f00', created_at: h1.created_at, updated_at: h1.updated_at })

    const completions = await s.listCompletions('account-B')
    expect(completions.map((c) => c.completed_date).sort()).toEqual(['2026-01-05', '2026-01-06'])
    for (const c of completions) {
      expect(c.habit_id).toBe(run.id)
      expect(c.id).toBe(completionId(run.id, c.completed_date))
    }

    const journal = await s.listJournal('account-B')
    expect(journal.map((e) => e.content).sort()).toEqual(['about a deleted habit', 'linked'])
    expect(journal.find((e) => e.content === 'linked')!.habit_id).toBe(run.id)
    // Its habit was a tombstone and is dropped, so the link goes (the server would null it too).
    expect(journal.find((e) => e.content === 'about a deleted habit')!.habit_id).toBeNull()
    for (const e of journal) expect([j1.id, j3.id]).not.toContain(e.id)

    // The outbox holds exactly the live rows, all as B's, parents first.
    const out = await s.sync.readOutbox(1000)
    expect(out.map((e) => e.change.table)).toEqual(
      ['profiles', 'habits', 'habit_completions', 'habit_completions', 'journal_entries', 'journal_entries'])
    expect(out[0]!.change.row.id).toBe('account-B')
    expect(out.slice(1).every((e) => e.change.row.user_id === 'account-B')).toBe(true)
    expect(out.every((e) => e.change.row.deleted_at === null)).toBe(true)
    expect(await s.getMeta('account_user_id')).toBe('account-B')
    expect(await s.sync.getCursor()).toBeNull()
  })

  it('re-keys on sign-in to an existing account too (the local profile is still not queued)', async () => {
    const s = await newStore()
    const { h1 } = await syncedThenDisconnected(s)
    await (await s.claim('account-B', { pushLocalProfile: false })).completed
    const habits = await s.listHabits('account-B')
    expect(habits).toHaveLength(1)
    expect(habits[0]!.id).not.toBe(h1.id)
    const out = await s.sync.readOutbox(1000)
    expect(out.some((e) => e.change.table === 'profiles')).toBe(false)
    expect(out.map((e) => e.change.row.id)).toContain(habits[0]!.id)
  })

  it('does not re-key the first claim of purely local (never synced) data', async () => {
    const s = await newStore()
    await s.ensureProfile(U)
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.setCompletion(U, { habit_id: h.id, date: '2026-01-05' }, true)
    const j = await s.createJournal(U, { content: 'hi', habit_id: h.id })

    await (await s.claim('account-A', { pushLocalProfile: true })).completed

    expect((await s.listHabits('account-A')).map((x) => x.id)).toEqual([h.id])
    expect((await s.listCompletions('account-A')).map((c) => c.id)).toEqual([completionId(h.id, '2026-01-05')])
    expect((await s.listJournal('account-A')).map((e) => e.id)).toEqual([j.id])
  })

  it('does not re-key when reconnecting to the same account', async () => {
    const s = await newStore()
    const { h1 } = await syncedThenDisconnected(s)
    await (await s.claim('account-A', { pushLocalProfile: false })).completed
    expect((await s.listHabits('account-A')).map((h) => h.id)).toEqual([h1.id])
    expect(await s.sync.readOutbox(1000)).toEqual([])
    expect(await s.sync.getCursor()).toBe('5')
  })

  it('re-keys again on a later switch back (B -> A copies B\'s rows into A as new rows)', async () => {
    const s = await newStore()
    const { h1 } = await syncedThenDisconnected(s)
    await (await s.claim('account-B', { pushLocalProfile: true })).completed
    const inB = (await s.listHabits('account-B'))[0]!.id
    await s.setMeta('local_user_id', 'account-B')
    await s.setMeta('account_user_id', null)
    await (await s.claim('account-A', { pushLocalProfile: false })).completed
    const inA = (await s.listHabits('account-A'))[0]!.id
    expect(new Set([h1.id, inB, inA]).size).toBe(3)
  })

  it('treats a device synced by a build older than this check (cursor set, no account list) as synced', async () => {
    const s = await newStore()
    // Rows under account-old, pulled once (cursor stored), and no record of claimed accounts.
    await s.ensureProfile('account-old')
    const h = await s.createHabit('account-old', { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.sync.applyRemote([], '3')
    await (await s.claim('account-B', { pushLocalProfile: true })).completed
    const habits = await s.listHabits('account-B')
    expect(habits).toHaveLength(1)
    expect(habits[0]!.id).not.toBe(h.id)
  })

  it('treats a corrupt claimed_accounts as the legacy case (falls back to row owners, still re-keys)', async () => {
    const s = await newStore()
    const { h1 } = await syncedThenDisconnected(s)
    await s.setMeta('claimed_accounts', 'not valid json{')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await (await s.claim('account-B', { pushLocalProfile: true })).completed
    } finally {
      warn.mockRestore()
    }
    const habits = await s.listHabits('account-B')
    expect(habits).toHaveLength(1)
    expect(habits[0]!.id).not.toBe(h1.id)
  })

  it('re-keys every completion before the claim resolves, so an interrupted re-queue resumes with new ids', async () => {
    const { store, failTransaction, transactions } = await countingStore()
    const { h1 } = await syncedThenDisconnected(store)
    await store.sync.applyRemote(completionRows(h1.id, 450).map((c) => ({
      ...c, row: { ...c.row, user_id: 'account-A', updated_at: '2026-06-01T00:00:00.000Z' },
    })), '6')
    // First transaction (identity, ownership, re-key, heads) commits; the first re-queue chunk fails.
    failTransaction(transactions() + 2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await (await store.claim('account-B', { pushLocalProfile: true })).completed
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    const run = (await store.listHabits('account-B'))[0]!
    const completions = await store.listCompletions('account-B')
    expect(completions).toHaveLength(452)
    expect(completions.every((c) => c.habit_id === run.id && c.id === completionId(run.id, c.completed_date))).toBe(true)
    const out = await store.sync.readOutbox(1000)
    // profile + habit + 452 completions + 2 journal entries
    expect(out).toHaveLength(456)
    expect(new Set(out.map((e) => e.change.row.id)).size).toBe(456)
    expect(out.filter((e) => e.change.table === 'habit_completions').every((e) => e.change.row.habit_id === run.id)).toBe(true)
  })

  it('leaves ids, identity and rows untouched when the re-keying first transaction fails', async () => {
    const { store, failTransaction, transactions } = await countingStore()
    const { h1 } = await syncedThenDisconnected(store)
    failTransaction(transactions() + 1)
    await expect(store.claim('account-B', { pushLocalProfile: true })).rejects.toThrow('crash')
    expect(await store.getMeta('account_user_id')).toBeNull()
    expect((await store.listHabits('account-A')).map((h) => h.id)).toEqual([h1.id])
    // A retry still re-keys (the account list wasn't lost with the failed transaction).
    await (await store.claim('account-B', { pushLocalProfile: true })).completed
    expect((await store.listHabits('account-B'))[0]!.id).not.toBe(h1.id)
  })
})

function habitRow(id: string, updated_at: string, title: string | null = 'x'): SyncRow {
  return {
    id, user_id: U, title, description: null, icon: '✨', color: '#fff', frequency: { type: 'daily' },
    target_value: 1, target_unit: null, reminder_time: null, reminder_enabled: false, is_archived: false,
    sort_order: 0, created_at: updated_at, updated_at, deleted_at: null,
  }
}

/** n completions on consecutive days from 2020-01-01 (plain calendar strings, the same in every TZ). */
function completionRows(habitId: string, n: number): SyncChange[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDaysToDate('2020-01-01', i)
    return {
      table: 'habit_completions' as const,
      row: {
        id: completionId(habitId, date), habit_id: habitId, user_id: U, completed_date: date, value: 1,
        note: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
      },
    }
  })
}

/** A store whose driver counts top-level transactions and can be told to fail the Nth one. */
async function countingStore() {
  const inner = openTestDriver()
  await migrate(inner)
  let count = 0
  let failAt = -1
  const driver: SqlDriver = {
    ...inner,
    transaction(fn) {
      count++
      if (count === failAt) return Promise.reject(new Error('crash'))
      return inner.transaction(fn)
    },
  }
  const store = createLocalStore({ driver, newId: randomUUID, now })
  return { store, transactions: () => count, failTransaction: (n: number) => { failAt = n } }
}
