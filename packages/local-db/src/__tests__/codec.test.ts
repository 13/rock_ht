import { describe, it, expect } from 'vitest'
import { toSqlRow, fromSqlRow } from '../codec'

describe('codec', () => {
  it('round-trips habits (bool + json columns)', () => {
    const row = {
      id: 'h', user_id: 'u', title: 'Run', description: null, icon: '🏃', color: '#6366f1',
      frequency: { type: 'specific_days', days: [1, 3] }, target_value: 1, target_unit: null,
      reminder_time: '07:30:00', reminder_enabled: true, is_archived: false, sort_order: 0,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
    }
    const sql = toSqlRow('habits', row)
    expect(sql.frequency).toBe('{"type":"specific_days","days":[1,3]}')
    expect(sql.reminder_enabled).toBe(1)
    expect(fromSqlRow('habits', sql)).toEqual(row)
  })

  it('drops unknown columns such as server_seq', () => {
    const sql = toSqlRow('journal_entries', {
      id: 'j', user_id: 'u', habit_id: null, entry_date: '2026-01-01', content: 'hi', mood: 4,
      created_at: 'c', updated_at: 'u', deleted_at: null, server_seq: 99,
    })
    expect('server_seq' in sql).toBe(false)
  })
})
