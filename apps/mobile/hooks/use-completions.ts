import { useEffect } from "react";
import { AppState } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
import { subtractDays, today, yesterday } from "@rock_ht/utils";
import type { ToggleCompletionInput } from "@rock_ht/types";

/** Keys include the local date: a new day is a new cache entry. */
export const todayKey = (date: string) => ["completions", "today", date] as const;
export const monthKey = (date: string) => ["completions", "month", date] as const;

export function useCompletions() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();
  // Local calendar dates (P0 fix c6c4195); never toISOString().slice(0, 10).
  const todayStr = today();
  const yesterdayStr = yesterday();

  const todayQuery = useQuery({
    queryKey: todayKey(todayStr),
    queryFn: () => store.listCompletions(userId, { startDate: todayStr, endDate: todayStr }),
  });
  const monthQuery = useQuery({
    queryKey: monthKey(todayStr),
    queryFn: () => store.listCompletions(userId, { startDate: subtractDays(todayStr, 29), endDate: todayStr }),
  });

  const completedTodayIds = new Set((todayQuery.data ?? []).map((c) => c.habit_id));
  const completedYesterdayIds = new Set(
    (monthQuery.data ?? []).filter((c) => c.completed_date === yesterdayStr).map((c) => c.habit_id),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["completions"] });
    queryClient.invalidateQueries({ queryKey: ["streaks"] });
  };

  const toggleMutation = useMutation({
    mutationFn: (input: ToggleCompletionInput) =>
      store.setCompletion(userId, input, !completedTodayIds.has(input.habit_id)),
    onSettled: invalidate,
  });

  const logYesterdayMutation = useMutation({
    mutationFn: (habitId: string) => store.setCompletion(userId, { habit_id: habitId, date: yesterdayStr }, true),
    onSettled: invalidate,
  });

  // React Native has no window-focus refetch; an app resumed from the background after
  // midnight wouldn't otherwise re-render with the new day's query keys.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") queryClient.invalidateQueries({ queryKey: ["completions"] });
    });
    return () => sub.remove();
  }, [queryClient]);

  return {
    todayCompletions: todayQuery.data ?? [],
    monthCompletions: monthQuery.data ?? [],
    completedTodayIds,
    completedYesterdayIds,
    isLoading: todayQuery.isLoading,
    toggleCompletion: toggleMutation.mutate,
    logYesterday: logYesterdayMutation.mutate,
    isLoggingYesterday: logYesterdayMutation.isPending,
  };
}
