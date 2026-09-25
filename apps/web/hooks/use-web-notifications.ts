"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { HabitWithFrequency } from "@rock_ht/types";

function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function getSupportedSnapshot(): boolean {
  return isNotificationSupported();
}

function getServerSupportedSnapshot(): boolean {
  return false;
}

function getPermissionSnapshot(): NotificationPermission {
  return isNotificationSupported() ? Notification.permission : "default";
}

function getServerPermissionSnapshot(): NotificationPermission {
  return "default";
}

// No live updates to subscribe to — the browser has no permissionchange
// event with reliable cross-browser support; we just need the client-only
// snapshot below instead of the default SSR value.
function subscribeNoop(): () => void {
  return () => {};
}

export function useWebNotifications() {
  const supported = useSyncExternalStore(
    subscribeNoop,
    getSupportedSnapshot,
    getServerSupportedSnapshot
  );
  const detectedPermission = useSyncExternalStore(
    subscribeNoop,
    getPermissionSnapshot,
    getServerPermissionSnapshot
  );
  const [requestedPermission, setRequestedPermission] =
    useState<NotificationPermission | null>(null);
  const permission = requestedPermission ?? detectedPermission;

  async function requestPermission(): Promise<boolean> {
    if (!supported) return false;
    const result = await Notification.requestPermission();
    setRequestedPermission(result);
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
