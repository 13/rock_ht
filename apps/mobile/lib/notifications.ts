import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { reminderTriggers, type ReminderTrigger } from "@rock_ht/utils";
import type { HabitWithFrequency } from "@rock_ht/types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const existing = (await Notifications.getPermissionsAsync()) as { status: string };
  if (existing.status === "granted") return true;

  const result = (await Notifications.requestPermissionsAsync()) as { status: string };
  return result.status === "granted";
}

export async function getNotificationPermissionStatus(): Promise<string> {
  const perms = (await Notifications.getPermissionsAsync()) as { status: string };
  return perms.status;
}

export type ReminderHabit = Pick<
  HabitWithFrequency,
  "id" | "title" | "icon" | "frequency" | "reminder_time" | "reminder_enabled" | "is_archived"
>;

function toExpoTrigger(t: ReminderTrigger): Notifications.SchedulableNotificationTriggerInput {
  return t.kind === "daily"
    ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute }
    : { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: t.weekday, hour: t.hour, minute: t.minute };
}

/** Replaces all reminders of one habit. Returns the scheduled notification ids. */
export async function scheduleHabitReminder(habit: ReminderHabit): Promise<string[]> {
  await cancelHabitReminder(habit.id);
  if (!habit.reminder_enabled || !habit.reminder_time || habit.is_archived) return [];
  const ids: string[] = [];
  for (const trigger of reminderTriggers(habit.frequency, habit.reminder_time)) {
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${habit.icon} ${habit.title}`,
          body: "Time for your habit! Keep the streak going.",
          data: { habitId: habit.id },
          sound: true,
        },
        trigger: toExpoTrigger(trigger),
      }),
    );
  }
  return ids;
}

/**
 * The local DB is the source of truth: cancel every habit reminder, then
 * schedule from `habits`. The daily digest (data.type) is left alone.
 */
export async function rebuildReminders(habits: ReminderHabit[]): Promise<number> {
  if ((await getNotificationPermissionStatus()) !== "granted") return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => typeof n.content.data?.["habitId"] === "string")
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  let count = 0;
  for (const habit of habits) count += (await scheduleHabitReminder(habit)).length;
  return count;
}

export async function cancelHabitReminder(habitId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const habitNotifications = scheduled.filter(
    (n) => n.content.data?.["habitId"] === habitId
  );
  await Promise.all(
    habitNotifications.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier)
    )
  );
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function scheduleTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "✨ rock",
      body: "Notifications are working! Keep building those habits.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
    },
  });
}

export async function getAllScheduledReminders(): Promise<
  Notifications.NotificationRequest[]
> {
  return Notifications.getAllScheduledNotificationsAsync();
}

const DIGEST_IDENTIFIER_KEY = "rock_ht-daily-digest";

export async function scheduleDailyDigest(
  hour = 20,
  minute = 0
): Promise<void> {
  // Cancel any existing digest notification
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const existing = all.find((n) => n.content.data?.["type"] === DIGEST_IDENTIFIER_KEY);
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing.identifier);
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "✨ Daily check-in",
      body: "How did your habits go today? Tap to log your progress.",
      data: { type: DIGEST_IDENTIFIER_KEY },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export async function cancelDailyDigest(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const existing = all.filter((n) => n.content.data?.["type"] === DIGEST_IDENTIFIER_KEY);
  await Promise.all(
    existing.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier)
    )
  );
}
