"use client";

import { cn } from "@/lib/utils";

interface ConsistencyScoreProps {
  score: number;
  className?: string;
}

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "Excellent", color: "text-green-500" };
  if (score >= 75) return { label: "Great", color: "text-emerald-400" };
  if (score >= 60) return { label: "Good", color: "text-primary" };
  if (score >= 40) return { label: "Fair", color: "text-amber-400" };
  return { label: "Getting started", color: "text-muted-foreground" };
}

export function ConsistencyScore({ score, className }: ConsistencyScoreProps) {
  const { label, color } = scoreLabel(score);
  const circumference = 2 * Math.PI * 36; // r=36
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={cn("flex items-center gap-5", className)}>
      {/* Radial gauge */}
      <div className="relative shrink-0">
        <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
          <circle
            cx="44"
            cy="44"
            r="36"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="7"
          />
          <circle
            cx="44"
            cy="44"
            r="36"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-foreground tabular-nums">
            {score}
          </span>
        </div>
      </div>

      {/* Labels */}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-0.5">
          Weekly consistency
        </p>
        <p className={cn("text-lg font-semibold", color)}>{label}</p>
        <div className="mt-1.5 h-1.5 w-32 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${score}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {score}/100 · last 7 days
        </p>
      </div>
    </div>
  );
}
