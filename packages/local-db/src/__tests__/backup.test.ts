import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
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

  it('does not export tombstones', async () => {
    const { s, h } = await seeded('u')
    await s.deleteHabit(h.id)
    expect((await s.exportBackup('u')).tables.habits).toEqual([])
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
