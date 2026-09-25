"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MoreHorizontal, Archive, Trash2, Pencil, BarChart2, Share2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CompletionButton } from "./completion-button";
import { StreakBadge } from "./streak-badge";
import { CompletionNoteInput } from "./completion-note-input";
import { ShareStreakModal } from "./share-streak-modal";
import { cn } from "@/lib/utils";
import { formatFrequencyLabel, isStreakAtRisk } from "@rock_ht/utils";
import type { HabitWithFrequency, StreakRow } from "@rock_ht/types";

interface HabitCardProps {
  habit: HabitWithFrequency;
  streak: StreakRow | null;
  completed: boolean;
  completionNote?: string | null;
  completionDate?: string;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onNoteChange?: (habitId: string, date: string, note: string) => void;
}

export function HabitCard({
  habit,
  streak,
  completed,
  completionNote,
  completionDate,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
  onNoteChange,
}: HabitCardProps) {
  const [showShare, setShowShare] = useState(false);
  const currentStreak = streak?.current_streak ?? 0;
  const atRisk = isStreakAtRisk(currentStreak, habit.frequency, completed);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      className={cn(
        "group relative flex items-center gap-4 rounded-2xl border p-4",
        "bg-card transition-colors duration-150",
        completed
          ? "border-border/50 bg-card/50"
          : "border-border hover:border-border/80"
      )}
    >
      {/* Colored left accent */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-opacity duration-200"
        style={{
          backgroundColor: habit.color,
          opacity: completed ? 0.3 : 0.7,
        }}
      />

      {/* Completion button */}
      <CompletionButton
        completed={completed}
        color={habit.color}
        onToggle={onToggle}
      />

      {/* Icon + Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{habit.icon}</span>
          <h3
            className={cn(
              "font-medium text-sm truncate transition-colors",
              completed ? "text-muted-foreground line-through" : "text-foreground"
            )}
          >
            {habit.title}
          </h3>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            {formatFrequencyLabel(habit.frequency)}
          </span>
          {currentStreak > 0 && (
            <StreakBadge streak={currentStreak} showLabel={false} />
          )}
          {atRisk && (
            <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 rounded-full px-1.5 py-0.5 leading-none">
              ⚡ Keep it going
            </span>
          )}
        </div>
        {completed && completionDate && onNoteChange && (
          <CompletionNoteInput
            habitId={habit.id}
            date={completionDate}
            initialNote={completionNote}
            onSave={onNoteChange}
            className="mt-1.5 pl-1"
          />
        )}
      </div>

      {/* Actions */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={cn(
              "h-7 w-7 rounded-lg flex items-center justify-center",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
              "opacity-0 group-hover:opacity-100 transition-all duration-150"
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={cn(
              "z-50 min-w-[140px] rounded-xl border border-border bg-card p-1",
              "shadow-lg shadow-black/10 animate-scale-in"
            )}
          >
            <DropdownMenu.Item asChild>
              <Link
                href={`/habits/${habit.id}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
              >
                <BarChart2 className="h-3.5 w-3.5" />
                View stats
              </Link>
            </DropdownMenu.Item>
            {currentStreak > 0 && (
              <DropdownMenu.Item
                onSelect={() => setShowShare(true)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share streak
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              onSelect={onEdit}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={onArchive}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={onDelete}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 cursor-pointer outline-none transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {showShare && (
        <ShareStreakModal
          open={showShare}
          onOpenChange={setShowShare}
          habit={habit}
          streak={streak}
        />
      )}
    </motion.div>
  );
}
