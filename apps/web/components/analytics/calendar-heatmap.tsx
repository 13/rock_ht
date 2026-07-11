"use client";

import { useMemo } from "react";
import { subDays, addDays, format, parseISO, getDay } from "date-fns";
import { cn } from "@/lib/utils";
import type { DayCompletion } from "@sisigo/types";

interface CalendarHeatmapProps {
  data: DayCompletion[];
  color: string;
  weeks?: number;
}

const CELL = 12; // px — matches h-3 / w-3
const GAP = 4;   // px — matches gap-1
const STEP = CELL + GAP;

// Mon-aligned row labels (rows 0–6 = Mon–Sun)
const DOW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

export function CalendarHeatmap({ data, color, weeks = 13 }: CalendarHeatmapProps) {
  const completionMap = useMemo(
    () => new Map(data.map((d) => [d.date, d])),
    [data]
  );

  // Build the week-aligned grid independently of completion data
  const { grid, monthLabels } = useMemo(() => {
    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");

    // Oldest day we want to show
    const rangeStart = subDays(today, weeks * 7 - 1);
    const rangeStartStr = format(rangeStart, "yyyy-MM-dd");

    // Snap back to the Monday on or before rangeStart
    // (getDay() + 6) % 7  →  Mon=0, Tue=1, …, Sun=6
    const daysFromMonday = (getDay(rangeStart) + 6) % 7;
    let cursor = subDays(rangeStart, daysFromMonday);

    const columns: { date: string; inRange: boolean }[][] = [];

    while (true) {
      const week: { date: string; inRange: boolean }[] = [];

      for (let d = 0; d < 7; d++) {
        const dateStr = format(cursor, "yyyy-MM-dd");
        week.push({
          date: dateStr,
          inRange: dateStr >= rangeStartStr && dateStr <= todayStr,
        });
        cursor = addDays(cursor, 1);
      }

      columns.push(week);

      // cursor is now at next Monday; the week we just pushed ends on prev Sunday
      const weekEndStr = format(subDays(cursor, 1), "yyyy-MM-dd");
      if (weekEndStr >= todayStr) break;
    }

    // Month labels: one label per month, placed at the first column that enters
    // that month
    const labels: { col: number; label: string }[] = [];
    let lastMonth = "";

    columns.forEach((week, colIdx) => {
      // Use first in-range cell (or first cell) as the anchor
      const anchor = week.find((d) => d.inRange) ?? week[0]!;
      const month = format(parseISO(anchor.date), "MMM");
      if (month !== lastMonth) {
        labels.push({ col: colIdx, label: month });
        lastMonth = month;
      }
    });

    return { grid: columns, monthLabels: labels };
  }, [weeks]);

  return (
    <div className="flex gap-1">
      {/* Day-of-week labels — aligned to Mon-Sun rows */}
      <div className="flex flex-col gap-1 shrink-0">
        {/* Spacer matching the month-label row */}
        <div style={{ height: 16 }} />
        {DOW_LABELS.map((label, i) => (
          <div
            key={i}
            className="flex items-center justify-end pr-1"
            style={{ height: CELL }}
          >
            <span className="text-[9px] leading-none text-muted-foreground">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex flex-col gap-1 min-w-0">
        {/* Month labels */}
        <div className="relative" style={{ height: 16 }}>
          {monthLabels.map(({ col, label }) => (
            <span
              key={`${col}-${label}`}
              className="absolute text-[10px] text-muted-foreground"
              style={{ left: col * STEP }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Columns */}
        <div className="flex gap-1">
          {grid.map((week, weekIdx) => (
            <div key={weekIdx} className="flex flex-col gap-1">
              {week.map(({ date, inRange }) => {
                const day = inRange ? completionMap.get(date) : undefined;
                const completed = !!day?.completed;

                return (
                  <div
                    key={date}
                    title={
                      inRange
                        ? `${format(parseISO(date), "MMM d, yyyy")}${completed ? " — completed" : ""}`
                        : undefined
                    }
                    className={cn(
                      "rounded-[2px]",
                      inRange && "transition-opacity"
                    )}
                    style={{
                      width: CELL,
                      height: CELL,
                      backgroundColor: !inRange
                        ? "transparent"
                        : completed
                        ? color
                        : "hsl(var(--secondary))",
                      opacity: !inRange ? 0 : completed ? 1 : 0.4,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-1 justify-end">
          <span className="text-[10px] text-muted-foreground">Less</span>
          {[0.15, 0.35, 0.6, 0.85, 1].map((opacity) => (
            <div
              key={opacity}
              className="rounded-[2px]"
              style={{ width: CELL, height: CELL, backgroundColor: color, opacity }}
            />
          ))}
          <span className="text-[10px] text-muted-foreground">More</span>
        </div>
      </div>
    </div>
  );
}
