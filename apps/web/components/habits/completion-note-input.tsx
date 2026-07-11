"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CompletionNoteInputProps {
  habitId: string;
  date: string;
  initialNote?: string | null;
  onSave: (habitId: string, date: string, note: string) => void;
  className?: string;
}

export function CompletionNoteInput({
  habitId,
  date,
  initialNote,
  onSave,
  className,
}: CompletionNoteInputProps) {
  const [value, setValue] = useState(initialNote ?? "");
  const [focused, setFocused] = useState(false);
  const saved = useRef(initialNote ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync if initialNote changes (e.g., after a refetch)
  useEffect(() => {
    if (!focused) {
      setValue(initialNote ?? "");
      saved.current = initialNote ?? "";
    }
  }, [initialNote, focused]);

  function handleBlur() {
    setFocused(false);
    if (value !== saved.current) {
      saved.current = value;
      onSave(habitId, date, value);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    }
    if (e.key === "Escape") {
      setValue(saved.current);
      inputRef.current?.blur();
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="text-[11px] text-muted-foreground/60 shrink-0">📝</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="Add a note…"
        maxLength={200}
        className={cn(
          "flex-1 text-xs bg-transparent border-none outline-none",
          "text-muted-foreground placeholder:text-muted-foreground/40",
          "focus:text-foreground transition-colors"
        )}
      />
    </div>
  );
}
