import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { completionId, type SyncRow } from '@rock_ht/sync'
import { migrate } from '../schema'
import { createLocalStore, type LocalStore } from '../store'
import { BackupError, parseBackup } from '../backup'
import { openTestDriver } from './helpers'

let clock = 0
const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()

async function newStore(): Promise<LocalStore> {
  const driver = openTestDriver()
  await migrate(driver)
  return createLocalStore({ driver, newId: randomUUID, now })
}

async function seeded(user: string) {
  const s = await newStore()
  await s.ensureProfile(user)
  await s.updateProfile(user, { display_name: 'Ada' })
  const h = await s.createHabit(user, { title: 'Read', icon: '📚', color: '#6366f1', frequency: { type: 'daily' } })
  await s.setCompletion(user, { habit_id: h.id, date: '2026-01-02' }, true)
  await s.createJournal(user, { content: 'day one', entry_date: '2026-01-02' })
  return { s, h }
}

describe('backup', () => {
  it('round-trips into another store under the importing user', async () => {
    const { s: a } = await seeded('user-a')
    const json = JSON.stringify(await a.exportBackup('user-a'))
    const b = await newStore()
    await b.ensureProfile('user-b')
    const res = await b.importBackup('user-b', parseBackup(json))
    expect(res).toEqual({ imported: 4, skipped: 0 })
    expect((await b.listHabits('user-b'))[0]!.title).toBe('Read')
    expect(await b.listCompletions('user-b')).toHaveLength(1)
    expect((await b.listJournal('user-b'))[0]!.content).toBe('day one')
    expect((await b.getProfile('user-b'))!.display_name).toBe('Ada')
    expect((await b.sync.readOutbox(100)).length).toBe(4)
  })

  it('keeps the local profile email instead of the backup email', async () => {
    const { s: a } = await seeded('user-a')
    const backup = await a.exportBackup('user-a')
    backup.tables.profiles[0]!.email = 'someone-else@example.com'
    const b = await newStore()
    await b.ensureProfile('user-b')
    await b.sync.applyRemote([{ table: 'profiles', row: { ...(await b.sync.getRow('profiles', 'user-b'))!, email: 'me@example.com', updated_at: '2030-01-01T00:00:00.000Z' } }], null)

    await b.importBackup('user-b', backup)

    const p = (await b.getProfile('user-b'))!
    expect(p.email).toBe('me@example.com')
    expect(p.display_name).toBe('Ada')
    const queued = (await b.sync.readOutbox(100)).find((e) => e.change.table === 'profiles')!
    expect(queued.change.row.email).toBe('me@example.com')
  })

  it('imports a profile with an empty email when there is no local profile', async () => {
    const { s: a } = await seeded('user-a')
    const backup = await a.exportBackup('user-a')
    backup.tables.profiles[0]!.email = 'someone-else@example.com'
    const b = await newStore()
    await b.importBackup('user-b', backup)
    expect((await b.getProfile('user-b'))!.email).toBe('')
  })

  it('keeps newer live local rows', async () => {
    const { s, h } = await seeded('u')
    const backup = await s.exportBackup('u')
    await s.updateHabit({ id: h.id, title: 'Read more' })
    const res = await s.importBackup('u', backup)
    expect(res.skipped).toBeGreaterThanOrEqual(1)
    expect((await s.getHabit(h.id))!.title).toBe('Read more')
  })

  it('restores rows deleted after the export', async () => {
    const { s, h } = await seeded('u')
    const backup = await s.exportBackup('u')
    await s.deleteHabit(h.id)
    await s.importBackup('u', backup)
    expect((await s.getHabit(h.id))!.title).toBe('Read')
  })

  it('never revives a tombstone carried by the backup (hand-edited or older export)', async () => {
    const { s, h } = await seeded('user-a')
    const backup = await s.exportBackup('user-a')
    backup.tables.habits[0] = { ...backup.tables.habits[0]!, deleted_at: '2026-01-03T00:00:00.000Z' }
    const extra: SyncRow = { ...backup.tables.journal_entries[0]!, id: randomUUID(), deleted_at: '2026-01-03T00:00:00.000Z' }
    backup.tables.journal_entries.push(extra)

    const fresh = await newStore()
    const res = await fresh.importBackup('user-a', backup)
    // The habit, its completion and the journal entry.
    expect(res.skipped).toBe(3)
    expect(await fresh.getHabit(h.id)).toBeNull()
    expect(ids(await fresh.listJournal('user-a'))).not.toContain(extra.id)

    // Nor does it delete the live local copy.
    await s.importBackup('user-a', backup)
    expect((await s.getHabit(h.id))!.title).toBe('Read')
  })

  it('does not export tombstones', async () => {
    const { s, h } = await seeded('u')
    await s.deleteHabit(h.id)
    expect((await s.exportBackup('u')).tables.habits).toEqual([])
  })

  it('does not export completions of a deleted habit', async () => {
    const { s, h } = await seeded('u')
    await s.deleteHabit(h.id)
    expect((await s.exportBackup('u')).tables.habit_completions).toEqual([])
  })

  it('restoring a deleted habit via import makes its completions visible again', async () => {
    const { s, h } = await seeded('u')
    const backup = await s.exportBackup('u')
    await s.deleteHabit(h.id)
    expect(await s.listCompletions('u')).toHaveLength(0)

    await s.importBackup('u', backup)

    expect((await s.getHabit(h.id))!.title).toBe('Read')
    expect(await s.listCompletions('u')).toHaveLength(1)
  })

  it('rolls the whole import back when a row is invalid', async () => {
    const { s: a } = await seeded('u')
    const backup = await a.exportBackup('u')
    backup.tables.journal_entries.push({ ...backup.tables.journal_entries[0]!, id: randomUUID(), content: null })
    const b = await newStore()
    await expect(b.importBackup('u', backup)).rejects.toThrow()
    expect(await b.listHabits('u')).toEqual([])
  })

  it('rejects files that are not rock backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ format: 'other' }))).toThrow('Not a rock backup file')
    expect(() => parseBackup(JSON.stringify({ format: 'rock_ht-backup', version: 2, tables: {} })))
      .toThrow('Unsupported backup version 2')
  })
})

