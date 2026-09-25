import { describe, it, expect } from 'vitest'
import { parseReminderTime, reminderTriggers } from '../reminders'

describe('parseReminderTime', () => {
  it('parses HH:MM and Postgres HH:MM:SS', () => {
    expect(parseReminderTime('07:30')).toEqual({ hour: 7, minute: 30 })
    expect(parseReminderTime('21:05:00')).toEqual({ hour: 21, minute: 5 })
  })
  it('rejects malformed or out-of-range times', () => {
    expect(parseReminderTime('25:00')).toBeNull()
    expect(parseReminderTime('07:60')).toBeNull()
    expect(parseReminderTime('soon')).toBeNull()
  })
})

describe('reminderTriggers', () => {
  it('schedules daily habits once a day', () => {
    expect(reminderTriggers({ type: 'daily' }, '08:00')).toEqual([{ kind: 'daily', hour: 8, minute: 0 }])
  })
  it('maps specific days (0=Sun..6=Sat) to weekly triggers (1=Sun..7=Sat)', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [6, 0, 3] }, '09:15')).toEqual([
      { kind: 'weekly', weekday: 1, hour: 9, minute: 15 },
      { kind: 'weekly', weekday: 4, hour: 9, minute: 15 },
      { kind: 'weekly', weekday: 7, hour: 9, minute: 15 },
    ])
  })
  it('drops duplicate and invalid days', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [1, 1, 9, -1] }, '09:00')).toEqual([
      { kind: 'weekly', weekday: 2, hour: 9, minute: 0 },
    ])
  })
  it('returns nothing for a specific-days habit without days', () => {
    expect(reminderTriggers({ type: 'specific_days', days: [] }, '09:00')).toEqual([])
  })
  it('reminds times-per-week habits daily (they have no fixed days)', () => {
    expect(reminderTriggers({ type: 'times_per_week', count: 3 }, '18:00')).toEqual([{ kind: 'daily', hour: 18, minute: 0 }])
  })
  it('returns nothing for an invalid time', () => {
    expect(reminderTriggers({ type: 'daily' }, 'later')).toEqual([])
  })
})
