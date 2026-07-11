"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { HabitCard } from "./habit-card";
import { cn } from "@/lib/utils";
import type { HabitWithFrequency, StreakRow } from "@sisigo/types";

interface SortableHabitItemProps {
  habit: HabitWithFrequency;
  streak: StreakRow | null;
  completed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function SortableHabitItem({
  habit,
  streak,
  completed,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
}: SortableHabitItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: habit.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative group/sortable", isDragging && "opacity-60")}
    >
      {/* Drag handle — appears on hover */}
      <div
        {...attributes}
        {...listeners}
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-7 z-10",
          "h-8 w-6 flex items-center justify-center rounded-md",
          "text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing",
          "opacity-0 group-hover/sortable:opacity-100 transition-opacity duration-150"
        )}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <HabitCard
        habit={habit}
        streak={streak}
        completed={completed}
        onToggle={onToggle}
        onEdit={onEdit}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    </div>
  );
}

interface SortableHabitListProps {
  habits: HabitWithFrequency[];
  streakMap: Map<string, StreakRow>;
  completedTodayIds: Set<string>;
  onToggle: (habitId: string) => void;
  onEdit: (habit: HabitWithFrequency) => void;
  onArchive: (habitId: string) => void;
  onDelete: (habitId: string) => void;
  onReorder?: (orderedIds: string[]) => void;
}

export function SortableHabitList({
  habits,
  streakMap,
  completedTodayIds,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
  onReorder,
}: SortableHabitListProps) {
  const [items, setItems] = useState(habits.map((h) => h.id));

  // Sync external habit list with local order
  const currentIds = habits.map((h) => h.id).join(",");
  const localIds = items.join(",");
  if (
    currentIds !== localIds &&
    habits.length !== items.length
  ) {
    setItems(habits.map((h) => h.id));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // 8px drag threshold prevents accidental reorders
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onReorder) return;

      setItems((current) => {
        const oldIdx = current.indexOf(active.id as string);
        const newIdx = current.indexOf(over.id as string);
        const reordered = arrayMove(current, oldIdx, newIdx);
        onReorder(reordered);
        return reordered;
      });
    },
    [onReorder]
  );

  const habitById = new Map(habits.map((h) => [h.id, h]));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 pl-7">
          {items.map((id) => {
            const habit = habitById.get(id);
            if (!habit) return null;
            return (
              <SortableHabitItem
                key={id}
                habit={habit}
                streak={streakMap.get(id) ?? null}
                completed={completedTodayIds.has(id)}
                onToggle={() => onToggle(id)}
                onEdit={() => onEdit(habit)}
                onArchive={() => onArchive(id)}
                onDelete={() => onDelete(id)}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
