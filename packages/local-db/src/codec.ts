import type { SyncRow, SyncTable } from '@rock_ht/sync'
import type { SqlParam } from './driver'

type Kind = 'text' | 'int' | 'bool' | 'json'

const meta = { created_at: 'text', updated_at: 'text', deleted_at: 'text' } as const

export const COLUMNS: Record<SyncTable, Record<string, Kind>> = {
  profiles: {
    id: 'text', email: 'text', display_name: 'text', avatar_url: 'text', timezone: 'text',
    theme: 'text', onboarding_completed: 'bool', time_format: 'text', date_format: 'text', ...meta,
  },
  habits: {
    id: 'text', user_id: 'text', title: 'text', description: 'text', icon: 'text', color: 'text',
    frequency: 'json', target_value: 'int', target_unit: 'text', reminder_time: 'text',
    reminder_enabled: 'bool', is_archived: 'bool', sort_order: 'int', ...meta,
  },
  habit_completions: {
    id: 'text', habit_id: 'text', user_id: 'text', completed_date: 'text', value: 'int',
    note: 'text', ...meta,
  },
  journal_entries: {
    id: 'text', user_id: 'text', habit_id: 'text', entry_date: 'text', content: 'text',
    mood: 'int', ...meta,
  },
}

export function toSqlRow(table: SyncTable, row: SyncRow): Record<string, SqlParam> {
  const out: Record<string, SqlParam> = {}
  for (const [col, kind] of Object.entries(COLUMNS[table])) {
    const v = row[col]
    if (v === undefined || v === null) out[col] = null
    else if (kind === 'bool') out[col] = v ? 1 : 0
    else if (kind === 'json') out[col] = JSON.stringify(v)
    else out[col] = v as SqlParam
  }
  return out
}

export function fromSqlRow(table: SyncTable, raw: Record<string, SqlParam>): SyncRow {
  const out: Record<string, unknown> = {}
  for (const [col, kind] of Object.entries(COLUMNS[table])) {
    const v = raw[col] ?? null
    if (v === null) out[col] = null
    else if (kind === 'bool') out[col] = v === 1
    else if (kind === 'json') out[col] = JSON.parse(v as string)
    else out[col] = v
  }
  return out as SyncRow
}
