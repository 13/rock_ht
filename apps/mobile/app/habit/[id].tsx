import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useHabits } from "@/hooks/use-habits";
import { useAuth } from "@/providers/supabase-provider";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MobileHabitForm } from "@/components/habits/mobile-habit-form";
import { StreakRing } from "@/components/habits/streak-ring";
import { supabase } from "@/lib/supabase";
import {
  getCompletions,
  getStreaks,
} from "@sisigo/db";
import {
  buildCompletionHeatmap,
  completionRate,
  completionsByDayOfWeek,
  formatFrequencyLabel,
  formatRelativeDay,
} from "@sisigo/utils";
import { hapticMedium, hapticWarning } from "@/lib/haptics";
import type { CreateHabitInput, HabitWithFrequency } from "@sisigo/types";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DOW_ORDERED = [1, 2, 3, 4, 5, 6, 0]; // Mon first

export default function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { habits, updateHabit, archiveHabit, deleteHabit } = useHabits();
  const [showEditSheet, setShowEditSheet] = useState(false);

  const habit = habits.find((h) => h.id === id);

  const { data: completions = [], isLoading: completionsLoading } = useQuery({
    queryKey: ["completions", "habit", id],
    queryFn: () => getCompletions(supabase, user!.id, { habitId: id }),
    enabled: !!user && !!id,
  });

  const { data: streaks = [] } = useQuery({
    queryKey: ["streaks"],
    queryFn: () => getStreaks(supabase, user!.id),
    enabled: !!user,
  });

  const streak = streaks.find((s) => s.habit_id === id);

  if (!habit) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#6b6b80" }}>Habit not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Narrowed alias so closures below see the non-undefined type
  const h = habit;

  const rate30 = completionRate(completions, h.frequency, 30);
  const heatmap = buildCompletionHeatmap(completions, 91); // 13 weeks
  const dowData = completionsByDayOfWeek(completions, h.frequency, 90);
  const dowOrdered = DOW_ORDERED.map((d) => dowData.find((x) => x.day === d)!);
  const recentCompletions = [...completions]
    .sort((a, b) => b.completed_date.localeCompare(a.completed_date))
    .slice(0, 8);

  const WEEKS = 13;
  const CELL = 11;
  const GAP = 2;

  async function handleEdit(input: CreateHabitInput) {
    await updateHabit({ id: h.id, ...input });
    setShowEditSheet(false);
  }

  function handleDelete() {
    hapticWarning();
    Alert.alert(
      "Delete habit",
      `Delete "${h.title}"? All completion history will be permanently removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteHabit(h.id);
            router.back();
          },
        },
      ]
    );
  }

  async function handleShare() {
    hapticMedium();
    const n = streak?.current_streak ?? 0;
    const text = `${h.icon} ${h.title} — ${n} day streak on sisiGo! Building habits one day at a time. ✨`;
    await Share.share({ message: text });
  }

  function handleArchive() {
    hapticMedium();
    archiveHabit(h.id);
    router.back();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 8,
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: "#6366f1", fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { hapticMedium(); setShowEditSheet(true); }} hitSlop={8}>
          <Text style={{ color: "#6366f1", fontSize: 16 }}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Habit identity */}
        <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: h.color + "22",
                borderWidth: 1.5,
                borderColor: h.color + "55",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 26 }}>{h.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: "#f4f4f8" }}>
                {h.title}
              </Text>
              {h.description ? (
                <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 2 }}>
                  {h.description}
                </Text>
              ) : null}
              <Text style={{ fontSize: 12, color: "#6b6b80", marginTop: 4 }}>
                {formatFrequencyLabel(h.frequency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Streak ring + stats */}
        <View
          style={{
            marginHorizontal: 20,
            padding: 20,
            backgroundColor: "#111118",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "#1e1e2a",
            flexDirection: "row",
            alignItems: "center",
            gap: 20,
            marginBottom: 16,
          }}
        >
          <StreakRing
            streak={streak?.current_streak ?? 0}
            progress={rate30 / 100}
            size={96}
          />
          <View style={{ flex: 1, gap: 8 }}>
            <View>
              <Text style={{ fontSize: 11, color: "#6b6b80", marginBottom: 1 }}>
                30-day rate
              </Text>
              <Text style={{ fontSize: 22, fontWeight: "700", color: "#f4f4f8" }}>
                {rate30}%
              </Text>
            </View>
            <View>
              <Text style={{ fontSize: 11, color: "#6b6b80", marginBottom: 1 }}>
                Best streak
              </Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#f4f4f8" }}>
                {streak?.longest_streak ?? 0} days
              </Text>
            </View>
          </View>
        </View>

        {/* 13-week heatmap */}
        <View
          style={{
            marginHorizontal: 20,
            padding: 16,
            backgroundColor: "#111118",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "#1e1e2a",
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: "#6b6b80",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 10,
            }}
          >
            13 weeks
          </Text>
          {completionsLoading ? (
            <ActivityIndicator color={h.color} size="small" />
          ) : (
            <View style={{ flexDirection: "row", gap: GAP }}>
              {Array.from({ length: WEEKS }).map((_, weekIdx) => {
                const startCell = weekIdx * 7;
                return (
                  <View key={weekIdx} style={{ gap: GAP }}>
                    {Array.from({ length: 7 }).map((_, dayIdx) => {
                      const cell = heatmap[startCell + dayIdx];
                      return (
                        <View
                          key={dayIdx}
                          style={{
                            width: CELL,
                            height: CELL,
                            borderRadius: 3,
                            backgroundColor: cell?.completed
                              ? h.color
                              : "#1e1e2a",
                            opacity: cell?.completed ? 0.85 : 1,
                          }}
                        />
                      );
                    })}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Day-of-week breakdown */}
        <View
          style={{
            marginHorizontal: 20,
            padding: 16,
            backgroundColor: "#111118",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "#1e1e2a",
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: "#6b6b80",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 12,
            }}
          >
            By day · 90 days
          </Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 60 }}>
            {dowOrdered.map((d) => {
              const barH = d.scheduled === 0 ? 4 : Math.max(4, (d.rate / 100) * 52);
              return (
                <View key={d.day} style={{ flex: 1, alignItems: "center" }}>
                  <View
                    style={{
                      width: "100%",
                      height: barH,
                      borderRadius: 4,
                      backgroundColor:
                        d.scheduled === 0 ? "#1e1e2a" : h.color,
                      opacity:
                        d.scheduled === 0
                          ? 1
                          : 0.25 + (d.rate / 100) * 0.75,
                      marginBottom: 4,
                    }}
                  />
                  <Text style={{ fontSize: 9, color: "#6b6b80" }}>
                    {DAY_LABELS[d.day]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Recent completions */}
        {recentCompletions.length > 0 && (
          <View
            style={{
              marginHorizontal: 20,
              padding: 16,
              backgroundColor: "#111118",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1e1e2a",
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: "#6b6b80",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 10,
              }}
            >
              Recent
            </Text>
            {recentCompletions.map((c, i) => (
              <View
                key={c.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 8,
                  borderBottomWidth: i < recentCompletions.length - 1 ? 1 : 0,
                  borderBottomColor: "#1e1e2a",
                }}
              >
                <Text style={{ fontSize: 13, color: "#f4f4f8" }}>
                  {formatRelativeDay(c.completed_date)}
                </Text>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: h.color,
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {/* Share */}
        {(streak?.current_streak ?? 0) > 0 && (
          <View style={{ marginHorizontal: 20, marginBottom: 10 }}>
            <TouchableOpacity
              onPress={handleShare}
              style={{
                paddingVertical: 13,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: `${h.color}50`,
                backgroundColor: `${h.color}10`,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 16 }}>🔗</Text>
              <Text style={{ color: h.color, fontSize: 14, fontWeight: "600" }}>
                Share streak
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Danger zone */}
        <View style={{ marginHorizontal: 20, gap: 10 }}>
          <TouchableOpacity
            onPress={handleArchive}
            style={{
              paddingVertical: 13,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#2d2d3a",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#9ca3af", fontSize: 14, fontWeight: "500" }}>
              Archive habit
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            style={{
              paddingVertical: 13,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#7f1d1d40",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#f87171", fontSize: 14, fontWeight: "500" }}>
              Delete habit
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit sheet */}
      <BottomSheet
        visible={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        snapPoint={0.92}
      >
        <MobileHabitForm
          initial={habit as unknown as HabitWithFrequency}
          onSubmit={handleEdit}
          onCancel={() => setShowEditSheet(false)}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}
