import type { LocalStore } from "@rock_ht/local-db";

const META_KEY = "habit_reminders_enabled";

export const REMINDERS_SETTING_KEY = ["settings", "habit-reminders"] as const;

/**
 * The global "Habit reminders" switch. Defaults to on: before the switch was
 * persisted, reminders were scheduled whenever notification permission allowed.
 */
export async function getRemindersEnabled(store: LocalStore): Promise<boolean> {
  return (await store.getMeta(META_KEY)) !== "0";
}

export async function setRemindersEnabled(store: LocalStore, enabled: boolean): Promise<void> {
  await store.setMeta(META_KEY, enabled ? "1" : "0");
}
