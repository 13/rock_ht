import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { today } from "@rock_ht/utils";

/**
 * The local calendar date (`yyyy-MM-dd`), kept correct across midnight rollover.
 *
 * `today()` alone is only correct at the instant it's called: a screen that computes
 * `todayStr` once at render keeps writing to the previous day if the app is left open (or
 * backgrounded and resumed) past local midnight. This hook re-reads `today()` when the app
 * comes back to the foreground and arms a timer for the next local midnight, re-arming itself
 * every day, so components always toggle/log against the current local date.
 */
export function useToday(): string {
  const [date, setDate] = useState(today());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function refresh() {
      setDate(today());
    }

    function armTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
        0
      );
      const ms = nextMidnight.getTime() - now.getTime();
      timerRef.current = setTimeout(() => {
        refresh();
        armTimer();
      }, ms);
    }

    armTimer();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        refresh();
        armTimer();
      }
    });

    return () => {
      sub.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return date;
}
