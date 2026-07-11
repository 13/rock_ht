import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStreakEmoji } from "@sisigo/utils";

interface StreakBadgeProps {
  streak: number;
  className?: string;
  showLabel?: boolean;
}

export function StreakBadge({ streak, className, showLabel = true }: StreakBadgeProps) {
  if (streak === 0) return null;

  const emoji = getStreakEmoji(streak);
  const isHot = streak >= 7;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
        isHot
          ? "bg-streak/15 text-streak"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      <span className="text-[11px]">{emoji}</span>
      <span className="text-xs font-semibold tabular-nums">{streak}</span>
      {showLabel && (
        <span className="text-xs opacity-70">
          {streak === 1 ? "day" : "days"}
        </span>
      )}
    </div>
  );
}
