import type { HabitWithFrequency, CompletionRow, StreakRow } from "@rock_ht/types";
import { isScheduledOn } from "./streaks";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
  rarity: AchievementRarity;
  unlocked: boolean;
  progress?: { current: number; target: number };
}

export interface AchievementInput {
  habits: HabitWithFrequency[];
  streaks: StreakRow[];
  completions: CompletionRow[];
}

type Checker = (input: AchievementInput) => {
  unlocked: boolean;
  progress?: { current: number; target: number };
};

const DEFINITIONS: Array<{
  id: string;
  title: string;
  description: string;
  emoji: string;
  rarity: AchievementRarity;
  check: Checker;
}> = [
  {
    id: "first_habit",
    title: "First Step",
    description: "Create your first habit",
    emoji: "🌱",
    rarity: "common",
    check: ({ habits }) => ({ unlocked: habits.length >= 1 }),
  },
  {
    id: "habit_collector",
    title: "Habit Collector",
    description: "Track 5 habits at once",
    emoji: "🎯",
    rarity: "common",
    check: ({ habits }) => {
      const active = habits.filter((h) => !h.is_archived).length;
      return { unlocked: active >= 5, progress: { current: Math.min(active, 5), target: 5 } };
    },
  },
  {
    id: "first_completion",
    title: "First Check",
    description: "Complete a habit for the first time",
    emoji: "✅",
    rarity: "common",
    check: ({ completions }) => ({ unlocked: completions.length >= 1 }),
  },
  {
    id: "completions_10",
    title: "Getting Going",
    description: "Log 10 habit completions",
    emoji: "📈",
    rarity: "common",
    check: ({ completions }) => ({
      unlocked: completions.length >= 10,
      progress: { current: Math.min(completions.length, 10), target: 10 },
    }),
  },
  {
    id: "completions_50",
    title: "Building Momentum",
    description: "Log 50 habit completions",
    emoji: "⚡",
    rarity: "common",
    check: ({ completions }) => ({
      unlocked: completions.length >= 50,
      progress: { current: Math.min(completions.length, 50), target: 50 },
    }),
  },
  {
    id: "completions_100",
    title: "Century Club",
    description: "Log 100 habit completions",
    emoji: "💯",
    rarity: "rare",
    check: ({ completions }) => ({
      unlocked: completions.length >= 100,
      progress: { current: Math.min(completions.length, 100), target: 100 },
    }),
  },
  {
    id: "completions_500",
    title: "Dedicated",
    description: "Log 500 habit completions",
    emoji: "🏅",
    rarity: "rare",
    check: ({ completions }) => ({
      unlocked: completions.length >= 500,
      progress: { current: Math.min(completions.length, 500), target: 500 },
    }),
  },
  {
    id: "completions_1000",
    title: "Thousand Days",
    description: "Log 1,000 habit completions",
    emoji: "🔱",
    rarity: "epic",
    check: ({ completions }) => ({
      unlocked: completions.length >= 1000,
      progress: { current: Math.min(completions.length, 1000), target: 1000 },
    }),
  },
  {
    id: "streak_3",
    title: "Spark",
    description: "Reach a 3-day streak on any habit",
    emoji: "✨",
    rarity: "common",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 3, progress: { current: Math.min(best, 3), target: 3 } };
    },
  },
  {
    id: "streak_7",
    title: "On Fire",
    description: "Reach a 7-day streak on any habit",
    emoji: "🔥",
    rarity: "common",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 7, progress: { current: Math.min(best, 7), target: 7 } };
    },
  },
  {
    id: "streak_14",
    title: "Two Weeks Strong",
    description: "Reach a 14-day streak on any habit",
    emoji: "💪",
    rarity: "rare",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 14, progress: { current: Math.min(best, 14), target: 14 } };
    },
  },
  {
    id: "streak_30",
    title: "Month Master",
    description: "Reach a 30-day streak on any habit",
    emoji: "🏆",
    rarity: "rare",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 30, progress: { current: Math.min(best, 30), target: 30 } };
    },
  },
  {
    id: "streak_100",
    title: "Centurion",
    description: "Reach a 100-day streak on any habit",
    emoji: "💎",
    rarity: "epic",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 100, progress: { current: Math.min(best, 100), target: 100 } };
    },
  },
  {
    id: "streak_365",
    title: "Year of Discipline",
    description: "Reach a 365-day streak on any habit",
    emoji: "👑",
    rarity: "legendary",
    check: ({ streaks }) => {
      const best = Math.max(0, ...streaks.map((s) => s.longest_streak));
      return { unlocked: best >= 365, progress: { current: Math.min(best, 365), target: 365 } };
    },
  },
  {
    id: "multi_streak",
    title: "Juggler",
    description: "Have 3 habits with active streaks at the same time",
    emoji: "🤹",
    rarity: "rare",
    check: ({ streaks }) => {
      const active = streaks.filter((s) => s.current_streak > 0).length;
      return { unlocked: active >= 3, progress: { current: Math.min(active, 3), target: 3 } };
    },
  },
  {
    id: "perfect_week",
    title: "Perfect Week",
    description: "Complete all scheduled habits for 7 consecutive days",
    emoji: "🌟",
    rarity: "epic",
    check: ({ habits, completions }) => {
      const active = habits.filter((h) => !h.is_archived);
      if (active.length === 0) return { unlocked: false };

      const completionSet = new Set(
        completions.map((c) => `${c.habit_id}:${c.completed_date}`)
      );
      const dates = [...new Set(completions.map((c) => c.completed_date))].sort();
      if (dates.length < 7) return { unlocked: false };

      for (let i = 0; i <= dates.length - 7; i++) {
        let allPerfect = true;
        for (let d = 0; d < 7; d++) {
          const date = dates[i + d]!;
          const scheduled = active.filter((h) => isScheduledOn(h.frequency, date));
          if (scheduled.some((h) => !completionSet.has(`${h.id}:${date}`))) {
            allPerfect = false;
            break;
          }
        }
        if (allPerfect) return { unlocked: true };
      }
      return { unlocked: false };
    },
  },
];

export function checkAchievements(input: AchievementInput): Achievement[] {
  return DEFINITIONS.map((def) => {
    const result = def.check(input);
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      emoji: def.emoji,
      rarity: def.rarity,
      unlocked: result.unlocked,
      progress: result.progress,
    };
  });
}

export const RARITY_COLORS: Record<AchievementRarity, string> = {
  common: "#6b7280",
  rare: "#6366f1",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

export const RARITY_LABELS: Record<AchievementRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};
