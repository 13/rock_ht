import { useState, useEffect } from "react";
import {
  requestNotificationPermission,
  getNotificationPermissionStatus,
  scheduleHabitReminder,
  cancelHabitReminder,
  scheduleTestNotification,
} from "@/lib/notifications";
import type { HabitWithFrequency } from "@rock_ht/types";

export function useNotifications() {
  const [permissionStatus, setPermissionStatus] = useState<string>("undetermined");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getNotificationPermissionStatus()
      .then(setPermissionStatus)
      .finally(() => setIsLoading(false));
  }, []);

  async function requestPermission(): Promise<boolean> {
    const granted = await requestNotificationPermission();
    const status = await getNotificationPermissionStatus();
    setPermissionStatus(status);
    return granted;
  }

  async function enableHabitReminder(habit: HabitWithFrequency): Promise<void> {
    if (!habit.reminder_enabled || !habit.reminder_time) return;
    await scheduleHabitReminder(
      habit.id,
      habit.title,
      habit.icon,
      habit.reminder_time
    );
  }

  async function disableHabitReminder(habitId: string): Promise<void> {
    await cancelHabitReminder(habitId);
  }

  async function sendTest(): Promise<void> {
    await scheduleTestNotification();
  }

  return {
    permissionStatus,
    isGranted: permissionStatus === "granted",
    isLoading,
    requestPermission,
    enableHabitReminder,
    disableHabitReminder,
    sendTest,
  };
}
