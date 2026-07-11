"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import { useSubscription } from "./use-subscription";
import {
  getHabits,
  createHabit,
  updateHabit,
  archiveHabit,
  deleteHabit,
  reorderHabits,
  type TypedSupabaseClient,
} from "@sisigo/db";
import type {
  CreateHabitInput,
  HabitWithFrequency,
  UpdateHabitInput,
} from "@sisigo/types";
import { habitLimitForPlan } from "@sisigo/utils";

export const HABITS_KEY = ["habits"] as const;

// The ssr client is structurally identical to TypedSupabaseClient at runtime
function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

export function useHabits() {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const db = asDbClient(supabase);
  const { plan } = useSubscription();

  const query = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => getHabits(db, user!.id),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateHabitInput) => createHabit(db, user!.id, input),
    onSuccess: (newHabit) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old ? [...old, newHabit] : [newHabit]
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateHabitInput) => updateHabit(db, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: HABITS_KEY });
      const previous = queryClient.getQueryData<HabitWithFrequency[]>(HABITS_KEY);
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.map((h) => (h.id === input.id ? { ...h, ...input } : h))
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(HABITS_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: HABITS_KEY });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (habitId: string) => archiveHabit(db, habitId),
    onSuccess: (_data, habitId) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== habitId)
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (habitId: string) => deleteHabit(db, habitId),
    onSuccess: (_data, habitId) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== habitId)
      );
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      reorderHabits(
        db,
        orderedIds.map((id, index) => ({ id, sort_order: index }))
      ),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: HABITS_KEY });
      const previous = queryClient.getQueryData<HabitWithFrequency[]>(HABITS_KEY);
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) => {
        if (!old) return old;
        const byId = new Map(old.map((h) => [h.id, h]));
        return orderedIds
          .map((id) => byId.get(id))
          .filter((h): h is HabitWithFrequency => !!h);
      });
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(HABITS_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: HABITS_KEY });
    },
  });

  const habits = query.data ?? [];
  const activeHabits = habits.filter((h) => !h.is_archived);
  const limit = habitLimitForPlan(plan);
  const isAtHabitLimit = activeHabits.length >= limit;

  return {
    habits,
    isLoading: query.isLoading,
    error: query.error,
    createHabit: createMutation.mutateAsync,
    updateHabit: updateMutation.mutateAsync,
    archiveHabit: archiveMutation.mutate,
    deleteHabit: deleteMutation.mutate,
    reorderHabits: reorderMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isAtHabitLimit,
  };
}
