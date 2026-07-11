import type { Frequency, DayCompletion, HabitWithFrequency, CompletionRow } from "@sisigo/types";
import {
  today,
  parseDate,
  getDayOfWeek,
  subtractDays,
  getLast30Days,
  daysBetween,
  formatDate,
} from "./dates";

export interface StreakResult {
  current_streak: number;
  longest_streak: number;
  last_completed_date: string | null;
}

/**
 * Returns whether a habit with the given frequency is scheduled on a given date.
 */
export function isScheduledOn(frequency: Frequency, dateStr: string): boolean {
  switch (frequency.type) {
    case "daily":
      return true;
    case "specific_days":
      return frequency.days.includes(getDayOfWeek(dateStr));
    case "times_per_week":
      return true; // completion can happen any day; validation is per-week
  }
}

/**
 * Calculates whether today is a scheduled day for a habit.
 */
export function isScheduledToday(frequency: Frequency): boolean {
  return isScheduledOn(frequency, today());
}

/**
 * For a sorted list of completion dates (ascending), calculates streak metrics.
 * This is the authoritative client-side streak calculation.
 * The DB also caches streaks via triggers for performance.
 */
export function calculateStreak(
  completionDates: string[],
  frequency: Frequency,
  referenceDate?: string
): StreakResult {
  if (completionDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_completed_date: null };
  }

  const ref = referenceDate ?? today();
  const sorted = [...completionDates].sort((a, b) => (a > b ? 1 : -1));
  const last = sorted[sorted.length - 1]!;

  if (frequency.type === "times_per_week") {
    return calculateTimesPerWeekStreak(sorted, frequency.count, ref);
  }

  return calculateConsecutiveStreak(sorted, frequency, ref);
}

function calculateConsecutiveStreak(
  sortedDates: string[],
  frequency: Frequency,
  referenceDate: string
): StreakResult {
  const dateSet = new Set(sortedDates);
  const last = sortedDates[sortedDates.length - 1]!;

  // Current streak: walk backwards from referenceDate counting consecutive scheduled completions
  let currentStreak = 0;
  let cursor = referenceDate;

  // Allow today or yesterday as the starting point (grace for not-yet-completed today)
  const lastCompleted = last;
  const daysSinceLast = daysBetween(referenceDate, lastCompleted);

  if (daysSinceLast > 1) {
    // Streak is broken — need to find where it ended
    currentStreak = 0;
  } else {
    // Walk backwards from last completion
    cursor = lastCompleted;
    while (true) {
      if (isScheduledOn(frequency, cursor)) {
        if (dateSet.has(cursor)) {
          currentStreak++;
        } else {
          break;
        }
      }
      const prev = subtractDays(cursor, 1);
      if (cursor === prev) break;
      cursor = prev;
      // Safety: don't go back more than 10 years
      if (daysBetween(referenceDate, cursor) > 3650) break;
    }
  }

  // Longest streak: find the maximum consecutive run
  let longestStreak = 0;
  let runLength = 0;
  let prevScheduledDate: string | null = null;

  for (const date of sortedDates) {
    if (!isScheduledOn(frequency, date)) continue;

    if (prevScheduledDate === null) {
      runLength = 1;
    } else {
      const gap = daysBetween(date, prevScheduledDate);
      const expectedGap = getExpectedGap(frequency, prevScheduledDate, date);
      if (gap <= expectedGap) {
        runLength++;
      } else {
        runLength = 1;
      }
    }

    if (runLength > longestStreak) longestStreak = runLength;
    prevScheduledDate = date;
  }

  longestStreak = Math.max(longestStreak, currentStreak);

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_completed_date: last,
  };
}

function getExpectedGap(
  frequency: Frequency,
  fromDate: string,
  toDate: string
): number {
  if (frequency.type === "daily") return 1;
  if (frequency.type === "specific_days") {
    // Count scheduled days between fromDate and toDate
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    const diffDays = daysBetween(fromDate, toDate);
    // For specific days, max gap between two consecutive scheduled days
    // equals 7 days (e.g., if only Sun is scheduled)
    return 7;
  }
  return 1;
}

