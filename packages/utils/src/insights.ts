import { format, parseISO, subDays } from "date-fns";
import type { HabitWithFrequency, StreakRow, CompletionRow } from "@sisigo/types";
import { isScheduledOn, completionRate } from "./streaks";
import { today } from "./dates";

export type InsightType = "strength" | "warning" | "tip" | "milestone";

export interface HabitInsight {
  id: string;
  type: InsightType;
  emoji: string;
  title: string;
  body: string;
  habitId?: string;
  priority: number; // lower = shown first
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function subtractDays(dateStr: string, n: number): string {
  return format(subDays(parseISO(dateStr), n), "yyyy-MM-dd");
}

// Completion rate for a single habit over N days
function habitRateForDays(
  habit: HabitWithFrequency,
  completions: CompletionRow[],
  days: number
): number {
  return completionRate(
    completions.filter((c) => c.habit_id === habit.id),
    habit.frequency,
    days
  );
}

// Returns 0-6 indexed rates (Sun=0..Sat=6)
function ratesByDayOfWeek(
  habits: HabitWithFrequency[],
  completions: CompletionRow[],
  lookback = 84 // 12 weeks
): number[] {
  const todayStr = today();
  const counts = Array(7).fill(0);
  const scheduled = Array(7).fill(0);

  for (let i = 0; i < lookback; i++) {
    const dateStr = subtractDays(todayStr, i);
    const dow = parseISO(dateStr).getDay();
    const completedSet = new Set(
      completions
        .filter((c) => c.completed_date === dateStr)
        .map((c) => c.habit_id)
    );

    for (const habit of habits) {
      if (!h_active(habit)) continue;
      if (isScheduledOn(habit.frequency, dateStr)) {
        scheduled[dow]!++;
        if (completedSet.has(habit.id)) counts[dow]!++;
      }
    }
  }

  return scheduled.map((s, i) => (s === 0 ? -1 : Math.round((counts[i]! / s) * 100)));
}

function h_active(h: HabitWithFrequency): boolean {
  return !h.is_archived;
}

export function completionsByHour(
  completions: CompletionRow[]
): { hour: number; count: number }[] {
  const counts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const c of completions) {
    if (!c.created_at) continue;
    const hour = new Date(c.created_at).getHours();
    if (hour >= 0 && hour < 24) counts[hour]!.count++;
  }
  return counts;
}

