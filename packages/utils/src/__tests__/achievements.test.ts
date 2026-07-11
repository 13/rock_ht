import { describe, it, expect } from 'vitest'
import { checkAchievements } from '../achievements'
import type { AchievementInput } from '../achievements'
import type { HabitWithFrequency, CompletionRow } from '@sisigo/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const emptyInput: AchievementInput = {
  habits: [],
  streaks: [],
  completions: [],
}

function makeHabit(id: string, archived = false): HabitWithFrequency {
  return {
    id,
    title: 'Test',
    frequency: { type: 'daily' },
    is_archived: archived,
    user_id: 'u1',
    icon: '✨',
    color: '#000',
    target_value: 1,
    target_unit: null,
    description: null,
    reminder_time: null,
    reminder_enabled: false,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCompletion(habit_id: string, completed_date: string): CompletionRow {
  return {
    id: `${habit_id}-${completed_date}`,
    habit_id,
    user_id: 'u1',
    completed_date,
    value: 1,
    note: null,
    created_at: `${completed_date}T10:00:00Z`,
  }
}

// ─── checkAchievements ────────────────────────────────────────────────────────

describe('checkAchievements', () => {
  it('returns a non-empty list of achievements', () => {
    const result = checkAchievements(emptyInput)
    expect(result.length).toBeGreaterThan(0)
  })

  it('first_habit achievement is unlocked after creating one habit', () => {
    const withHabit: AchievementInput = { ...emptyInput, habits: [makeHabit('h1')] }
    const result = checkAchievements(withHabit)
    const first = result.find(a => a.id === 'first_habit')
    expect(first?.unlocked).toBe(true)
  })

  it('first_habit achievement is locked with no habits', () => {
    const result = checkAchievements(emptyInput)
    const first = result.find(a => a.id === 'first_habit')
    expect(first?.unlocked).toBe(false)
  })

  it('first_completion achievement is unlocked when completions exist', () => {
    const withCompletion: AchievementInput = {
      ...emptyInput,
      habits: [makeHabit('h1')],
      completions: [makeCompletion('h1', '2026-07-10')],
    }
    const result = checkAchievements(withCompletion)
    const first = result.find(a => a.id === 'first_completion')
    expect(first?.unlocked).toBe(true)
  })

  it('first_completion achievement is locked with no completions', () => {
    const result = checkAchievements(emptyInput)
    const first = result.find(a => a.id === 'first_completion')
    expect(first?.unlocked).toBe(false)
  })

  it('each achievement has required fields', () => {
    const result = checkAchievements(emptyInput)
    for (const a of result) {
      expect(a).toHaveProperty('id')
      expect(a).toHaveProperty('title')
      expect(a).toHaveProperty('emoji')
      expect(a).toHaveProperty('rarity')
      expect(typeof a.unlocked).toBe('boolean')
    }
  })
})
