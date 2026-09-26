import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import type { LocalStore } from "@rock_ht/local-db";
import { cancelAllHabitReminders, rebuildReminders } from "@/lib/notifications";
import { getRemindersEnabled } from "@/lib/reminder-settings";
import { useLocal } from "@/providers/local-provider";

export async function rebuildRemindersFromStore(store: LocalStore, userId: string): Promise<number> {
  if (!(await getRemindersEnabled(store))) {
    await cancelAllHabitReminders();
    return 0;
  }
  return rebuildReminders(await store.listHabits(userId));
}

/** Mount once: restores reminders after reinstall, restore, or an OS that dropped them. */
export function useRebuildRemindersOnLaunch(): void {
  const { store, userId } = useLocal();
  useEffect(() => {
    rebuildRemindersFromStore(store, userId).catch((e) => Sentry.captureException(e));
  }, [store, userId]);
}
