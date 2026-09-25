import { useState } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SwipeableHabitRow } from "@/components/habits/swipeable-habit-row";
import { MobileHabitForm } from "@/components/habits/mobile-habit-form";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import { today } from "@rock_ht/utils";
import { hapticMedium } from "@/lib/haptics";
import type { CreateHabitInput, HabitWithFrequency, StreakRow } from "@rock_ht/types";

export default function HabitsScreen() {
  const router = useRouter();
  const { habits, isLoading, createHabit, updateHabit, archiveHabit, deleteHabit, isCreating } = useHabits();
  const { completedTodayIds, toggleCompletion } = useCompletions();
  const todayStr = today();

  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithFrequency | null>(null);

  const { streaks } = useStreaks();

  const streakMap = new Map<string, StreakRow>(
    streaks.map((s) => [s.habit_id, s])
  );

  const activeHabits = habits.filter((h) => !h.is_archived);

  function confirmDelete(habit: HabitWithFrequency) {
    Alert.alert(
      "Delete Habit",
      `Delete "${habit.title}"? This will remove all completion history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteHabit(habit.id),
        },
      ]
    );
  }

  async function handleCreate(input: CreateHabitInput) {
    await createHabit(input);
    setShowCreateSheet(false);
  }

  async function handleUpdate(input: CreateHabitInput) {
    if (!editingHabit) return;
    await updateHabit({ id: editingHabit.id, ...input });
    setEditingHabit(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", color: "#f4f4f8" }}>
          Habits
        </Text>
        <Text style={{ fontSize: 13, color: "#6b6b80" }}>
          {activeHabits.length} active
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
      >
        {isLoading ? (
          <View style={{ gap: 8 }}>
            {[...Array(5)].map((_, i) => (
              <View
                key={i}
                style={{
                  height: 72,
                  backgroundColor: "#111118",
                  borderRadius: 16,
                  opacity: 0.6,
                }}
              />
            ))}
          </View>
        ) : activeHabits.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 64 }}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>🌱</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#f4f4f8" }}>
              No habits yet
            </Text>
            <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 4, marginBottom: 24 }}>
              Start building your routine
            </Text>
            <TouchableOpacity
              onPress={() => {
                hapticMedium();
                setShowCreateSheet(true);
              }}
              style={{
                backgroundColor: "#6366f1",
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 24,
              }}
            >
              <Text style={{ color: "white", fontWeight: "600", fontSize: 15 }}>
                Create first habit
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {activeHabits.map((habit) => (
              <SwipeableHabitRow
                key={habit.id}
                habit={habit}
                streak={streakMap.get(habit.id) ?? null}
                completed={completedTodayIds.has(habit.id)}
                onToggle={() =>
                  toggleCompletion({ habit_id: habit.id, date: todayStr })
                }
                onDelete={() => confirmDelete(habit)}
                onPress={() => router.push(`/habit/${habit.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => {
          hapticMedium();
          setShowCreateSheet(true);
        }}
        style={{
          position: "absolute",
          right: 20,
          bottom: 32,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: "#6366f1",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#6366f1",
          shadowOpacity: 0.5,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <Text style={{ color: "white", fontSize: 28, lineHeight: 32 }}>+</Text>
      </TouchableOpacity>

      {/* Create Sheet */}
      <BottomSheet
        visible={showCreateSheet}
        onClose={() => setShowCreateSheet(false)}
        title="New habit"
        snapPoint={0.85}
      >
        <MobileHabitForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateSheet(false)}
          isLoading={isCreating}
        />
      </BottomSheet>

      {/* Edit Sheet */}
      <BottomSheet
        visible={!!editingHabit}
        onClose={() => setEditingHabit(null)}
        title="Edit habit"
        snapPoint={0.85}
      >
        {editingHabit && (
          <MobileHabitForm
            initial={editingHabit}
            onSubmit={handleUpdate}
            onCancel={() => setEditingHabit(null)}
            isLoading={false}
          />
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}