export function peakHour(completions: CompletionRow[]): number | null {
  const byHour = completionsByHour(completions);
  const max = Math.max(...byHour.map((h) => h.count));
  if (max === 0) return null;
  return byHour.find((h) => h.count === max)?.hour ?? null;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

export function generateInsights(
  habits: HabitWithFrequency[],
  completions: CompletionRow[],
  streaks: StreakRow[]
): HabitInsight[] {
  const insights: HabitInsight[] = [];
  const active = habits.filter(h_active);
  if (active.length === 0) return [];

  const todayStr = today();
  const completedTodayIds = new Set(
    completions.filter((c) => c.completed_date === todayStr).map((c) => c.habit_id)
  );
  const streakMap = new Map(streaks.map((s) => [s.habit_id, s]));

  // ── Streak milestones ────────────────────────────────────────────────────
  const MILESTONES = [7, 14, 30, 50, 100, 365];
  for (const habit of active) {
    const streak = streakMap.get(habit.id);
    if (!streak) continue;
    const n = streak.current_streak;
    if (MILESTONES.includes(n)) {
      insights.push({
        id: `milestone-${habit.id}-${n}`,
        type: "milestone",
        emoji: n >= 100 ? "🏆" : n >= 30 ? "💎" : "🔥",
        title: `${n}-day streak!`,
        body: `You've completed "${habit.title}" ${n} days in a row. Incredible consistency.`,
        habitId: habit.id,
        priority: 1,
      });
    }
  }

  // ── At-risk habits (streak > 2, not done today, scheduled today) ─────────
  const atRisk = active.filter((h) => {
    const s = streakMap.get(h.id);
    return (
      s &&
      s.current_streak > 2 &&
      !completedTodayIds.has(h.id) &&
      isScheduledOn(h.frequency, todayStr)
    );
  });
  if (atRisk.length > 0) {
    const names = atRisk
      .slice(0, 2)
      .map((h) => `"${h.title}"`)
      .join(" and ");
    insights.push({
      id: "at-risk",
      type: "warning",
      emoji: "⚡",
      title: "Streak at risk",
      body:
        atRisk.length === 1
          ? `${names} needs to be done today to keep the streak alive.`
          : `${names} ${atRisk.length > 2 ? `and ${atRisk.length - 2} more` : ""} need to be done today.`,
      priority: 2,
    });
  }

  // ── Best / worst day of week ─────────────────────────────────────────────
  const dowRates = ratesByDayOfWeek(active, completions);
  const validRates = dowRates.map((r, i) => ({ day: i, rate: r })).filter((x) => x.rate >= 0);

  if (validRates.length >= 2) {
    const best = validRates.reduce((a, b) => (a.rate >= b.rate ? a : b));
    const worst = validRates.reduce((a, b) => (a.rate <= b.rate ? a : b));

    if (best.rate >= 70) {
      insights.push({
        id: "best-day",
        type: "strength",
        emoji: "💪",
        title: `${DAY_NAMES[best.day]} is your strongest day`,
        body: `You complete ${best.rate}% of your habits on ${DAY_NAMES[best.day]}s. Keep that momentum.`,
        priority: 5,
      });
    }

    if (worst.rate >= 0 && worst.rate < 50 && worst.day !== best.day) {
      insights.push({
        id: "worst-day",
        type: "tip",
        emoji: "🎯",
        title: `${DAY_NAMES[worst.day]}s need attention`,
        body: `Only ${worst.rate}% completion on ${DAY_NAMES[worst.day]}s. Consider setting a reminder for that day.`,
        priority: 6,
      });
    }
  }

  // ── Most consistent habit ────────────────────────────────────────────────
  const rates30 = active.map((h) => ({
    habit: h,
    rate: habitRateForDays(h, completions, 30),
  }));
  const topHabit = rates30.reduce(
    (best, curr) => (curr.rate > best.rate ? curr : best),
    { habit: active[0]!, rate: -1 }
  );
  if (topHabit.rate >= 80) {
    insights.push({
      id: `top-habit-${topHabit.habit.id}`,
      type: "strength",
      emoji: "⭐",
      title: `${topHabit.habit.icon} "${topHabit.habit.title}" is your most reliable`,
      body: `${topHabit.rate}% completion over the last 30 days. This habit has become a real strength.`,
      habitId: topHabit.habit.id,
      priority: 7,
    });
  }

  // ── Habit needing attention (< 40% last 7 days, was better before) ───────
  const struggling = rates30.filter(({ rate }) => rate > 0 && rate < 40);
  if (struggling.length > 0) {
    const s = struggling[0]!;
    insights.push({
      id: `struggling-${s.habit.id}`,
      type: "warning",
      emoji: "📉",
      title: `"${s.habit.title}" needs a boost`,
      body: `Only ${s.rate}% completion this month. Try linking it to an existing routine.`,
      habitId: s.habit.id,
      priority: 4,
    });
  }

  // ── Week-over-week improvement ───────────────────────────────────────────
  const improvements = active.map((h) => {
    const thisWeek = habitRateForDays(h, completions, 7);
    const lastWeek = completionRate(
      completions
        .filter((c) => c.habit_id === h.id)
        .filter((c) => {
          const diff =
            (parseISO(todayStr).getTime() - parseISO(c.completed_date).getTime()) /
            86400000;
          return diff >= 7 && diff < 14;
        }),
      h.frequency,
      7
    );
    return { habit: h, delta: thisWeek - lastWeek, thisWeek };
  });
  const mostImproved = improvements
    .filter((x) => x.delta >= 20 && x.thisWeek >= 50)
    .sort((a, b) => b.delta - a.delta)[0];
  if (mostImproved) {
    insights.push({
      id: `improved-${mostImproved.habit.id}`,
      type: "strength",
      emoji: "📈",
      title: `"${mostImproved.habit.title}" is trending up`,
      body: `Up ${mostImproved.delta} percentage points vs last week. You're finding your rhythm.`,
      habitId: mostImproved.habit.id,
      priority: 8,
    });
  }

  // ── Time-of-day pattern ──────────────────────────────────────────────────
  const peak = peakHour(completions);
  if (peak !== null && completions.length >= 10) {
    const session =
      peak >= 5 && peak < 12
        ? "a morning person"
        : peak >= 12 && peak < 17
        ? "an afternoon achiever"
        : "an evening person";
    insights.push({
      id: "peak-hour",
      type: "tip",
      emoji: "🕐",
      title: `You're ${session}`,
      body: `Most habits are completed around ${hourLabel(peak)}. Schedule new habits around your peak time.`,
      priority: 9,
    });
  }

  // ── Total completion milestone ───────────────────────────────────────────
  const total = completions.length;
  const TOTAL_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
  const totalMilestone = TOTAL_MILESTONES.find((m) => total >= m && total < m + 5);
  if (totalMilestone) {
    insights.push({
      id: `total-${totalMilestone}`,
      type: "milestone",
      emoji: "🎉",
      title: `${totalMilestone} completions!`,
      body: `You've logged over ${totalMilestone} habit completions. Every tap adds up.`,
      priority: 3,
    });
  }

  return insights.sort((a, b) => a.priority - b.priority);
}
