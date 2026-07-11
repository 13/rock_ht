"use client";

import { useMemo } from "react";
import { Flame, CheckCircle2, TrendingUp, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { HabitWithFrequency, StreakRow, CompletionRow } from "@sisigo/types";
import { completionRate } from "@sisigo/utils";

interface StatsOverviewProps {
  habits: HabitWithFrequency[];
  streaks: StreakRow[];
  completions: CompletionRow[];
}

export function StatsOverview({
  habits,
  streaks,
  completions,
}: StatsOverviewProps) {
  const stats = useMemo(() => {
    const activeHabits = habits.filter((h) => !h.is_archived);

    const bestStreak = Math.max(0, ...streaks.map((s) => s.longest_streak));
    const currentTopStreak = Math.max(0, ...streaks.map((s) => s.current_streak));

    const totalCompletions = completions.length;

    const avgRate =
      activeHabits.length === 0
        ? 0
        : Math.round(
            activeHabits.reduce((sum, habit) => {
              const habitCompletions = completions.filter(
                (c) => c.habit_id === habit.id
              );
              return sum + completionRate(habitCompletions, habit.frequency, 30);
            }, 0) / activeHabits.length
          );

    return { activeHabits: activeHabits.length, bestStreak, currentTopStreak, totalCompletions, avgRate };
  }, [habits, streaks, completions]);

  const cards = [
    {
      icon: Target,
      label: "Active habits",
      value: stats.activeHabits.toString(),
      sub: "currently tracking",
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      icon: CheckCircle2,
      label: "Total completions",
      value: stats.totalCompletions.toString(),
      sub: "all time",
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Flame,
      label: "Best streak",
      value: `${stats.bestStreak}d`,
      sub: `${stats.currentTopStreak}d current best`,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
    {
      icon: TrendingUp,
      label: "Avg completion",
      value: `${stats.avgRate}%`,
      sub: "last 30 days",
      color: "text-violet-500",
      bg: "bg-violet-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="border-border">
          <CardContent className="p-4">
            <div className={`inline-flex rounded-lg p-2 ${card.bg} mb-3`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {card.value}
            </p>
            <p className="text-xs font-medium text-muted-foreground mt-0.5">
              {card.label}
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              {card.sub}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
