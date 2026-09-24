"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Sparkles } from "lucide-react";
import { Header } from "@/components/layout/header";
import { HabitCard } from "@/components/habits/habit-card";
import { HabitForm } from "@/components/habits/habit-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekInsightCard } from "@/components/analytics/week-insight-card";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import { useRealtimeSync } from "@/hooks/use-realtime";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useHabitReminders } from "@/hooks/use-web-notifications";
import { useJournal } from "@/hooks/use-journal";
import Link from "next/link";
import {
  filterTodayHabits,
  getMotivationalMessage,
  getDailyProgress,
  isScheduledOn,
  today,
  yesterday,
} from "@sisigo/utils";
import type { CreateHabitInput, HabitWithFrequency } from "@sisigo/types";

export default function DashboardPage() {
  const {
    habits,
    isLoading,
    createHabit,
    updateHabit,
    archiveHabit,
    deleteHabit,
  } = useHabits();
  const {
    completedTodayIds,
    toggleCompletion,
    monthCompletions,
    completedYesterdayIds,
    todayCompletionMap,
    logYesterday,
    isLoggingYesterday,
    updateNote,
  } = useCompletions();
  const { getStreak } = useStreaks();
  const { todayEntry } = useJournal();

  useRealtimeSync();
  useHabitReminders(habits);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithFrequency | null>(
    null
  );

  const openCreate = useCallback(() => setShowCreateModal(true), []);

  useKeyboardShortcuts({
    n: openCreate,
    " ": () => {
      // Space toggles the first incomplete today habit
      const todayHabits = filterTodayHabits(habits);
      const first = todayHabits.find((h) => !completedTodayIds.has(h.id));
      if (first) toggleCompletion({ habit_id: first.id, date: todayStr });
    },
  });

  const todayHabits = filterTodayHabits(habits);
  const { completed, total, percentage } = getDailyProgress(
    habits,
    completedTodayIds
  );
  const todayStr = today();
  const yesterdayStr = yesterday();

  // Habits scheduled yesterday that weren't completed (grace recovery candidates)
  const missedYesterdayHabits = habits.filter(
    (h) =>
      !h.is_archived &&
      !completedYesterdayIds.has(h.id) &&
      isScheduledOn(h.frequency, yesterdayStr)
  );

  async function handleCreate(input: CreateHabitInput) {
    await createHabit(input);
    setShowCreateModal(false);
  }

  async function handleUpdate(input: CreateHabitInput) {
    if (!editingHabit) return;
    await updateHabit({ id: editingHabit.id, ...input });
    setEditingHabit(null);
  }

  return (
    <>
      <Header title="Today" subtitle="Your daily habits" />

      <div className="p-6 max-w-2xl mx-auto">
        {/* Daily Progress Ring */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-6 mb-8 p-5 rounded-2xl bg-card border border-border"
        >
          <CircularProgress value={percentage} size={80} strokeWidth={7}>
            <span className="text-sm font-bold text-foreground">
              {percentage}%
            </span>
          </CircularProgress>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {getMotivationalMessage(completed, total)}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {completed} of {total} habits done
            </p>
          </div>
        </motion.div>

        {/* Week insight */}
        {!isLoading && habits.length > 0 && (
          <WeekInsightCard habits={habits} completions={monthCompletions} />
        )}

        {/* Habits List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Habits
            </h2>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add habit
              <kbd className="ml-1 text-[10px] opacity-60 bg-background/50 px-1 rounded">
                N
              </kbd>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full" />
              ))}
            </div>
          ) : todayHabits.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <p className="text-4xl mb-3">✨</p>
              <p className="text-foreground font-medium">No habits for today</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Add your first habit to get started
              </p>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add your first habit
              </Button>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {todayHabits.map((habit) => {
                const completion = todayCompletionMap.get(habit.id);
                return (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    streak={getStreak(habit.id)}
                    completed={completedTodayIds.has(habit.id)}
                    completionNote={completion?.note}
                    completionDate={todayStr}
                    onToggle={() =>
                      toggleCompletion({
                        habit_id: habit.id,
                        date: todayStr,
                      })
                    }
                    onEdit={() => setEditingHabit(habit)}
                    onArchive={() => archiveHabit(habit.id)}
                    onDelete={() => deleteHabit(habit.id)}
                    onNoteChange={(habitId, date, note) =>
                      updateNote({ habitId, date, note })
                    }
                  />
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Yesterday — Grace Recovery */}
        {!isLoading && missedYesterdayHabits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8"
          >
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Yesterday
              </h2>
              <span className="text-[10px] text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5 font-medium">
                Grace recovery
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Missed these yesterday? Log them now to preserve your streaks.
            </p>
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {missedYesterdayHabits.map((habit) => (
                  <motion.div
                    key={habit.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="group relative flex items-center gap-4 rounded-2xl border border-dashed border-border/60 p-4 bg-card/40"
                  >
                    <div
                      className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full opacity-30"
                      style={{ backgroundColor: habit.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg leading-none">{habit.icon}</span>
                        <span className="text-sm font-medium text-muted-foreground truncate">
                          {habit.title}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => logYesterday(habit.id)}
                      disabled={isLoggingYesterday}
                      className="shrink-0 text-xs font-medium text-amber-500 hover:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      Log yesterday
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* AI Coach nudge */}
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4"
          >
            <Link
              href="/coach"
              className="block rounded-2xl border border-primary/20 bg-primary/5 p-5 hover:bg-primary/10 transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Ask your AI coach
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Get personalized advice on your habits and streaks
                  </p>
                </div>
              </div>
            </Link>
          </motion.div>
        )}

        {/* Today's Reflection nudge */}
        {!isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8"
          >
            <Link
              href="/journal"
              className="block rounded-2xl border border-border bg-card p-5 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Today’s reflection
                  </p>
                  {todayEntry ? (
                    <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                      {todayEntry.content}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground/60 italic">
                      How was your day? Tap to write a reflection…
                    </p>
                  )}
                </div>
                <span className="text-2xl ml-4 shrink-0 group-hover:scale-110 transition-transform">
                  📔
                </span>
              </div>
            </Link>
          </motion.div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        title="New habit"
        description="Build something worth keeping."
      >
        <HabitForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={!!editingHabit}
        onOpenChange={(open) => !open && setEditingHabit(null)}
        title="Edit habit"
      >
        {editingHabit && (
          <HabitForm
            initial={editingHabit}
            onSubmit={handleUpdate}
            onCancel={() => setEditingHabit(null)}
          />
        )}
      </Modal>
    </>
  );
}
