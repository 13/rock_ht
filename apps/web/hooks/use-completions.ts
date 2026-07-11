"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import { posthog } from "@/lib/posthog";
import {
  getLast30DaysCompletions,
  getTodayCompletions,
  addCompletion,
  removeCompletion,
  updateCompletionNote,
  type TypedSupabaseClient,
} from "@sisigo/db";
import { today, yesterday } from "@sisigo/utils";
import type { CompletionRow, ToggleCompletionInput } from "@sisigo/types";

export const COMPLETIONS_KEY = ["completions"] as const;
export const TODAY_COMPLETIONS_KEY = ["completions", "today"] as const;

function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

export function useCompletions() {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const todayStr = today();
  const yesterdayStr = yesterday();
  const db = asDbClient(supabase);

  const todayQuery = useQuery({
    queryKey: TODAY_COMPLETIONS_KEY,
    queryFn: () => getTodayCompletions(db, user!.id, todayStr),
    enabled: !!user,
  });

  const monthQuery = useQuery({
    queryKey: COMPLETIONS_KEY,
    queryFn: () => getLast30DaysCompletions(db, user!.id),
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

  // Map habitId → today's completion (for note access)
  const todayCompletionMap = new Map(
    (todayQuery.data ?? []).map((c) => [c.habit_id, c])
  );

  const toggleMutation = useMutation({
    mutationFn: async (input: ToggleCompletionInput) => {
      const isCompleted = completedTodayIds.has(input.habit_id);
      if (isCompleted) {
        await removeCompletion(db, input.habit_id, input.date);
        return { action: "removed" as const, input };
      } else {
        const completion = await addCompletion(db, user!.id, input);
        return { action: "added" as const, completion };
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: TODAY_COMPLETIONS_KEY });
      const previous = queryClient.getQueryData<CompletionRow[]>(TODAY_COMPLETIONS_KEY);
      const isCompleted = completedTodayIds.has(input.habit_id);

      if (isCompleted) {
        queryClient.setQueryData<CompletionRow[]>(TODAY_COMPLETIONS_KEY, (old) =>
          old?.filter((c) => c.habit_id !== input.habit_id)
        );
      } else {
        const optimistic: CompletionRow = {
          id: `optimistic-${input.habit_id}`,
          habit_id: input.habit_id,
          user_id: user!.id,
          completed_date: input.date,
          value: input.value ?? 1,
          note: input.note ?? null,
          created_at: new Date().toISOString(),
        };
        queryClient.setQueryData<CompletionRow[]>(TODAY_COMPLETIONS_KEY, (old) =>
          old ? [...old, optimistic] : [optimistic]
        );
      }

      return { previous };
    },
    onSuccess: (result) => {
      if (result.action === "added") {
        posthog.capture("habit_completed", { habit_id: result.completion.habit_id });
      }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TODAY_COMPLETIONS_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TODAY_COMPLETIONS_KEY });
      queryClient.invalidateQueries({ queryKey: COMPLETIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ["streaks"] });
    },
  });

  // Log a habit for yesterday (grace recovery)
  const logYesterdayMutation = useMutation({
    mutationFn: (habitId: string) =>
      addCompletion(db, user!.id, { habit_id: habitId, date: yesterdayStr }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COMPLETIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ["streaks"] });
    },
  });

  // Update the note on a completion
  const noteMutation = useMutation({
    mutationFn: ({ habitId, date, note }: { habitId: string; date: string; note: string }) =>
      updateCompletionNote(db, habitId, date, note),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TODAY_COMPLETIONS_KEY });
      queryClient.invalidateQueries({ queryKey: COMPLETIONS_KEY });
    },
  });

  return {
    todayCompletions: todayQuery.data ?? [],
    monthCompletions: monthQuery.data ?? [],
    completedTodayIds,
    completedYesterdayIds,
    todayCompletionMap,
    isLoading: todayQuery.isLoading,
    toggleCompletion: toggleMutation.mutate,
    isToggling: toggleMutation.isPending,
    logYesterday: logYesterdayMutation.mutate,
    isLoggingYesterday: logYesterdayMutation.isPending,
    updateNote: noteMutation.mutate,
  };
}
