"use client";

import { useState, useEffect, useRef } from "react";
import type { HabitWithFrequency } from "@rock_ht/types";

export function useWebNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
  }, []);

  async function requestPermission(): Promise<boolean> {
    if (!supported) return false;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result === "granted";
  }

  function show(title: string, body: string): void {
    if (permission !== "granted" || !supported) return;
    new Notification(title, { body, icon: "/icons/icon-192.png", silent: false });
  }

  return { permission, supported, isGranted: permission === "granted", requestPermission, show };
}

// Runs in the background once mounted; fires browser notifications when a
// habit reminder time matches the current minute.
export function useHabitReminders(habits: HabitWithFrequency[]) {
  const { permission, supported } = useWebNotifications();
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supported || permission !== "granted") return;

    function check() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const timeKey = `${hh}:${mm}`;
      const dayKey = now.toDateString();

      for (const habit of habits) {
        if (!habit.reminder_enabled || !habit.reminder_time) continue;
        const target = habit.reminder_time.slice(0, 5); // "HH:MM"
        if (target !== timeKey) continue;

        const fireKey = `${habit.id}-${dayKey}-${timeKey}`;
        if (firedRef.current.has(fireKey)) continue;

        firedRef.current.add(fireKey);
        new Notification(`${habit.icon} ${habit.title}`, {
          body: "Time for your habit! Keep the streak going.",
          icon: "/icons/icon-192.png",
          silent: false,
        });
      }
    }

    check(); // immediate check on mount
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [habits, permission, supported]);
}
