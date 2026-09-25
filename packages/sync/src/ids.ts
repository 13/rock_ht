import { v5 as uuidv5 } from 'uuid'

export const COMPLETION_NAMESPACE = '6d2f3b8e-8c1a-4b7e-9f2d-5a4c3e2b1d0f'

/** One completion per habit per day, so every device derives the same id. */
export function completionId(habitId: string, date: string): string {
  return uuidv5(`${habitId}:${date}`, COMPLETION_NAMESPACE)
}
