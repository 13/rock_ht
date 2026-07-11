"use client";

import { useMemo } from "react";
import { subDays, format } from "date-fns";
import type { CompletionRow, HabitWithFrequency } from "@sisigo/types";
import { filterTodayHabits } from "@sisigo/utils";

interface WeeklyBarChartProps {
  habits: HabitWithFrequency[];
  completions: CompletionRow[];
}

export function WeeklyBarChart({ habits, completions }: WeeklyBarChartProps) {
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = subDays(today, 6 - i);
      const dateStr = format(date, "yyyy-MM-dd");
      const dayLabel = i === 6 ? "Today" : format(date, "EEE");

      const dayCompletions = completions.filter(
        (c) => c.completed_date === dateStr
      ).length;

      // Count habits scheduled that day
      const dayOfWeek = date.getDay();
      const scheduledCount = habits.filter((h) => {
        if (h.is_archived) return false;
        const freq = h.frequency;
        if (freq.type === "daily") return true;
        if (freq.type === "specific_days") return freq.days.includes(dayOfWeek);
        if (freq.type === "times_per_week") return true;
        return false;
      }).length;

      const rate = scheduledCount === 0 ? 0 : dayCompletions / scheduledCount;
      const isFuture = dateStr > format(today, "yyyy-MM-dd");

      return { dateStr, dayLabel, dayCompletions, scheduledCount, rate, isFuture };
    });
  }, [habits, completions]);

  const maxCount = Math.max(1, ...days.map((d) => d.scheduledCount));

  return (
    <div>
      <div className="flex items-end gap-2 h-24">
        {days.map((day) => {
          const heightPct = day.isFuture
            ? 0
            : Math.max(4, (day.scheduledCount / maxCount) * 100);
          const fillPct = day.isFuture
            ? 0
            : (day.dayCompletions / Math.max(1, day.scheduledCount)) * 100;

          return (
            <div
              key={day.dateStr}
              className="flex-1 flex flex-col items-center gap-1"
              title={
                day.isFuture
                  ? day.dayLabel
                  : `${day.dayLabel}: ${day.dayCompletions}/${day.scheduledCount} completed`
              }
            >
              {/* Count label */}
              {!day.isFuture && day.scheduledCount > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {day.dayCompletions}/{day.scheduledCount}
                </span>
              )}

              {/* Bar container */}
              <div
                className="relative w-full rounded-t-md overflow-hidden"
                style={{ height: `${heightPct}%` }}
              >
                {/* Background (total scheduled) */}
                <div className="absolute inset-0 bg-secondary rounded-t-md" />
                {/* Fill (completed) */}
                <div
                  className="absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500"
                  style={{
                    height: `${fillPct}%`,
                    backgroundColor:
                      fillPct === 100
                        ? "#22c55e"
                        : fillPct >= 50
                          ? "#6366f1"
                          : fillPct > 0
                            ? "#8b5cf6"
                            : "transparent",
                    opacity: day.isFuture ? 0.2 : 1,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Day labels */}
      <div className="flex gap-2 mt-1">
        {days.map((day) => (
          <div key={day.dateStr} className="flex-1 text-center">
            <span
              className={`text-[10px] font-medium ${
                day.dayLabel === "Today"
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {day.dayLabel}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3">
        {[
          { color: "#22c55e", label: "Perfect day" },
          { color: "#6366f1", label: "50%+ done" },
          { color: "#8b5cf6", label: "Partial" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
