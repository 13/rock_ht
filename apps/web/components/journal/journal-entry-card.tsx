"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Pencil, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { MOOD_EMOJIS, MOOD_LABELS } from "@sisigo/types";
import type { JournalEntry } from "@sisigo/types";

interface JournalEntryCardProps {
  entry: JournalEntry;
  onEdit: (entry: JournalEntry) => void;
  onDelete: (entryId: string) => void;
}

export function JournalEntryCard({
  entry,
  onEdit,
  onDelete,
}: JournalEntryCardProps) {
  const [showActions, setShowActions] = useState(false);

  const formattedDate = format(parseISO(entry.entry_date), "EEEE, MMMM d");
  const moodEmoji = entry.mood ? MOOD_EMOJIS[entry.mood] : null;
  const moodLabel = entry.mood ? MOOD_LABELS[entry.mood] : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className="group relative bg-card border border-border rounded-2xl p-5"
    >
      {/* Date + mood row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {formattedDate}
          </span>
          {moodEmoji && (
            <span
              className="inline-flex items-center gap-1 text-xs bg-secondary rounded-full px-2 py-0.5"
              title={moodLabel ?? ""}
            >
              {moodEmoji}
              <span className="text-muted-foreground">{moodLabel}</span>
            </span>
          )}
        </div>

        {/* Hover actions */}
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            showActions ? "opacity-100" : "opacity-0"
          )}
        >
          <button
            onClick={() => onEdit(entry)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
        {entry.content}
      </p>
    </motion.div>
  );
}
