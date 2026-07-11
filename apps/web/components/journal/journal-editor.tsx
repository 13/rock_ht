"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOOD_EMOJIS, MOOD_LABELS } from "@sisigo/types";
import type { JournalEntry, CreateJournalEntryInput } from "@sisigo/types";

const MOODS = [1, 2, 3, 4, 5] as const;

interface JournalEditorProps {
  initial?: JournalEntry;
  onSubmit: (input: CreateJournalEntryInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function JournalEditor({
  initial,
  onSubmit,
  onCancel,
  isLoading = false,
}: JournalEditorProps) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function handleSubmit() {
    if (!content.trim()) return;
    await onSubmit({ content: content.trim(), mood });
  }

  return (
    <div className="space-y-4">
      {/* Mood picker */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          How are you feeling?
        </p>
        <div className="flex gap-2">
          {MOODS.map((m) => (
            <button
              key={m}
              onClick={() => setMood(mood === m ? null : m)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border transition-all",
                mood === m
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-accent"
              )}
            >
              <span className="text-xl">{MOOD_EMOJIS[m]}</span>
              <span className="text-[10px] text-muted-foreground">
                {MOOD_LABELS[m]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Text area */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write about your day, reflect on your habits, or just clear your head..."
        rows={7}
        className={cn(
          "w-full resize-none rounded-xl border border-border bg-secondary/30 px-4 py-3",
          "text-sm text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
          "transition-colors"
        )}
      />

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!content.trim() || isLoading}
        >
          {isLoading ? "Saving…" : initial ? "Update" : "Save entry"}
        </Button>
      </div>
    </div>
  );
}
