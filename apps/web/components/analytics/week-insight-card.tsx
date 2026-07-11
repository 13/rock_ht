"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { subtractDays, today, getDayOfWeek, isScheduledOn } from "@sisigo/utils";
import type { HabitWithFrequency, CompletionRow } from "@sisigo/types";

interface WeekInsightCardProps {
  habits: HabitWithFrequency[];
  completions: CompletionRow[];
}

function weekRate(
  habits: HabitWithFrequency[],
  completions: CompletionRow[],
  startOffset: number,
  days: number
): number {
  const todayStr = today();
  const completionSet = new Set(
    completions.map((c) => `${c.habit_id}:${c.completed_date}`)
  );
  let scheduled = 0;
  let completed = 0;

  for (let i = startOffset; i < startOffset + days; i++) {
    const dateStr = subtractDays(todayStr, i);
    for (const habit of habits) {
      if (habit.is_archived) continue;
      if (isScheduledOn(habit.frequency, dateStr)) {
        scheduled++;
        if (completionSet.has(`${habit.id}:${dateStr}`)) completed++;
      }
    }
  }

  return scheduled === 0 ? 0 : Math.round((completed / scheduled) * 100);
}

export function WeekInsightCard({ habits, completions }: WeekInsightCardProps) {
  const todayStr = today();
  // Days since Monday (Mon=0 in offset terms: Mon=1 DOW → offset 0 days back)
  const dow = getDayOfWeek(todayStr); // 0=Sun..6=Sat
  const daysSinceMon = dow === 0 ? 6 : dow - 1;

  const thisWeekRate = weekRate(habits, completions, 0, daysSinceMon + 1);
  const lastWeekRate = weekRate(habits, completions, daysSinceMon + 1, 7);
  const delta = thisWeekRate - lastWeekRate;

  const hasData = habits.filter((h) => !h.is_archived).length > 0;
  if (!hasData) return null;

  const DeltaIcon =
    delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor =
    delta > 0
      ? "text-green-500"
      : delta < 0
      ? "text-red-400"
      : "text-muted-foreground";

  return (
    <Card className="mb-6">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">
              This week
            </p>
            <p className="text-3xl font-bold text-foreground tabular-nums">
              {thisWeekRate}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">completion rate</p>
          </div>

          <div className="text-right">
            <div className={`flex items-center gap-1 justify-end ${deltaColor}`}>
              <DeltaIcon className="h-4 w-4" />
              <span className="text-sm font-semibold tabular-nums">
                {delta > 0 ? "+" : ""}{delta}%
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              vs last week ({lastWeekRate}%)
            </p>
          </div>
        </div>

        {/* Mini week bar — Mon through today */}
        <div className="flex gap-1 mt-3">
          {Array.from({ length: daysSinceMon + 1 }).map((_, i) => {
            const dateStr = subtractDays(todayStr, daysSinceMon - i);
            const dayHabits = habits.filter(
              (h) => !h.is_archived && isScheduledOn(h.frequency, dateStr)
            );
            const doneCount = dayHabits.filter((h) =>
              completions.some(
                (c) => c.habit_id === h.id && c.completed_date === dateStr
              )
            ).length;
            const rate =
              dayHabits.length === 0 ? 0 : doneCount / dayHabits.length;
            const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

            return (
              <div key={dateStr} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${rate * 100}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground">
                  {dayLabels[i]!}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
