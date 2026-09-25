import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { completionId, isNewer, type SyncChange, type SyncRow } from '@rock_ht/sync'
import { today } from '@rock_ht/utils'
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

describe('LocalStore', () => {
  let s: LocalStore
  beforeEach(async () => { s = await newStore() })

  it('creates and lists habits with parsed frequency', async () => {
    await s.createHabit(U, { title: 'Read', icon: '📚', color: '#6366f1', frequency: { type: 'daily' } })
    const list = await s.listHabits(U)
    expect(list).toHaveLength(1)
    expect(list[0]!.frequency).toEqual({ type: 'daily' })
  })

  it('writes an outbox entry per mutation', async () => {
    const h = await s.createHabit(U, { title: 'A', icon: '✨', color: '#fff', frequency: { type: 'daily' } })
    await s.updateHabit({ id: h.id, title: 'B' })
    const out = await s.sync.readOutbox(10)
    expect(out.map((e) => e.change.row.title)).toEqual(['A', 'B'])
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

    await expect(s.claim('account-1', { pushLocalProfile: true })).resolves.toBeUndefined()

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
})
