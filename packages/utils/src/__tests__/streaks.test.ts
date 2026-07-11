import { describe, it, expect } from 'vitest'
import { isScheduledOn, calculateStreak, weeklyConsistencyScore } from '../streaks'
import type { Frequency, HabitWithFrequency, CompletionRow } from '@sisigo/types'

// ─── Frequency fixtures ───────────────────────────────────────────────────────

const daily: Frequency = { type: 'daily' }
const weekdays: Frequency = { type: 'specific_days', days: [1, 2, 3, 4, 5] } // Mon–Fri
const weekendsOnly: Frequency = { type: 'specific_days', days: [0, 6] } // Sun + Sat
const timesPerWeek: Frequency = { type: 'times_per_week', count: 3 }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]!
}

function makeHabit(id: string, frequency: Frequency): HabitWithFrequency {
  return {
    id,
    user_id: 'user-1',
    title: 'Test habit',
    description: null,
    icon: '⭐',
    color: '#6366f1',
    frequency,
    target_value: 1,
    target_unit: null,
    reminder_time: null,
    reminder_enabled: false,
    is_archived: false,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCompletion(habit_id: string, completed_date: string): CompletionRow {
  return {
    id: `${habit_id}-${completed_date}`,
    habit_id,
    user_id: 'user-1',
    completed_date,
    value: 1,
    note: null,
    created_at: `${completed_date}T00:00:00Z`,
  }
}

// ─── isScheduledOn ────────────────────────────────────────────────────────────

describe('isScheduledOn', () => {
  it('daily habit is scheduled on every day of the week', () => {
    // Monday 2026-07-06 is actually a Monday; let's use known dates
    expect(isScheduledOn(daily, '2026-07-06')).toBe(true) // Monday
    expect(isScheduledOn(daily, '2026-07-11')).toBe(true) // Saturday
    expect(isScheduledOn(daily, '2026-07-12')).toBe(true) // Sunday
  })

  it('specific_days: weekday habit fires Mon–Fri only', () => {
    // 2026-07-06 is Monday (getDay() === 1)
    expect(isScheduledOn(weekdays, '2026-07-06')).toBe(true)  // Mon
    expect(isScheduledOn(weekdays, '2026-07-10')).toBe(true)  // Fri
    expect(isScheduledOn(weekdays, '2026-07-11')).toBe(false) // Sat
    expect(isScheduledOn(weekdays, '2026-07-12')).toBe(false) // Sun
  })

  it('specific_days: weekend habit fires Sat/Sun only', () => {
    expect(isScheduledOn(weekendsOnly, '2026-07-11')).toBe(true)  // Sat
    expect(isScheduledOn(weekendsOnly, '2026-07-12')).toBe(true)  // Sun
    expect(isScheduledOn(weekendsOnly, '2026-07-06')).toBe(false) // Mon
  })

  it('times_per_week is schedulable on any day', () => {
    expect(isScheduledOn(timesPerWeek, '2026-07-06')).toBe(true) // Mon
    expect(isScheduledOn(timesPerWeek, '2026-07-11')).toBe(true) // Sat
    expect(isScheduledOn(timesPerWeek, '2026-07-12')).toBe(true) // Sun
  })
})

// ─── calculateStreak ──────────────────────────────────────────────────────────

describe('calculateStreak', () => {
  it('returns 0 for empty completions array', () => {
    const result = calculateStreak([], daily)
    expect(result.current_streak).toBe(0)
    expect(result.longest_streak).toBe(0)
    expect(result.last_completed_date).toBeNull()
  })

  it('returns a streak of 1 when only completed today', () => {
    const result = calculateStreak([daysAgo(0)], daily)
    expect(result.current_streak).toBe(1)
    expect(result.longest_streak).toBe(1)
    expect(result.last_completed_date).toBe(daysAgo(0))
  })

  it('calculates consecutive daily streak ending today', () => {
    const dates = [daysAgo(2), daysAgo(1), daysAgo(0)]
    const result = calculateStreak(dates, daily)
    expect(result.current_streak).toBe(3)
    expect(result.longest_streak).toBe(3)
  })

  it('resets current streak when a day is skipped', () => {
    // Completed today and 3 days ago — gap breaks the streak
    const dates = [daysAgo(3), daysAgo(0)]
    const result = calculateStreak(dates, daily)
    expect(result.current_streak).toBe(1)
  })

  it('longest_streak reflects the historical maximum even when current streak is 0', () => {
    // A run of 4 days in the past, then nothing for 10 days
    const dates = [daysAgo(13), daysAgo(12), daysAgo(11), daysAgo(10)]
    const result = calculateStreak(dates, daily)
    expect(result.current_streak).toBe(0)
    expect(result.longest_streak).toBeGreaterThanOrEqual(4)
  })

  it('last_completed_date is the most recent date in the list', () => {
    const dates = [daysAgo(5), daysAgo(2), daysAgo(1)]
    const result = calculateStreak(dates, daily)
    expect(result.last_completed_date).toBe(daysAgo(1))
  })

  it('accepts a custom referenceDate for deterministic tests', () => {
    // Fixed reference: treat 2026-07-10 as "today"
    const result = calculateStreak(
      ['2026-07-08', '2026-07-09', '2026-07-10'],
      daily,
      '2026-07-10'
    )
    expect(result.current_streak).toBe(3)
    expect(result.longest_streak).toBe(3)
    expect(result.last_completed_date).toBe('2026-07-10')
  })

  it('times_per_week: counts qualifying weeks as streak units', () => {
    // Supply 3 completions in one week — that week qualifies
    const dates = ['2026-07-06', '2026-07-07', '2026-07-08']
    const result = calculateStreak(dates, timesPerWeek, '2026-07-10')
    expect(result.current_streak).toBeGreaterThanOrEqual(1)
    expect(result.longest_streak).toBeGreaterThanOrEqual(1)
  })
})

// ─── weeklyConsistencyScore ───────────────────────────────────────────────────

describe('weeklyConsistencyScore', () => {
  it('returns 0 when the habits list is empty', () => {
    expect(weeklyConsistencyScore([], [])).toBe(0)
  })

  it('returns 0 when all active habits are archived', () => {
    const archivedHabit = { ...makeHabit('h1', daily), is_archived: true }
    expect(weeklyConsistencyScore([archivedHabit], [])).toBe(0)
  })

  it('returns 0 when there are no completions for any habit', () => {
    const habit = makeHabit('h1', daily)
    const score = weeklyConsistencyScore([habit], [])
    expect(score).toBe(0)
  })

  it('returns 100 when every scheduled slot is completed for a single daily habit', () => {
    const habit = makeHabit('h1', daily)
    // Complete all 7 days of the past week
    const completions = Array.from({ length: 7 }, (_, i) =>
      makeCompletion('h1', daysAgo(i))
    )
    const score = weeklyConsistencyScore([habit], completions)
    expect(score).toBe(100)
  })

  it('returns ~50 when half the scheduled days are completed', () => {
    const habit = makeHabit('h1', daily)
    // Only complete 3 of the last 7 days (indices 0, 2, 4)
    const completions = [0, 2, 4].map(i => makeCompletion('h1', daysAgo(i)))
    const score = weeklyConsistencyScore([habit], completions)
    // 3/7 ≈ 43 – allows ±15 for rounding
    expect(score).toBeGreaterThanOrEqual(30)
    expect(score).toBeLessThanOrEqual(60)
  })

  it('is always between 0 and 100', () => {
    const habit = makeHabit('h1', daily)
    const completions = [makeCompletion('h1', daysAgo(0))]
    const score = weeklyConsistencyScore([habit], completions)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('averages across multiple active habits', () => {
    const h1 = makeHabit('h1', daily)
    const h2 = makeHabit('h2', daily)
    // h1: all 7 days completed → 100%
    const h1Completions = Array.from({ length: 7 }, (_, i) => makeCompletion('h1', daysAgo(i)))
    // h2: 0 days completed → 0%
    const completions = [...h1Completions]
    const score = weeklyConsistencyScore([h1, h2], completions)
    // Average of 100 and 0 = 50
    expect(score).toBe(50)
  })

  it('excludes archived habits from the calculation', () => {
    const active = makeHabit('h1', daily)
    const archived = { ...makeHabit('h2', daily), is_archived: true }
    const completions = Array.from({ length: 7 }, (_, i) => makeCompletion('h1', daysAgo(i)))
    const score = weeklyConsistencyScore([active, archived], completions)
    // Only h1 counts → should be 100
    expect(score).toBe(100)
  })
})
