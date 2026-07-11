import type { Tables } from "./database.types";

export type FrequencyType = "daily" | "specific_days" | "times_per_week";

export interface DailyFrequency {
  type: "daily";
}

export interface SpecificDaysFrequency {
  type: "specific_days";
  days: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
}

export interface TimesPerWeekFrequency {
  type: "times_per_week";
  count: number; // 1-7
}

export type Frequency =
  | DailyFrequency
  | SpecificDaysFrequency
  | TimesPerWeekFrequency;

export const PRESET_ICONS = [
  "✨", "🏃", "💪", "🧘", "📚", "💧", "🥗", "😴", "🎯", "🎨",
  "🎵", "💻", "🌿", "☀️", "🌙", "❤️", "🧠", "✍️", "🏋️", "🚴",
  "🧹", "🍎", "☕", "🫁", "🦷", "🌊", "🎭", "📝", "🔥", "⭐",
] as const;

export const PRESET_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
] as const;

export type HabitRow = Tables<"habits">;
export type CompletionRow = Tables<"habit_completions">;
export type StreakRow = Tables<"habit_streaks">;

export interface HabitWithFrequency extends Omit<HabitRow, "frequency"> {
  frequency: Frequency;
}

export interface HabitWithStreak extends HabitWithFrequency {
  streak: StreakRow | null;
  is_completed_today: boolean;
}

export interface DayCompletion {
  date: string; // YYYY-MM-DD
  completed: boolean;
  value: number;
}

export interface HabitStats {
  habit_id: string;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
  completion_rate_30d: number;
  last_completed_date: string | null;
  weekly_completions: DayCompletion[];
}

export interface CreateHabitInput {
  title: string;
  description?: string;
  icon: string;
  color: string;
  frequency: Frequency;
  target_value?: number;
  target_unit?: string;
  reminder_time?: string;
  reminder_enabled?: boolean;
}

export interface UpdateHabitInput extends Partial<CreateHabitInput> {
  id: string;
  sort_order?: number;
  is_archived?: boolean;
}

export interface ToggleCompletionInput {
  habit_id: string;
  date: string; // YYYY-MM-DD
  value?: number;
  note?: string;
}
