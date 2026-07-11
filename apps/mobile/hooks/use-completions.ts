import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "@/providers/supabase-provider";
import { supabase } from "@/lib/supabase";
import {
  getTodayCompletions,
  getLast30DaysCompletions,
  addCompletion,
  removeCompletion,
} from "@sisigo/db";
import { today, yesterday } from "@sisigo/utils";
import {
  enqueueCompletion,
  getQueue,
  removeFromQueue,
} from "@/lib/offline-queue";
import type { CompletionRow, ToggleCompletionInput } from "@sisigo/types";

export const TODAY_KEY = ["completions", "today"] as const;
export const MONTH_KEY = ["completions", "month"] as const;

export function useCompletions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const todayStr = today();
  const yesterdayStr = yesterday();

  const todayQuery = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => getTodayCompletions(supabase, user!.id, todayStr),
    enabled: !!user,
  });

  const monthQuery = useQuery({
    queryKey: MONTH_KEY,
    queryFn: () => getLast30DaysCompletions(supabase, user!.id),
    enabled: !!user,
  });

  const completedTodayIds = new Set(
    (todayQuery.data ?? []).map((c) => c.habit_id)
  );

  const completedYesterdayIds = new Set(
    (monthQuery.data ?? [])
      .filter((c) => c.completed_date === yesterdayStr)
      .map((c) => c.habit_id)
  );

  // Flush offline queue when back online
  const flushQueue = useCallback(async () => {
    if (!user) return;
    const queue = await getQueue();
    for (const item of queue) {
      try {
        if (item.action === "add") {
          await addCompletion(supabase, user.id, {
            habit_id: item.habit_id,
            date: item.date,
          });
        } else {
          await removeCompletion(supabase, item.habit_id, item.date);
        }
        await removeFromQueue(item.id);
      } catch {
        // Leave in queue to retry next time
      }
    }
    queryClient.invalidateQueries({ queryKey: TODAY_KEY });
    queryClient.invalidateQueries({ queryKey: MONTH_KEY });
    queryClient.invalidateQueries({ queryKey: ["streaks"] });
  }, [user, queryClient]);

  const toggleMutation = useMutation({
    mutationFn: async (input: ToggleCompletionInput) => {
      const isCompleted = completedTodayIds.has(input.habit_id);
      const { isConnected } = await NetInfo.fetch();

      if (!isConnected) {
        // Queue for later sync
        await enqueueCompletion({
          habit_id: input.habit_id,
          date: input.date,
          action: isCompleted ? "remove" : "add",
        });
        return { action: isCompleted ? "queued_remove" : "queued_add" } as const;
      }

      if (isCompleted) {
        await removeCompletion(supabase, input.habit_id, input.date);
        return { action: "removed" as const };
      } else {
        return addCompletion(supabase, user!.id, input);
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<CompletionRow[]>(TODAY_KEY);
      const isCompleted = completedTodayIds.has(input.habit_id);

      if (isCompleted) {
        queryClient.setQueryData<CompletionRow[]>(TODAY_KEY, (old) =>
          old?.filter((c) => c.habit_id !== input.habit_id)
        );
      } else {
        const optimistic: CompletionRow = {
          id: `opt-${input.habit_id}`,
          habit_id: input.habit_id,
          user_id: user!.id,
          completed_date: input.date,
          value: 1,
          note: null,
          created_at: new Date().toISOString(),
        };
        queryClient.setQueryData<CompletionRow[]>(TODAY_KEY, (old) =>
          old ? [...old, optimistic] : [optimistic]
        );
      }

      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TODAY_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TODAY_KEY });
      queryClient.invalidateQueries({ queryKey: MONTH_KEY });
      queryClient.invalidateQueries({ queryKey: ["streaks"] });
    },
  });

  const logYesterdayMutation = useMutation({
    mutationFn: (habitId: string) =>
      addCompletion(supabase, user!.id, { habit_id: habitId, date: yesterdayStr }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MONTH_KEY });
      queryClient.invalidateQueries({ queryKey: ["streaks"] });
    },
  });

  return {
    todayCompletions: todayQuery.data ?? [],
    monthCompletions: monthQuery.data ?? [],
    completedTodayIds,
    completedYesterdayIds,
    isLoading: todayQuery.isLoading,
    toggleCompletion: toggleMutation.mutate,
    logYesterday: logYesterdayMutation.mutate,
    isLoggingYesterday: logYesterdayMutation.isPending,
    flushQueue,
  };
}
