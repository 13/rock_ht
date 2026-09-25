import type { SyncRow } from './types'

export function isNewer(incoming: SyncRow, existing: SyncRow | null): boolean {
  if (!existing) return true
  return incoming.updated_at > existing.updated_at
}

export function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString()
}
