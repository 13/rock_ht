import { SYNC_TABLES, type SyncRow, type SyncTable } from '@rock_ht/sync'

export const BACKUP_FORMAT = 'rock_ht-backup'
export const BACKUP_VERSION = 1

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exported_at: string
  tables: Record<SyncTable, SyncRow[]>
}

export class BackupError extends Error {}

/** Validates the envelope. Row contents are checked by the table constraints during import. */
export function parseBackup(json: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new BackupError('Not a JSON file')
  }
  const b = data as Partial<Backup> | null
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) throw new BackupError('Not a rock backup file')
  if (b.version !== BACKUP_VERSION) throw new BackupError(`Unsupported backup version ${String(b.version)}`)
  for (const t of SYNC_TABLES) {
    const rows: unknown = b.tables?.[t]
    const valid = Array.isArray(rows) && rows.every((r) =>
      r !== null && typeof r === 'object' &&
      typeof (r as SyncRow).id === 'string' && typeof (r as SyncRow).updated_at === 'string')
    if (!valid) throw new BackupError(`Invalid "${t}" section`)
  }
  return b as Backup
}
