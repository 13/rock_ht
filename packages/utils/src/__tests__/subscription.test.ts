import { describe, it, expect } from 'vitest'
import { planAllows, habitLimitForPlan, FREE_HABIT_LIMIT } from '../subscription'

describe('planAllows', () => {
  it('pro unlocks all features', () => {
    expect(planAllows('pro', 'ai_coach')).toBe(true)
    expect(planAllows('pro', 'unlimited_habits')).toBe(true)
    expect(planAllows('pro', 'data_export')).toBe(true)
    expect(planAllows('pro', 'ai_insights')).toBe(true)
    expect(planAllows('pro', 'advanced_analytics')).toBe(true)
  })

  it('free blocks all pro features', () => {
    expect(planAllows('free', 'ai_coach')).toBe(false)
    expect(planAllows('free', 'unlimited_habits')).toBe(false)
    expect(planAllows('free', 'data_export')).toBe(false)
    expect(planAllows('free', 'ai_insights')).toBe(false)
    expect(planAllows('free', 'advanced_analytics')).toBe(false)
  })
})

describe('habitLimitForPlan', () => {
  it('free tier caps at FREE_HABIT_LIMIT', () => {
    expect(habitLimitForPlan('free')).toBe(FREE_HABIT_LIMIT)
    expect(FREE_HABIT_LIMIT).toBe(5)
  })

  it('pro tier has no limit', () => {
    expect(habitLimitForPlan('pro')).toBe(Infinity)
  })
})
