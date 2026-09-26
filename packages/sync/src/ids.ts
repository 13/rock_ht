import { v5 as uuidv5 } from 'uuid'

export const COMPLETION_NAMESPACE = '6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'

/**
 * One completion per habit per day, so every device derives the same id. The habit id is
 * lowercased first, matching Postgres' `public.completion_id` (uuid::text is lowercase).
 */
export function completionId(habitId: string, date: string): string {
  return uuidv5(`${habitId.toLowerCase()}:${date}`, COMPLETION_NAMESPACE)
}

export const COPY_NAMESPACE = '991030d2-e784-4e0c-8cb5-4247bb2d7485'

/**
 * The id a row gets when it is copied into `accountId` from data whose ids may already belong to
 * another account on a server (a backup import, see `importBackup` in @rock_ht/local-db). Derived,
 * not random, so importing the same backup twice merges instead of duplicating.
 */
export function copiedId(accountId: string, oldId: string): string {
  return uuidv5(`${accountId.toLowerCase()}:${oldId.toLowerCase()}`, COPY_NAMESPACE)
}
