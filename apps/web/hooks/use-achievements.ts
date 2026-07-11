"use client";

import { useMemo } from "react";
import { useHabits } from "./use-habits";
import { useStreaks } from "./use-streaks";
import { useCompletions } from "./use-completions";
import { checkAchievements, weeklyConsistencyScore } from "@sisigo/utils";

export function useAchievements() {
  const { habits } = useHabits();
  const { streaks } = useStreaks();
  const { monthCompletions } = useCompletions();

  const achievements = useMemo(
    () => checkAchievements({ habits, streaks, completions: monthCompletions }),
    [habits, streaks, monthCompletions]
  );

  const score = useMemo(
    () => weeklyConsistencyScore(habits, monthCompletions),
    [habits, monthCompletions]
  );

  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return { achievements, unlocked, locked, score };
}
