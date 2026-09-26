import { useEffect } from "react";
import { AppState } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
import { subtractDays } from "@rock_ht/utils";
import { useToday } from "@/hooks/use-today";
import { syncNow } from "@/lib/sync/service";
import type { CompletionRow, ToggleCompletionInput } from "@rock_ht/types";

/** Keys include the local date: a new day is a new cache entry. */
export const todayKey = (date: string) => ["completions", "today", date] as const;
export const monthKey = (date: string) => ["completions", "month", date] as const;

export function useCompletions() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();
  // Local calendar date, kept correct across midnight rollover (see use-today.ts); never
  // today()/yesterday() computed once at render, and never toISOString().slice(0, 10).
  const todayStr = useToday();
  const yesterdayStr = subtractDays(todayStr, 1);

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
    void syncNow(); // no-op while sync is Off
  };

  const toggleMutation = useMutation({
    mutationFn: (input: ToggleCompletionInput) => store.toggleCompletion(userId, input),
    onMutate: async (input: ToggleCompletionInput) => {
      const key = todayKey(todayStr);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CompletionRow[]>(key);
      queryClient.setQueryData<CompletionRow[]>(key, (old = []) => {
        const alreadyDone = old.some((c) => c.habit_id === input.habit_id);
        if (alreadyDone) return old.filter((c) => c.habit_id !== input.habit_id);
        const optimistic: CompletionRow = {
          id: `optimistic-${input.habit_id}-${input.date}`,
          habit_id: input.habit_id,
          user_id: userId,
          completed_date: input.date,
          value: input.value ?? 1,
          note: input.note ?? null,
          created_at: new Date().toISOString(),
        };
        return [...old, optimistic];
      });
      return { previous, key };
    },
    onError: (_err, _input, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: invalidate,
  });

  const logYesterdayMutation = useMutation({
    mutationFn: (habitId: string) => store.setCompletion(userId, { habit_id: habitId, date: yesterdayStr }, true),
    onSettled: invalidate,
  });

  // React Native has no window-focus refetch; an app resumed from the background (possibly
  // after local midnight) wouldn't otherwise re-render with the new day's query keys or
  // recompute streaks.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        queryClient.invalidateQueries({ queryKey: ["completions"] });
        queryClient.invalidateQueries({ queryKey: ["streaks"] });
      }
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
