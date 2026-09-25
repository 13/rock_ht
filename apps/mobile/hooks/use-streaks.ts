import { useQuery } from "@tanstack/react-query";
import { calculateStreak, parseFrequency } from "@rock_ht/utils";
import type { StreakRow } from "@rock_ht/types";
import { useLocal } from "@/providers/local-provider";

export const STREAKS_KEY = ["streaks"] as const;

/** Streaks are derived locally from completions; the server cache table is not synced. */
export function useStreaks() {
  const { store, userId } = useLocal();
  const query = useQuery({
    queryKey: STREAKS_KEY,
    queryFn: async (): Promise<StreakRow[]> => {
      const [habits, completions] = await Promise.all([
        store.listHabits(userId, { includeArchived: true }),
        store.listCompletions(userId),
      ]);
      const byHabit = new Map<string, string[]>();
      for (const c of completions) {
        const list = byHabit.get(c.habit_id) ?? [];
        list.push(c.completed_date);
        byHabit.set(c.habit_id, list);
      }
      return habits.map((h) => {
        const r = calculateStreak(byHabit.get(h.id) ?? [], parseFrequency(h.frequency));
        return {
          habit_id: h.id,
          user_id: userId,
          current_streak: r.current_streak,
          longest_streak: r.longest_streak,
          last_completed_date: r.last_completed_date,
          updated_at: h.updated_at,
        };
      });
    },
  });
  return { streaks: query.data ?? [] };
}

export function useHabitCompletions(habitId: string) {
  const { store, userId } = useLocal();
  return useQuery({
    queryKey: ["completions", "habit", habitId],
    queryFn: () => store.listCompletions(userId, { habitId }),
  });
}
