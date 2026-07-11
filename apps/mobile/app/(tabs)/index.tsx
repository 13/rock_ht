import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SwipeableHabitRow } from "@/components/habits/swipeable-habit-row";
import { StreakRing } from "@/components/habits/streak-ring";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useRealtimeSync } from "@/hooks/use-realtime";
import { useAuth } from "@/providers/supabase-provider";
import {
  filterTodayHabits,
  getDailyProgress,
  getMotivationalMessage,
  isScheduledOn,
  today,
  yesterday,
} from "@sisigo/utils";
import { useQuery } from "@tanstack/react-query";
import { getStreaks } from "@sisigo/db";
import { supabase } from "@/lib/supabase";
import type { StreakRow } from "@sisigo/types";
import { useRouter } from "expo-router";

export default function TodayScreen() {
  const { user } = useAuth();
  const { habits, isLoading: habitsLoading, deleteHabit } = useHabits();
  const {
    completedTodayIds,
    completedYesterdayIds,
    toggleCompletion,
    logYesterday,
    isLoggingYesterday,
  } = useCompletions();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const todayStr = today();
  const yesterdayStr = yesterday();

  useRealtimeSync();

  const { data: streaks } = useQuery({
    queryKey: ["streaks"],
    queryFn: () => getStreaks(supabase, user!.id),
    enabled: !!user,
  });

  const streakMap = new Map<string, StreakRow>(
    (streaks ?? []).map((s) => [s.habit_id, s])
  );

  const todayHabits = filterTodayHabits(habits);
  const { completed, total, percentage } = getDailyProgress(
    habits,
    completedTodayIds
  );

  const bestStreak = Math.max(0, ...(streaks ?? []).map((s) => s.current_streak));

  const missedYesterdayHabits = habits.filter(
    (h) =>
      !h.is_archived &&
      !completedYesterdayIds.has(h.id) &&
      isScheduledOn(h.frequency, yesterdayStr)
  );

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
      <StatusBar style="light" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 13, color: "#6b6b80", marginBottom: 2 }}>
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </Text>
          <Text style={{ fontSize: 26, fontWeight: "700", color: "#f4f4f8" }}>
            Good {getGreeting()}
          </Text>
        </View>

        {/* Progress Ring */}
        <View
          style={{
            margin: 20,
            padding: 20,
            backgroundColor: "#111118",
            borderRadius: 24,
            borderWidth: 1,
            borderColor: "#1e1e2a",
            flexDirection: "row",
            alignItems: "center",
            gap: 20,
          }}
        >
          <StreakRing
            streak={bestStreak}
            progress={percentage / 100}
            size={100}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: "600", color: "#f4f4f8" }}>
              {getMotivationalMessage(completed, total)}
            </Text>
            <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 4 }}>
              {completed} of {total} habits done
            </Text>
          </View>
        </View>

        {/* Today's habits */}
        <View style={{ paddingHorizontal: 20 }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: "#6b6b80",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 12,
            }}
          >
            Today's Habits
          </Text>

          {habitsLoading ? (
            <View style={{ gap: 8 }}>
              {[...Array(4)].map((_, i) => (
                <View
                  key={i}
                  style={{
                    height: 72,
                    backgroundColor: "#111118",
                    borderRadius: 16,
                    opacity: 0.6 - i * 0.1,
                  }}
                />
              ))}
            </View>
          ) : todayHabits.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>✨</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#f4f4f8" }}>
                No habits for today
              </Text>
              <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 4 }}>
                Go to Habits tab to add some
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {todayHabits.map((habit) => (
                <SwipeableHabitRow
                  key={habit.id}
                  habit={habit}
                  streak={streakMap.get(habit.id) ?? null}
                  completed={completedTodayIds.has(habit.id)}
                  onToggle={() =>
                    toggleCompletion({ habit_id: habit.id, date: todayStr })
                  }
                  onDelete={() => deleteHabit(habit.id)}
                  onPress={() => router.push(`/habit/${habit.id}`)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Yesterday — Grace Recovery */}
        {!habitsLoading && missedYesterdayHabits.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: "#6b6b80",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                }}
              >
                Yesterday
              </Text>
              <View
                style={{
                  backgroundColor: "rgba(245,158,11,0.1)",
                  borderRadius: 12,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "600", color: "#f59e0b" }}>
                  Grace recovery
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: "#6b6b80", marginBottom: 10 }}>
              Missed these? Log now to save your streaks.
            </Text>
            <View style={{ gap: 8 }}>
              {missedYesterdayHabits.map((habit) => (
                <View
                  key={habit.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: "#111118",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "#1e1e2a",
                    borderStyle: "dashed",
                    padding: 14,
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 10,
                      bottom: 10,
                      width: 3,
                      borderRadius: 2,
                      backgroundColor: habit.color,
                      opacity: 0.3,
                    }}
                  />
                  <Text style={{ fontSize: 20 }}>{habit.icon}</Text>
                  <Text
                    style={{ flex: 1, fontSize: 14, color: "#9999aa", fontWeight: "500" }}
                    numberOfLines={1}
                  >
                    {habit.title}
                  </Text>
                  <TouchableOpacity
                    onPress={() => logYesterday(habit.id)}
                    disabled={isLoggingYesterday}
                    style={{
                      backgroundColor: "rgba(245,158,11,0.1)",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      opacity: isLoggingYesterday ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#f59e0b" }}>
                      Log yesterday
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
