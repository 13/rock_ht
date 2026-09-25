import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/supabase-provider";
import { supabase } from "@/lib/supabase";
import {
  getHabits,
  createHabit,
  updateHabit,
  archiveHabit,
  deleteHabit,
} from "@rock_ht/db";
import {
  scheduleHabitReminder,
  cancelHabitReminder,
  getNotificationPermissionStatus,
} from "@/lib/notifications";
import type {
  CreateHabitInput,
  HabitWithFrequency,
  UpdateHabitInput,
} from "@rock_ht/types";

export const HABITS_KEY = ["habits"] as const;

async function syncReminder(habit: HabitWithFrequency): Promise<void> {
  if (habit.reminder_enabled && habit.reminder_time) {
    const status = await getNotificationPermissionStatus();
    if (status === "granted") {
      const timeStr = habit.reminder_time.slice(0, 5); // "HH:MM"
      await scheduleHabitReminder(habit.id, habit.title, habit.icon, timeStr);
    }
  } else {
    await cancelHabitReminder(habit.id);
  }
}

export function useHabits() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => getHabits(supabase, user!.id),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateHabitInput) =>
      createHabit(supabase, user!.id, input),
    onSuccess: async (habit) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old ? [...old, habit] : [habit]
      );
      await syncReminder(habit);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateHabitInput) => updateHabit(supabase, input),
    onSuccess: async (habit) => {
      await syncReminder(habit);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: HABITS_KEY });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveHabit(supabase, id),
    onSuccess: async (_data, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== id)
      );
      await cancelHabitReminder(id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHabit(supabase, id),
    onSuccess: async (_data, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== id)
      );
      await cancelHabitReminder(id);
    },
  });

  return {
    habits: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createHabit: createMutation.mutateAsync,
    updateHabit: updateMutation.mutateAsync,
    archiveHabit: archiveMutation.mutate,
    deleteHabit: deleteMutation.mutate,
    isCreating: createMutation.isPending,
  };
}
