import type { Frequency, HabitWithFrequency, CreateHabitInput } from "@sisigo/types";
import type { Json } from "@sisigo/types";
import { today } from "./dates";
import { isScheduledToday } from "./streaks";

export function parseFrequency(raw: unknown): Frequency {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "daily" };
  }

  const obj = raw as Record<string, unknown>;

  switch (obj["type"]) {
    case "daily":
      return { type: "daily" };
    case "specific_days":
      return {
        type: "specific_days",
        days: Array.isArray(obj["days"]) ? (obj["days"] as number[]) : [1, 2, 3, 4, 5],
      };
    case "times_per_week":
      return {
        type: "times_per_week",
        count: typeof obj["count"] === "number" ? obj["count"] : 3,
      };
    default:
      return { type: "daily" };
  }
}

export function frequencyToJson(frequency: Frequency): Json {
  return frequency as unknown as Json;
}

export function formatFrequencyLabel(frequency: Frequency): string {
  switch (frequency.type) {
    case "daily":
      return "Every day";
    case "specific_days": {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const sorted = [...frequency.days].sort((a, b) => a - b);
      if (sorted.length === 7) return "Every day";
      if (sorted.length === 5 && !sorted.includes(0) && !sorted.includes(6)) {
        return "Weekdays";
      }
      if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) {
        return "Weekends";
      }
      return sorted.map((d) => dayNames[d]).join(", ");
    }
    case "times_per_week":
      return `${frequency.count}× per week`;
  }
}

export function sortHabits(habits: HabitWithFrequency[]): HabitWithFrequency[] {
  return [...habits].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.title.localeCompare(b.title);
  });
}

export function filterTodayHabits(habits: HabitWithFrequency[]): HabitWithFrequency[] {
  return habits.filter(
    (h) => !h.is_archived && isScheduledToday(h.frequency)
  );
}

export function getDailyProgress(
  habits: HabitWithFrequency[],
  completedTodayIds: Set<string>
): { completed: number; total: number; percentage: number } {
  const todayHabits = filterTodayHabits(habits);
  const completed = todayHabits.filter((h) => completedTodayIds.has(h.id)).length;
  const total = todayHabits.length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, percentage };
}

export function createHabitDefaults(): Partial<CreateHabitInput> {
  return {
    icon: "✨",
    color: "#6366f1",
    frequency: { type: "daily" },
    target_value: 1,
    reminder_enabled: false,
  };
}

export function getStreakEmoji(streak: number): string {
  if (streak >= 365) return "🏆";
  if (streak >= 100) return "💎";
  if (streak >= 30) return "🔥";
  if (streak >= 14) return "⚡";
  if (streak >= 7) return "✨";
  if (streak >= 3) return "🌱";
  return "💫";
}

export function getMotivationalMessage(
  completed: number,
  total: number
): string {
  if (total === 0) return "Add your first habit!";
  const pct = total === 0 ? 0 : (completed / total) * 100;
  if (pct === 100) return "Perfect day! 🎉";
  if (pct >= 75) return "Almost there!";
  if (pct >= 50) return "Keep going!";
  if (pct >= 25) return "Good start!";
  if (completed === 0) return "Let's begin!";
  return "You've got this!";
}
