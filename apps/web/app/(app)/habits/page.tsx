"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Search, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { SortableHabitList } from "@/components/habits/sortable-habit-list";
import { HabitForm } from "@/components/habits/habit-form";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import { useRealtimeSync } from "@/hooks/use-realtime";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { today } from "@sisigo/utils";
import { cn } from "@/lib/utils";
import type { CreateHabitInput, HabitWithFrequency } from "@sisigo/types";

type Tab = "active" | "archived";

export default function HabitsPage() {
  const {
    habits,
    isLoading,
    createHabit,
    updateHabit,
    archiveHabit,
    deleteHabit,
    reorderHabits,
  } = useHabits();
  const { completedTodayIds, toggleCompletion } = useCompletions();
  const { streakMap } = useStreaks();
  const searchParams = useSearchParams();
  const router = useRouter();

  useRealtimeSync();

  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithFrequency | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<HabitWithFrequency | null>(null);

  // Support ?edit=<id> deep-link from habit detail page
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId) {
      const habit = habits.find((h) => h.id === editId);
      if (habit) {
        setEditingHabit(habit);
        router.replace("/habits");
      }
    }
  }, [searchParams, habits]);

  const openCreate = useCallback(() => setShowCreateModal(true), []);
  useKeyboardShortcuts({ n: openCreate });

  const todayStr = today();
  const activeHabits = habits.filter((h) => !h.is_archived);
  const archivedHabits = habits.filter((h) => h.is_archived);

  const visibleHabits = (tab === "active" ? activeHabits : archivedHabits).filter(
    (h) =>
      !search ||
      h.title.toLowerCase().includes(search.toLowerCase()) ||
      (h.description ?? "").toLowerCase().includes(search.toLowerCase())
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

  async function handleConfirmDelete() {
    if (!deletingHabit) return;
    deleteHabit(deletingHabit.id);
    setDeletingHabit(null);
  }

  return (
    <>
      <Header
        title="Habits"
        subtitle={`${activeHabits.length} active · ${archivedHabits.length} archived`}
      />

      <div className="p-6 max-w-2xl mx-auto">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search habits…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-8 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
            {(["active", "archived"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 h-9 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <Button size="sm" onClick={openCreate} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" />
            Add
            <kbd className="ml-0.5 text-[10px] opacity-60 bg-background/30 px-1 rounded">
              N
            </kbd>
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2 pl-7">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full" />
            ))}
          </div>
        ) : visibleHabits.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <p className="text-4xl mb-3">{search ? "🔍" : tab === "archived" ? "📦" : "🌱"}</p>
            <p className="text-foreground font-medium">
              {search
                ? "No habits match your search"
                : tab === "archived"
                ? "No archived habits"
                : "No habits yet"}
            </p>
            {!search && tab === "active" && (
              <>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Start building your routine
                </p>
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create first habit
                </Button>
              </>
            )}
          </motion.div>
        ) : (
          <SortableHabitList
            habits={visibleHabits}
            streakMap={streakMap}
            completedTodayIds={completedTodayIds}
            onToggle={(id) =>
              toggleCompletion({ habit_id: id, date: todayStr })
            }
            onEdit={setEditingHabit}
            onArchive={archiveHabit}
            onDelete={(id) => {
              const h = visibleHabits.find((h) => h.id === id);
              if (h) setDeletingHabit(h);
            }}
            onReorder={tab === "active" && !search ? reorderHabits : undefined}
          />
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

      {/* Delete Confirm Modal */}
      <ConfirmModal
        open={!!deletingHabit}
        onOpenChange={(open) => !open && setDeletingHabit(null)}
        title="Delete habit"
        description={`Delete "${deletingHabit?.title}"? This will permanently remove all completion history and streak data.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
