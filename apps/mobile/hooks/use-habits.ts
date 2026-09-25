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

// A reminder scheduling/cancellation failure must never fail the mutation or roll
// back the already-applied optimistic UI, so every call here is best-effort.
async function syncReminder(habit: HabitWithFrequency): Promise<void> {
  try {
    // The OS permission status stands in for the app's global "Habit reminders"
    // setting: there's no separate persisted toggle, and rebuildRemindersFromStore
    // (Settings' own resync) gates on this same check.
    if ((await getNotificationPermissionStatus()) === "granted") {
      await scheduleHabitReminder(habit);
    } else {
      await cancelHabitReminder(habit.id);
    }
  } catch (e) {
    console.warn("[reminders] failed to sync reminder for habit", habit.id, e);
  }
}

async function cancelReminderSafely(id: string): Promise<void> {
  try {
    await cancelHabitReminder(id);
  } catch (e) {
    console.warn("[reminders] failed to cancel reminder for habit", id, e);
  }
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
      await cancelReminderSafely(id);
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => store.deleteHabit(id),
    onSuccess: async (_data, id) => {
      queryClient.setQueryData<HabitWithFrequency[]>(HABITS_KEY, (old) =>
        old?.filter((h) => h.id !== id)
      );
      await cancelReminderSafely(id);
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