function calculateTimesPerWeekStreak(
  sortedDates: string[],
  targetCount: number,
  referenceDate: string
): StreakResult {
  // Group completions by ISO week number
  const weekMap = new Map<string, number>();

  for (const date of sortedDates) {
    const d = parseDate(date);
    const weekKey = formatDate(
      new Date(d.getFullYear(), 0, 1 + (getISOWeek(d) - 1) * 7)
    );
    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + 1);
  }

  const weeks = [...weekMap.entries()].sort(([a], [b]) => (a > b ? 1 : -1));
  let currentStreak = 0;
  let longestStreak = 0;
  let runLength = 0;

  for (const [_week, count] of weeks) {
    if (count >= targetCount) {
      runLength++;
    } else {
      runLength = 0;
    }
    if (runLength > longestStreak) longestStreak = runLength;
  }

  // Current streak: count trailing consecutive qualifying weeks
  for (let i = weeks.length - 1; i >= 0; i--) {
    const [, count] = weeks[i]!;
    if (count! >= targetCount) {
      currentStreak++;
    } else {
      break;
    }
  }

  const last = sortedDates[sortedDates.length - 1] ?? null;
  return {
    current_streak: currentStreak,
    longest_streak: Math.max(longestStreak, currentStreak),
    last_completed_date: last,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Builds a heatmap data structure for the last N days.
 * Returns an array of {date, completed, value} objects.
 */
export function buildCompletionHeatmap(
  completions: { completed_date: string; value: number }[],
  days = 30
): DayCompletion[] {
  const completionMap = new Map(
    completions.map((c) => [c.completed_date, c.value])
  );

  const result: DayCompletion[] = [];
  const todayStr = today();

  for (let i = days - 1; i >= 0; i--) {
    const dateStr = subtractDays(todayStr, i);
    const value = completionMap.get(dateStr) ?? 0;
    result.push({
      date: dateStr,
      completed: value > 0,
      value,
    });
  }

  return result;
}

/**
 * Calculates the completion rate for the last N days.
 */
export function completionRate(
  completions: { completed_date: string }[],
  frequency: Frequency,
  days = 30
): number {
  const todayStr = today();
  let scheduled = 0;
  let completed = 0;
  const completionSet = new Set(completions.map((c) => c.completed_date));

  for (let i = 0; i < days; i++) {
    const dateStr = subtractDays(todayStr, i);
    if (isScheduledOn(frequency, dateStr)) {
      scheduled++;
      if (completionSet.has(dateStr)) {
        completed++;
      }
    }
  }

  if (scheduled === 0) return 0;
  return Math.round((completed / scheduled) * 100);
}

/**
 * Returns weekly completion data for the current week (Mon-Sun).
 */
export function getWeeklyCompletions(
  completions: { completed_date: string; value: number }[],
  frequency: Frequency
): DayCompletion[] {
  const todayStr = today();
  const weekDays: DayCompletion[] = [];
  const completionMap = new Map(
    completions.map((c) => [c.completed_date, c.value])
  );

  // Get Monday of current week
  const todayDate = parseDate(todayStr);
  const dayOfWeek = getDayOfWeek(todayStr);
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  for (let i = 0; i < 7; i++) {
    const dateStr = subtractDays(todayStr, mondayOffset - i);
    const value = completionMap.get(dateStr) ?? 0;
    weekDays.push({
      date: dateStr,
      completed: value > 0,
      value,
    });
  }

  return weekDays;
}

/**
 * Returns Mon-Sun completion rates for a habit over the last N days.
 */
export function completionsByDayOfWeek(
  completions: { completed_date: string }[],
  frequency: Frequency,
  days = 90
): { day: number; label: string; rate: number; scheduled: number; completed: number }[] {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const counts = Array.from({ length: 7 }, () => ({ scheduled: 0, completed: 0 }));
  const completionSet = new Set(completions.map((c) => c.completed_date));
  const todayStr = today();

  for (let i = 0; i < days; i++) {
    const dateStr = subtractDays(todayStr, i);
    if (isScheduledOn(frequency, dateStr)) {
      const dow = getDayOfWeek(dateStr);
      counts[dow]!.scheduled++;
      if (completionSet.has(dateStr)) counts[dow]!.completed++;
    }
  }

  return counts.map((c, i) => ({
    day: i,
    label: dayNames[i]!,
    rate: c.scheduled === 0 ? 0 : Math.round((c.completed / c.scheduled) * 100),
    scheduled: c.scheduled,
    completed: c.completed,
  }));
}

/**
 * Returns true if a habit with an active streak must be completed today to avoid breaking it.
 * A streak is "at risk" when: streak > 0, today is a scheduled day, and it hasn't been completed.
 */
export function isStreakAtRisk(
  currentStreak: number,
  frequency: Frequency,
  completedToday: boolean
): boolean {
  if (currentStreak === 0) return false;
  if (completedToday) return false;
  return isScheduledToday(frequency);
}

/**
 * Returns a 0-100 weekly consistency score across all active habits.
 * Score = average completion rate (per habit) over the last 7 days.
 * Habits with no scheduled days in the window are excluded.
 */
export function weeklyConsistencyScore(
  habits: HabitWithFrequency[],
  completions: CompletionRow[]
): number {
  const active = habits.filter((h) => !h.is_archived);
  if (active.length === 0) return 0;

  const todayStr = today();
  const completionSet = new Set(
    completions.map((c) => `${c.habit_id}:${c.completed_date}`)
  );

  let totalRate = 0;
  let counted = 0;

  for (const habit of active) {
    let scheduled = 0;
    let completed = 0;

    for (let i = 0; i < 7; i++) {
      const dateStr = subtractDays(todayStr, i);
      if (isScheduledOn(habit.frequency, dateStr)) {
        scheduled++;
        if (completionSet.has(`${habit.id}:${dateStr}`)) completed++;
      }
    }

    if (scheduled > 0) {
      totalRate += completed / scheduled;
      counted++;
    }
  }

  return counted === 0 ? 0 : Math.round((totalRate / counted) * 100);
}
