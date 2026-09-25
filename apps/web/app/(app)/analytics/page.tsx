"use client";

import { motion } from "framer-motion";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarHeatmap } from "@/components/analytics/calendar-heatmap";
import { StatsOverview } from "@/components/analytics/stats-overview";
import { WeeklyBarChart } from "@/components/analytics/weekly-bar-chart";
import { ConsistencyScore } from "@/components/analytics/consistency-score";
import { InsightsPanel } from "@/components/analytics/insights-panel";
import { TimeOfDayChart } from "@/components/analytics/time-of-day-chart";
import { StreakBadge } from "@/components/habits/streak-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import {
  buildCompletionHeatmap,
  completionRate,
  weeklyConsistencyScore,
  generateInsights,
} from "@rock_ht/utils";

export default function AnalyticsPage() {
  const { habits, isLoading: habitsLoading } = useHabits();
  const { monthCompletions } = useCompletions();
  const { getStreak, streaks } = useStreaks();

  const activeHabits = habits.filter((h) => !h.is_archived);
  const consistencyScore = weeklyConsistencyScore(habits, monthCompletions);
  const insights = generateInsights(activeHabits, monthCompletions, streaks);

  if (habitsLoading) {
    return (
      <>
        <Header title="Analytics" />
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Analytics" subtitle="Your consistency at a glance" />

      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Consistency score */}
        {activeHabits.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardContent className="pt-5 pb-4">
                <ConsistencyScore score={consistencyScore} />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Stats overview cards */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 }}
        >
          <StatsOverview
            habits={habits}
            streaks={streaks}
            completions={monthCompletions}
          />
        </motion.div>

        {/* Weekly bar chart */}
        {activeHabits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Last 7 days</CardTitle>
              </CardHeader>
              <CardContent>
                <WeeklyBarChart
                  habits={activeHabits}
                  completions={monthCompletions}
                />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.07 }}
          >
            <InsightsPanel insights={insights} />
          </motion.div>
        )}

        {/* Time of day */}
        {monthCompletions.length >= 5 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09 }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">When you complete habits</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeOfDayChart completions={monthCompletions} />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Per-habit heatmaps */}
        {activeHabits.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-foreground font-medium">No habits to analyze yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add habits and start tracking to see your data here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Habit heatmaps · 13 weeks
            </h2>
            {activeHabits.map((habit, i) => {
              const habitCompletions = monthCompletions.filter(
                (c) => c.habit_id === habit.id
              );
              const heatmapData = buildCompletionHeatmap(habitCompletions, 91);
              const rate = completionRate(habitCompletions, habit.frequency, 30);
              const streak = getStreak(habit.id);

              return (
                <motion.div
                  key={habit.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{habit.icon}</span>
                          <div>
                            <CardTitle className="text-sm">{habit.title}</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {rate}% completion · 30 days
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {streak && streak.current_streak > 0 && (
                            <StreakBadge streak={streak.current_streak} />
                          )}
                          {streak && streak.longest_streak > 0 && (
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground">Best</p>
                              <p className="text-xs font-semibold text-foreground tabular-nums">
                                {streak.longest_streak}d
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <CalendarHeatmap
                        data={heatmapData}
                        color={habit.color}
                        weeks={13}
                      />
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