describe('backup import: completion ids', () => {
  it('normalizes completion ids to completionId(habit_id, completed_date)', async () => {
    const { s: a, h } = await seeded('u')
    const backup = await a.exportBackup('u')
    // A web/Supabase export from before deterministic ids: same habit and day, a random id.
    backup.tables.habit_completions[0]!.id = randomUUID()
    backup.tables.habit_completions[0]!.updated_at = '2030-01-01T00:00:00.000Z'

    // Into the device that already has that completion: merges instead of tripping unique(habit_id, date).
    await a.importBackup('u', backup)
    expect((await a.listCompletions('u')).map((c) => c.id)).toEqual([completionId(h.id, '2026-01-02')])

    // Into a fresh device: stored (and queued) under the derived id.
    const b = await newStore()
    await b.importBackup('u', backup)
    expect((await b.listCompletions('u')).map((c) => c.id)).toEqual([completionId(h.id, '2026-01-02')])
    const queued = (await b.sync.readOutbox(100)).filter((e) => e.change.table === 'habit_completions')
    expect(queued.map((e) => e.change.row.id)).toEqual([completionId(h.id, '2026-01-02')])
  })
})

/** A device signed in to `account` (its local data claimed into it). */
async function signedIn(account: string) {
  const s = await newStore()
  await s.ensureProfile('local')
  await (await s.claim(account, { pushLocalProfile: true })).completed
  return s
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('backup import onto a device of another account (re-keyed like claim)', () => {
  it('imports another account\'s backup under new ids, so the push lands in this account', async () => {
    const { s: a, h } = await seeded('account-A')
    const backup = await a.exportBackup('account-A')
    const j = backup.tables.journal_entries[0]!
    const b = await signedIn('account-B')

    expect(await b.importBackup('account-B', backup)).toEqual({ imported: 4, skipped: 0 })

    const habits = await b.listHabits('account-B')
    expect(habits.map((x) => x.title)).toEqual(['Read'])
    const read = habits[0]!
    expect(read.id).not.toBe(h.id)
    const completions = await b.listCompletions('account-B')
    expect(completions.map((c) => [c.id, c.habit_id])).toEqual([[completionId(read.id, '2026-01-02'), read.id]])
    const journal = await b.listJournal('account-B')
    expect(journal.map((e) => e.content)).toEqual(['day one'])
    expect(journal[0]!.id).not.toBe(j.id)

    // Nothing queued carries one of account A's ids.
    const foreign = new Set([h.id, completionId(h.id, '2026-01-02'), j.id as string])
    const out = await b.sync.readOutbox(100)
    expect(out.filter((e) => foreign.has(e.change.row.id))).toEqual([])
    expect(out.map((e) => e.change.row.id)).toEqual(expect.arrayContaining([read.id, journal[0]!.id]))
  })

  it('keeps journal links and drops tombstones and orphaned completions, as claim does', async () => {
    const { s: a, h } = await seeded('account-A')
    const backup = await a.exportBackup('account-A')
    backup.tables.journal_entries.push({ ...backup.tables.journal_entries[0]!, id: randomUUID(), content: 'linked', habit_id: h.id })
    backup.tables.journal_entries.push({ ...backup.tables.journal_entries[0]!, id: randomUUID(), content: 'orphan link', habit_id: randomUUID() })
    const gone: SyncRow = { ...backup.tables.habits[0]!, id: randomUUID(), title: 'Gone', deleted_at: '2026-01-03T00:00:00.000Z' }
    backup.tables.habits.push(gone)
    backup.tables.habit_completions.push({ ...backup.tables.habit_completions[0]!, habit_id: gone.id, id: completionId(gone.id, '2026-01-02') })
    const b = await signedIn('account-B')

    // Profile, Read, its completion and the three journal entries; the tombstone and its
    // orphaned completion are dropped and counted.
    expect(await b.importBackup('account-B', backup)).toEqual({ imported: 6, skipped: 2 })

    const habits = await b.listHabits('account-B', { includeArchived: true })
    expect(habits.map((x) => x.title)).toEqual(['Read'])
    expect(await b.listCompletions('account-B')).toHaveLength(1)
    const journal = await b.listJournal('account-B')
    expect(journal.find((e) => e.content === 'linked')!.habit_id).toBe(habits[0]!.id)
    expect(journal.find((e) => e.content === 'orphan link')!.habit_id).toBeNull()
  })

  it('re-importing the same backup merges instead of duplicating (the new ids are derived)', async () => {
    const { s: a } = await seeded('account-A')
    const backup = await a.exportBackup('account-A')
    const b = await signedIn('account-B')
    await b.importBackup('account-B', backup)
    const again = await b.importBackup('account-B', backup)
    expect(again.imported).toBe(1) // just the profile
    expect(await b.listHabits('account-B')).toHaveLength(1)
    expect(await b.listCompletions('account-B')).toHaveLength(1)
    expect(await b.listJournal('account-B')).toHaveLength(1)
  })

  it('keeps the ids of a backup from this same account', async () => {
    const { s: a, h } = await seeded('account-A')
    const backup = await a.exportBackup('account-A')
    const b = await signedIn('account-A')
    await b.importBackup('account-A', backup)
    expect(ids(await b.listHabits('account-A'))).toEqual([h.id])
    expect(ids(await b.listCompletions('account-A'))).toEqual([completionId(h.id, '2026-01-02')])
    expect(ids(await b.listJournal('account-A'))).toEqual(ids(backup.tables.journal_entries as { id: string }[]))
  })

  it('re-keys on a device disconnected from another account (its rows stay that account\'s)', async () => {
    const { s: a, h } = await seeded('account-A')
    const backup = await a.exportBackup('account-A')
    const b = await signedIn('account-B')
    await b.setMeta('local_user_id', 'account-B')
    await b.setMeta('account_user_id', null)
    await b.importBackup('account-B', backup)
    expect(ids(await b.listHabits('account-B'))).not.toContain(h.id)
  })

  it('keeps the ids of a backup of the local identity this account claimed (the same data)', async () => {
    // Exported offline, then the device signed in (claim keeps a purely local identity's ids).
    const { s: b, h } = await seeded('local-1')
    await b.setMeta('local_user_id', 'local-1')
    const backup = await b.exportBackup('local-1')
    await (await b.claim('account-X', { pushLocalProfile: true })).completed

    expect(await b.importBackup('account-X', backup)).toEqual({ imported: 1, skipped: 3 })
    expect(ids(await b.listHabits('account-X'))).toEqual([h.id])
    expect(ids(await b.listCompletions('account-X'))).toEqual([completionId(h.id, '2026-01-02')])
    expect(await b.listJournal('account-X')).toHaveLength(1)
  })

  it('re-keys a backup of the local identity once its ids went to an earlier account', async () => {
    const { s: b, h } = await seeded('local-1')
    await b.setMeta('local_user_id', 'local-1')
    const backup = await b.exportBackup('local-1')
    // Claimed into W first (the local ids are on W's server), then switched to X (re-keyed).
    await (await b.claim('account-W', { pushLocalProfile: true })).completed
    await (await b.claim('account-X', { pushLocalProfile: false })).completed

    await b.importBackup('account-X', backup)
    expect(ids(await b.listHabits('account-X'))).not.toContain(h.id)
  })

  describe('on a device with no account yet', () => {
    it('keeps the backup\'s ids, so signing in to the backup\'s own account merges instead of duplicating', async () => {
      const { s: a, h } = await seeded('account-A')
      const backup = await a.exportBackup('account-A')
      const b = await newStore()
      await b.ensureProfile('local')
      await b.importBackup('local', backup)
      expect(ids(await b.listHabits('local'))).toEqual([h.id])

      await (await b.claim('account-A', { pushLocalProfile: false })).completed
      expect(ids(await b.listHabits('account-A'))).toEqual([h.id])
      expect(ids(await b.listCompletions('account-A'))).toEqual([completionId(h.id, '2026-01-02')])
    })

    it('re-keys the imported rows when the device then signs in to a different account', async () => {
      const { s: a, h } = await seeded('account-A')
      const backup = await a.exportBackup('account-A')
      const b = await newStore()
      await b.ensureProfile('local')
      await b.importBackup('local', backup)

      await (await b.claim('account-B', { pushLocalProfile: true })).completed

      const habits = await b.listHabits('account-B')
      expect(habits.map((x) => x.title)).toEqual(['Read'])
      expect(habits[0]!.id).not.toBe(h.id)
      expect(ids(await b.listCompletions('account-B'))).toEqual([completionId(habits[0]!.id, '2026-01-02')])
      const out = await b.sync.readOutbox(100)
      expect(out.map((e) => e.change.row.id)).not.toContain(h.id)
      // Only once: a later reconnect to B is the already-owned no-op.
      await b.setMeta('account_user_id', null)
      await (await b.claim('account-B', { pushLocalProfile: false })).completed
      expect(ids(await b.listHabits('account-B'))).toEqual([habits[0]!.id])
    })

    it('does not re-key a backup of the device\'s own local data', async () => {
      const { s: a, h } = await seeded('local')
      const backup = await a.exportBackup('local')
      const b = await newStore()
      await b.ensureProfile('local')
      await b.importBackup('local', backup)
      await (await b.claim('account-B', { pushLocalProfile: true })).completed
      expect(ids(await b.listHabits('account-B'))).toEqual([h.id])
    })
  })
})
