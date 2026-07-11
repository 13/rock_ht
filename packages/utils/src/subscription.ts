export type Plan = 'free' | 'pro'

export const FREE_HABIT_LIMIT = 5

export const PRO_FEATURES = [
  'unlimited_habits',
  'ai_coach',
  'ai_insights',
  'data_export',
  'advanced_analytics',
] as const

export type ProFeature = (typeof PRO_FEATURES)[number]

export function planAllows(plan: Plan, feature: ProFeature): boolean {
  return plan === 'pro'
}

export function habitLimitForPlan(plan: Plan): number {
  return plan === 'pro' ? Infinity : FREE_HABIT_LIMIT
}
