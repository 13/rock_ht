"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Pencil, Trophy, Flame, TrendingUp, Plus } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarHeatmap } from "@/components/analytics/calendar-heatmap";
import { DayOfWeekChart } from "@/components/analytics/day-of-week-chart";
import { StreakBadge } from "@/components/habits/streak-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useHabits } from "@/hooks/use-habits";
import { useStreaks } from "@/hooks/use-streaks";
import { useHabitCompletions } from "@/hooks/use-habit-completions";
import { useJournal } from "@/hooks/use-journal";
import { JournalEntryCard } from "@/components/journal/journal-entry-card";
import { JournalEditor } from "@/components/journal/journal-editor";
import { Modal } from "@/components/ui/modal";
import { BookOpen } from "lucide-react";
import {
  buildCompletionHeatmap,
  completionRate,
  completionsByDayOfWeek,
  formatFrequencyLabel,
  formatRelativeDay,
} from "@rock_ht/utils";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { JournalEntry } from "@rock_ht/types";

export default function HabitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { habits, isLoading: habitsLoading } = useHabits();
  const { getStreak } = useStreaks();
  const { completions, isLoading: completionsLoading } = useHabitCompletions(id);
  const {
    entries: habitJournalEntries,
    createEntry: createHabitEntry,
    updateEntry: updateHabitEntry,
    deleteEntry: deleteHabitEntry,
    isCreating: isCreatingNote,
    isUpdating: isUpdatingNote,
  } = useJournal(id);
  const [showAddNote, setShowAddNote] = useState(false);
  const [editingNote, setEditingNote] = useState<JournalEntry | null>(null);

  const isLoading = habitsLoading || completionsLoading;
  const habit = habits.find((h) => h.id === id);

  if (!isLoading && !habit) {
    notFound();
  }

  if (isLoading) {
    return (
      <>
        <Header title="Habit Detail" />
        <div className="p-6 max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </>
    );
  }

  if (!habit) return null;

  const streak = getStreak(habit.id);
  const heatmapData = buildCompletionHeatmap(completions, 364);
  const rate30 = completionRate(completions, habit.frequency, 30);
  const rate90 = completionRate(completions, habit.frequency, 90);
  const dowData = completionsByDayOfWeek(completions, habit.frequency, 90);
  const recentCompletions = [...completions]
    .sort((a, b) => b.completed_date.localeCompare(a.completed_date))
    .slice(0, 10);

  const statCards = [
    {
      icon: Flame,
      label: "Current streak",
      value: `${streak?.current_streak ?? 0}d`,
      sub: streak?.current_streak ? "Keep it going!" : "Start today",
    },
    {
      icon: Trophy,
      label: "Longest streak",
      value: `${streak?.longest_streak ?? 0}d`,
      sub: "Personal best",
    },
    {
      icon: TrendingUp,
      label: "30-day rate",
      value: `${rate30}%`,
      sub: `${rate90}% last 90 days`,
    },
  ];

  return (
    <>
      <Header
        title=""
        left={
          <Link href="/habits">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
              <ArrowLeft className="h-4 w-4" />
              Habits
            </Button>
          </Link>
        }
      />

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Habit header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between"
        >
          <div className="flex items-center gap-4">
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
              style={{ backgroundColor: habit.color + "20", border: `1.5px solid ${habit.color}40` }}
            >
              {habit.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{habit.title}</h1>
              {habit.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{habit.description}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {formatFrequencyLabel(habit.frequency)}
              </p>
            </div>
          </div>
          <Link href={`/habits?edit=${habit.id}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </Link>
        </motion.div>

        {/* Stat cards */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-3"
        >
          {statCards.map(({ icon: Icon, label, value, sub }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                    {label}
                  </span>
                </div>
                <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        {/* Year heatmap */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Past year</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <CalendarHeatmap data={heatmapData} color={habit.color} weeks={52} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Day-of-week breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">By day of week · 90 days</CardTitle>
            </CardHeader>
            <CardContent>
              <DayOfWeekChart data={dowData} color={habit.color} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent completions */}
        {recentCompletions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent completions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {recentCompletions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                  >
                    <span className="text-sm text-foreground">
                      {formatRelativeDay(c.completed_date)}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.note && (
                        <span className="text-xs text-muted-foreground max-w-48 truncate">
                          {c.note}
                        </span>
                      )}
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: habit.color }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Reflections (habit-tagged journal entries) */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  Reflections
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAddNote(true)}
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Add note
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {habitJournalEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No reflections yet. Add a note to capture your thoughts on this habit.
                </p>
              ) : (
                <div className="space-y-3">
                  {habitJournalEntries.map((entry) => (
                    <JournalEntryCard
                      key={entry.id}
                      entry={entry}
                      onEdit={setEditingNote}
                      onDelete={deleteHabitEntry}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Add note modal */}
      <Modal
        open={showAddNote}
        onOpenChange={setShowAddNote}
        title="Add reflection"
        description={`A note about your ${habit.title} habit`}
      >
        <JournalEditor
          onSubmit={async (input) => {
            await createHabitEntry({ ...input, habit_id: id });
            setShowAddNote(false);
          }}
          onCancel={() => setShowAddNote(false)}
          isLoading={isCreatingNote}
        />
      </Modal>

      {/* Edit note modal */}
      <Modal
        open={!!editingNote}
        onOpenChange={(open) => !open && setEditingNote(null)}
        title="Edit reflection"
      >
        {editingNote && (
          <JournalEditor
            initial={editingNote}
            onSubmit={async (input) => {
              await updateHabitEntry({ id: editingNote.id, content: input.content, mood: input.mood });
              setEditingNote(null);
            }}
            onCancel={() => setEditingNote(null)}
            isLoading={isUpdatingNote}
          />
        )}
      </Modal>
    </>
  );
}
