"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { HabitInsight, InsightType } from "@rock_ht/utils";

const TYPE_STYLES: Record<InsightType, { border: string; bg: string; text: string }> = {
  strength: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-500/5",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
    text: "text-amber-600 dark:text-amber-400",
  },
  tip: {
    border: "border-l-indigo-500",
    bg: "bg-indigo-500/5",
    text: "text-indigo-600 dark:text-indigo-400",
  },
  milestone: {
    border: "border-l-violet-500",
    bg: "bg-violet-500/5",
    text: "text-violet-600 dark:text-violet-400",
  },
};

interface InsightCardProps {
  insight: HabitInsight;
  index: number;
}

function InsightCard({ insight, index }: InsightCardProps) {
  const styles = TYPE_STYLES[insight.type];
  const inner = (
    <div
      className={cn(
        "rounded-xl border border-border border-l-[3px] p-4 transition-colors",
        styles.border,
        styles.bg,
        insight.habitId ? "hover:bg-accent/50 cursor-pointer" : ""
      )}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5 shrink-0">{insight.emoji}</span>
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold leading-snug", styles.text)}>
            {insight.title}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {insight.body}
          </p>
        </div>
      </div>
    </div>
  );

  const wrapped = insight.habitId ? (
    <Link href={`/habits/${insight.habitId}`}>{inner}</Link>
  ) : (
    inner
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
    >
      {wrapped}
    </motion.div>
  );
}

interface InsightsPanelProps {
  insights: HabitInsight[];
  className?: string;
}

export function InsightsPanel({ insights, className }: InsightsPanelProps) {
  if (insights.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Insights
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {insights.map((insight, i) => (
          <InsightCard key={insight.id} insight={insight} index={i} />
        ))}
      </div>
    </div>
  );
}
