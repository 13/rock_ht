"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Check, Sparkles } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Header } from "@/components/layout/header";
import { JournalEntryCard } from "@/components/journal/journal-entry-card";
import { JournalEditor } from "@/components/journal/journal-editor";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useJournal } from "@/hooks/use-journal";
import { cn } from "@/lib/utils";
import { MOOD_EMOJIS, MOOD_LABELS } from "@rock_ht/types";
import type { CreateJournalEntryInput, JournalEntry } from "@rock_ht/types";

const MOODS = [1, 2, 3, 4, 5] as const;

export default function JournalPage() {
  const {
    entries,
    todayEntry,
    todayEntryLoading,
    isLoading,
    createEntry,
    updateEntry,
    deleteEntry,
    upsertTodayAsync,
    isCreating,
    isUpdating,
    isSavingToday,
  } = useJournal();

  const [showCreate, setShowCreate] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Today's inline entry state
  const [todayContent, setTodayContent] = useState("");
  const [todayMood, setTodayMood] = useState<number | null>(null);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const savedRef = useRef({ content: "", mood: null as number | null });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync today entry from server. The `setState` calls are moved to render
  // (see React docs "You Might Not Need an Effect"): whenever a new
  // todayEntry object arrives (mirrors the old `[todayEntry]` deps),
  // re-seed the local editable state from it. `savedRef` is a ref, which
  // can't be written during render, so it's still updated from an effect
  // with the same dependency and guard as before.
  const [syncedTodayEntry, setSyncedTodayEntry] = useState<typeof todayEntry>(null);
  if (todayEntry && todayEntry !== syncedTodayEntry) {
    setSyncedTodayEntry(todayEntry);
    setTodayContent(todayEntry.content);
    setTodayMood(todayEntry.mood);
  }

  useEffect(() => {
    if (todayEntry) {
      savedRef.current = { content: todayEntry.content, mood: todayEntry.mood };
    }
  }, [todayEntry]);

  const saveToday = useCallback(
    async (content: string, mood: number | null) => {
      if (!content.trim()) return;
      if (
        content === savedRef.current.content &&
        mood === savedRef.current.mood
      )
        return;
      savedRef.current = { content, mood };
      await upsertTodayAsync({ content, mood });
      setSavedIndicator(true);
      setTimeout(() => setSavedIndicator(false), 2000);
    },
    [upsertTodayAsync]
  );

  // Debounced save on content change
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToday(todayContent, todayMood);
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [todayContent, todayMood, saveToday]);

  function handleMoodSelect(m: number) {
    const next = todayMood === m ? null : m;
    setTodayMood(next);
    // Mood changes save immediately
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToday(todayContent, next), 300);
  }

  async function handleGeneratePrompt() {
    setLoadingPrompt(true);
    try {
      const res = await fetch("/api/ai/journal-prompt", { method: "POST" });
      if (res.ok) {
        const { prompt } = await res.json();
        if (prompt) {
          setTodayContent((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
        }
      }
    } catch {
      // Silently fail — user's textarea is untouched
    } finally {
      setLoadingPrompt(false);
    }
  }

  async function handleCreate(input: CreateJournalEntryInput) {
    await createEntry(input);
    setShowCreate(false);
  }

  async function handleUpdate(input: CreateJournalEntryInput) {
    if (!editingEntry) return;
    await updateEntry({ id: editingEntry.id, content: input.content, mood: input.mood });
    setEditingEntry(null);
  }

  // Historical entries (exclude today's daily entry if it's in the list)
  const historicalEntries = entries.filter(
    (e) => !(!e.habit_id && e.id === todayEntry?.id)
  );

  const grouped = historicalEntries.reduce<Record<string, JournalEntry[]>>((acc, entry) => {
    const month = format(parseISO(entry.entry_date), "MMMM yyyy");
    if (!acc[month]) acc[month] = [];
    acc[month]!.push(entry);
    return acc;
  }, {});

  const wordCount = todayContent.trim().split(/\s+/).filter(Boolean).length;

  return (
    <>
      <Header
        title="Journal"
        subtitle={`${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`}
      />

      <div className="p-6 max-w-2xl mx-auto space-y-8">
        {/* ── Today's Reflection ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-foreground">
                {format(new Date(), "EEEE, MMMM d")}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Today’s reflection
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleGeneratePrompt}
                disabled={loadingPrompt}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {loadingPrompt ? "Generating…" : "Inspire me"}
              </button>
              <div className="flex items-center gap-2 h-5">
                {isSavingToday && (
                  <span className="text-xs text-muted-foreground">Saving…</span>
                )}
                {savedIndicator && !isSavingToday && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-xs text-green-500"
                  >
                    <Check className="h-3 w-3" />
                    Saved
                  </motion.span>
                )}
              </div>
            </div>
          </div>

          {/* Mood picker */}
          <div className="flex gap-2 mb-4">
            {MOODS.map((m) => (
              <button
                key={m}
                onClick={() => handleMoodSelect(m)}
                title={MOOD_LABELS[m]}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border transition-all",
                  todayMood === m
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40 hover:bg-accent"
                )}
              >
                <span className="text-xl">{MOOD_EMOJIS[m]}</span>
                <span className="text-[10px] text-muted-foreground">
                  {MOOD_LABELS[m]}
                </span>
              </button>
            ))}
          </div>

          {/* Textarea */}
          {todayEntryLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <textarea
              value={todayContent}
              onChange={(e) => setTodayContent(e.target.value)}
              placeholder="How was your day? Reflect on your habits, celebrate wins, or just clear your head…"
              rows={5}
              className={cn(
                "w-full resize-none rounded-xl border border-border bg-secondary/30 px-4 py-3",
                "text-sm text-foreground placeholder:text-muted-foreground/60",
                "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
                "transition-colors"
              )}
            />
          )}

          {todayContent.trim() && (
            <p className="text-[11px] text-muted-foreground mt-1.5 text-right">
              {wordCount} word{wordCount !== 1 ? "s" : ""}
            </p>
          )}
        </motion.div>

        {/* ── Historical Entries ──────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Past entries
            </h3>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New entry
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-muted-foreground"
            >
              <p className="text-3xl mb-3">📔</p>
              <p className="text-sm">No past entries yet</p>
            </motion.div>
          ) : (
            <div className="space-y-8">
              {Object.entries(grouped).map(([month, monthEntries]) => (
                <div key={month}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {month}
                  </h4>
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {monthEntries.map((entry) => (
                        <JournalEntryCard
                          key={entry.id}
                          entry={entry}
                          onEdit={setEditingEntry}
                          onDelete={setDeletingId}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onOpenChange={setShowCreate}
        title="New journal entry"
        description="How was your day?"
      >
        <JournalEditor
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          isLoading={isCreating}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={!!editingEntry}
        onOpenChange={(open) => !open && setEditingEntry(null)}
        title="Edit entry"
      >
        {editingEntry && (
          <JournalEditor
            initial={editingEntry}
            onSubmit={handleUpdate}
            onCancel={() => setEditingEntry(null)}
            isLoading={isUpdating}
          />
        )}
      </Modal>

      {/* Delete Confirm */}
      <ConfirmModal
        open={!!deletingId}
        onOpenChange={(open) => !open && setDeletingId(null)}
        title="Delete entry"
        description="This journal entry will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deletingId) deleteEntry(deletingId);
          setDeletingId(null);
        }}
      />
    </>
  );
}
