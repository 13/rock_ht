import type { Frequency } from "@rock_ht/types";

/** Plain trigger description; mapped to expo-notifications inputs on device. */
export type ReminderTrigger =
  | { kind: "daily"; hour: number; minute: number }
  /** weekday: 1 = Sunday … 7 = Saturday (expo-notifications WEEKLY convention) */
  | { kind: "weekly"; weekday: number; hour: number; minute: number };

export function parseReminderTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function reminderTriggers(frequency: Frequency, time: string): ReminderTrigger[] {
  const t = parseReminderTime(time);
  if (!t) return [];
  switch (frequency.type) {
    case "specific_days":
      return [...new Set(frequency.days)]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => ({ kind: "weekly" as const, weekday: d + 1, ...t }));
    case "daily":
    case "times_per_week":
      // times_per_week has no fixed days: remind daily.
      return [{ kind: "daily", ...t }];
  }
}
