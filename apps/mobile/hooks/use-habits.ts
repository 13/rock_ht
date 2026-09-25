import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
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
  if ((await getNotificationPermissionStatus()) === "granted") await scheduleHabitReminder(habit);
  else await cancelHabitReminder(habit.id);
}

export function useHabits() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => store.listHabits(userId),
  });

  // Habits and streaks both derive from listHabits; anything that changes a habit's
  // existence, frequency or archived state can change streak math too.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: HABITS_KEY });
    queryClient.invalidateQueries({ queryKey: ["streaks"] });
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateHabitInput) => store.createHabit(userId, input),
    onSuccess: async (habit) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old ? [...old, habit] : [habit]
      );
      await syncReminder(habit);
    },
    onSettled: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateHabitInput) => store.updateHabit(input),
    onSuccess: async (habit) => {
      await syncReminder(habit);
    },
    onSettled: invalidate,
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => store.updateHabit({ id, is_archived: true }),
    onSuccess: async (_data, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== id)
      );
      await cancelHabitReminder(id);
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => store.deleteHabit(id),
    onSuccess: async (_data, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== id)
      );
      await cancelHabitReminder(id);
    },
    onSettled: invalidate,
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
