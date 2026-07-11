"use client";

import { cn } from "@/lib/utils";

interface DayBar {
  day: number;
  label: string;
  rate: number;
  scheduled: number;
}

interface DayOfWeekChartProps {
  data: DayBar[];
  color?: string;
}

export function DayOfWeekChart({ data, color = "#6366f1" }: DayOfWeekChartProps) {
  // Reorder Mon-Sun (Mon first)
  const ordered = [
    ...data.filter((d) => d.day !== 0),
    ...data.filter((d) => d.day === 0),
  ];

  const hasData = ordered.some((d) => d.scheduled > 0);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        Not enough data yet
      </div>
    );
  }

  return (
    <div className="flex items-end gap-1.5 h-24">
      {ordered.map((d) => {
        const height = d.scheduled === 0 ? 0 : Math.max(4, d.rate);
        const isUnscheduled = d.scheduled === 0;

        return (
          <div key={d.day} className="flex flex-col items-center gap-1.5 flex-1">
            <div className="relative w-full flex-1 flex items-end">
              <div
                className={cn(
                  "w-full rounded-t-md transition-all",
                  isUnscheduled ? "bg-border/40" : ""
                )}
                style={{
                  height: isUnscheduled ? "4px" : `${height}%`,
                  backgroundColor: isUnscheduled ? undefined : color,
                  opacity: isUnscheduled ? 1 : 0.2 + (d.rate / 100) * 0.8,
                }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
