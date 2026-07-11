import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

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

export async function scheduleHabitReminder(
  habitId: string,
  habitTitle: string,
  habitIcon: string,
  reminderTime: string // "HH:MM"
): Promise<string> {
  const [hoursStr, minutesStr] = reminderTime.split(":");
  const hours = parseInt(hoursStr ?? "9", 10);
  const minutes = parseInt(minutesStr ?? "0", 10);

  // Cancel existing reminder for this habit first
  await cancelHabitReminder(habitId);

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${habitIcon} ${habitTitle}`,
      body: "Time for your habit! Keep the streak going.",
      data: { habitId },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: hours,
      minute: minutes,
    },
  });

  return identifier;
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
      title: "✨ sisiGo",
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

const DIGEST_IDENTIFIER_KEY = "sisigo-daily-digest";

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
