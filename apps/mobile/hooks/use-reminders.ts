import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import type { LocalStore } from "@rock_ht/local-db";
import { cancelAllHabitReminders, rebuildReminders } from "@/lib/notifications";
import { getRemindersEnabled } from "@/lib/reminder-settings";
import { useLocal } from "@/providers/local-provider";

// Every reminder-mutating call (a full rebuild, or a single habit's schedule/cancel in
// use-habits.ts) reads the OS's scheduled-notification list before writing to it. Two such
// calls running concurrently can both read the list before either writes, so a cancellation
// misses the other call's not-yet-visible write and habits end up with duplicate notifications.
// Serializing every call behind this promise chain makes each one wait for the previous to
// fully settle before it starts; a rejection is swallowed so one failure can't wedge the chain.
let reminderQueue: Promise<unknown> = Promise.resolve();

export function runReminderOp<T>(op: () => Promise<T>): Promise<T> {
  const result = reminderQueue.then(op, op);
  reminderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function rebuildRemindersFromStore(store: LocalStore, userId: string): Promise<number> {
  return runReminderOp(async () => {
    if (!(await getRemindersEnabled(store))) {
      await cancelAllHabitReminders();
      return 0;
    }
    return rebuildReminders(await store.listHabits(userId));
  });
}

/** Mount once: restores reminders after reinstall, restore, or an OS that dropped them. */
export function useRebuildRemindersOnLaunch(): void {
  const { store, userId } = useLocal();
  useEffect(() => {
    rebuildRemindersFromStore(store, userId).catch((e) => Sentry.captureException(e));
  }, [store, userId]);
}
