"use client";

import { cn } from "@/lib/utils";
import type { CompletionRow } from "@sisigo/types";
import { completionsByHour } from "@sisigo/utils";

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

const SHOW_LABELS = [0, 6, 12, 18, 23];

const SESSION_BANDS = [
  { label: "Night", start: 0, end: 5, color: "bg-indigo-500/20" },
  { label: "Morning", start: 6, end: 11, color: "bg-amber-500/20" },
  { label: "Afternoon", start: 12, end: 17, color: "bg-orange-500/20" },
  { label: "Evening", start: 18, end: 23, color: "bg-violet-500/20" },
];

interface TimeOfDayChartProps {
  completions: CompletionRow[];
  color?: string;
}

export function TimeOfDayChart({ completions, color = "hsl(var(--primary))" }: TimeOfDayChartProps) {
  const data = completionsByHour(completions);
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No completion timestamps yet
      </p>
    );
  }

  // Find peak session
  const sessionCounts = SESSION_BANDS.map((band) => ({
    ...band,
    count: data
      .filter((d) => d.hour >= band.start && d.hour <= band.end)
      .reduce((sum, d) => sum + d.count, 0),
  }));
  const peakSession = sessionCounts.reduce((a, b) => (a.count >= b.count ? a : b));

  return (
    <div>
      {/* Bars */}
      <div className="flex items-end gap-[3px] h-20">
        {data.map((d) => {
          const heightPct = max > 0 ? (d.count / max) * 100 : 0;
          const isPeak = d.count === max && d.count > 0;
          return (
            <div
              key={d.hour}
              className="flex-1 rounded-t-sm transition-all duration-300 group relative"
              style={{
                height: `${Math.max(heightPct, 2)}%`,
                backgroundColor: isPeak ? color : `${color}60`,
                minHeight: d.count > 0 ? 3 : 1,
              }}
              title={`${hourLabel(d.hour)}: ${d.count} completion${d.count !== 1 ? "s" : ""}`}
            />
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex mt-1">
        {data.map((d) => (
          <div key={d.hour} className="flex-1 text-center">
            {SHOW_LABELS.includes(d.hour) && (
              <span className="text-[9px] text-muted-foreground/60">
                {hourLabel(d.hour)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Session labels */}
      <div className="flex gap-3 mt-3 flex-wrap">
        {sessionCounts.map((band) => (
          <div key={band.label} className="flex items-center gap-1.5">
            <div
              className={cn("h-2 w-2 rounded-sm", band.color.replace("/20", "/60"))}
            />
            <span
              className={cn(
                "text-[10px]",
                band.label === peakSession.label
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              {band.label}
              {band.label === peakSession.label && " ·  peak"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
