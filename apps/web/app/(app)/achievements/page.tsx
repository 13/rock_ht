"use client";

import { motion } from "framer-motion";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsistencyScore } from "@/components/analytics/consistency-score";
import { useAchievements } from "@/hooks/use-achievements";
import { RARITY_COLORS, RARITY_LABELS } from "@sisigo/utils";
import type { Achievement } from "@sisigo/utils";
import { cn } from "@/lib/utils";

function AchievementBadge({ achievement, index }: { achievement: Achievement; index: number }) {
  const rarityColor = RARITY_COLORS[achievement.rarity];
  const hasProgress = achievement.progress && !achievement.unlocked;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
    >
      <div
        className={cn(
          "relative rounded-2xl border p-4 transition-all duration-150",
          achievement.unlocked
            ? "bg-card border-border hover:border-border/80"
            : "bg-card/40 border-border/40"
        )}
      >
        {/* Rarity glow for unlocked */}
        {achievement.unlocked && (
          <div
            className="absolute inset-0 rounded-2xl opacity-10 pointer-events-none"
            style={{ background: `radial-gradient(circle at top left, ${rarityColor}, transparent 70%)` }}
          />
        )}

        <div className="flex items-start gap-3">
          <div
            className={cn(
              "text-3xl shrink-0 transition-all",
              achievement.unlocked ? "" : "grayscale opacity-30"
            )}
          >
            {achievement.emoji}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p
                className={cn(
                  "text-sm font-semibold",
                  achievement.unlocked ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {achievement.title}
              </p>
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0"
                style={{
                  color: rarityColor,
                  backgroundColor: rarityColor + "18",
                }}
              >
                {RARITY_LABELS[achievement.rarity]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {achievement.description}
            </p>

            {/* Progress bar */}
            {hasProgress && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground">
                    {achievement.progress!.current}/{achievement.progress!.target}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round((achievement.progress!.current / achievement.progress!.target) * 100)}%
                  </span>
                </div>
                <div className="h-1 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all"
                    style={{
                      width: `${(achievement.progress!.current / achievement.progress!.target) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {achievement.unlocked && (
            <div
              className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: rarityColor + "25" }}
            >
              <span style={{ color: rarityColor, fontSize: 11, fontWeight: 700 }}>✓</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function AchievementsPage() {
  const { achievements, unlocked, locked, score } = useAchievements();

  return (
    <>
      <Header
        title="Achievements"
        subtitle={`${unlocked.length} of ${achievements.length} unlocked`}
      />

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Consistency score card */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="pt-5 pb-4">
              <ConsistencyScore score={score} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Unlocked */}
        {unlocked.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Unlocked · {unlocked.length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2">
                  {unlocked.map((a, i) => (
                    <AchievementBadge key={a.id} achievement={a} index={i} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Locked */}
        {locked.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Locked · {locked.length}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2">
                  {locked.map((a, i) => (
                    <AchievementBadge
                      key={a.id}
                      achievement={a}
                      index={unlocked.length + i}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </>
  );
}
