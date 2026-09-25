import { View, Text, ScrollView, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { useHabits } from "@/hooks/use-habits";
import { useCompletions } from "@/hooks/use-completions";
import { useStreaks } from "@/hooks/use-streaks";
import {
  buildCompletionHeatmap,
  completionRate,
  weeklyConsistencyScore,
  checkAchievements,
  generateInsights,
  completionsByHour,
  RARITY_COLORS,
  today,
} from "@rock_ht/utils";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CELL_SIZE = 10;
const CELL_GAP = 2;
const WEEKS = 13;

function MiniHeatmap({
  color,
  habitId,
  completions,
}: {
  color: string;
  habitId: string;
  completions: { habit_id: string; completed_date: string; value: number }[];
}) {
  const data = buildCompletionHeatmap(
    completions.filter((c) => c.habit_id === habitId),
    WEEKS * 7
  );

  const totalDays = WEEKS * 7;
  const todayStr = today();

  // Build columns of 7 days each
  const columns: typeof data[] = [];
  for (let i = 0; i < data.length; i += 7) {
    columns.push(data.slice(i, i + 7));
  }

  return (
    <View style={{ flexDirection: "row", gap: CELL_GAP }}>
      {columns.map((week, wIdx) => (
        <View key={wIdx} style={{ gap: CELL_GAP }}>
          {week.map((day) => (
            <View
              key={day.date}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                borderRadius: 2,
                backgroundColor: day.completed ? color : "#1e1e2a",
                opacity: day.date > todayStr ? 0 : day.completed ? 1 : 0.4,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function AnalyticsScreen() {
  const { habits } = useHabits();
  const { monthCompletions } = useCompletions();

  const { streaks } = useStreaks();

  const activeHabits = habits.filter((h) => !h.is_archived);
  const score = weeklyConsistencyScore(habits, monthCompletions);
  const achievements = checkAchievements({
    habits,
    streaks,
    completions: monthCompletions,
  });
  const unlockedAchievements = achievements.filter((a) => a.unlocked);
  const insights = generateInsights(activeHabits, monthCompletions, streaks);
  const hourData = completionsByHour(monthCompletions);
  const maxHourCount = Math.max(...hourData.map((h) => h.count), 1);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", color: "#f4f4f8" }}>
          Analytics
        </Text>
        <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 2 }}>
          13-week overview
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
      >
        {/* Consistency score */}
        {activeHabits.length > 0 && (
          <View
            style={{
              backgroundColor: "#111118",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1e1e2a",
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            {/* Radial gauge */}
            <View style={{ width: 72, height: 72, alignItems: "center", justifyContent: "center" }}>
              <Svg
                width={72} height={72}
                style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
              >
                <Circle cx={36} cy={36} r={28} fill="none" stroke="#1e1e2a" strokeWidth={6} />
                <Circle
                  cx={36} cy={36} r={28} fill="none"
                  stroke="#6366f1" strokeWidth={6}
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 28} ${2 * Math.PI * 28}`}
                  strokeDashoffset={2 * Math.PI * 28 - (score / 100) * 2 * Math.PI * 28}
                />
              </Svg>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#f4f4f8" }}>{score}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: "#6b6b80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>
                Weekly Consistency
              </Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#f4f4f8" }}>
                {score >= 90 ? "Excellent" : score >= 75 ? "Great" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Starting out"}
              </Text>
              <View style={{ height: 4, backgroundColor: "#1e1e2a", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${score}%`, backgroundColor: "#6366f1", borderRadius: 2 }} />
              </View>
            </View>
          </View>
        )}

        {/* Achievements strip */}
        {unlockedAchievements.length > 0 && (
          <View
            style={{
              backgroundColor: "#111118",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1e1e2a",
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: "#6b6b80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
              Achievements · {unlockedAchievements.length}/{achievements.length}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {unlockedAchievements.map((a) => (
                <View
                  key={a.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: RARITY_COLORS[a.rarity] + "18",
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: RARITY_COLORS[a.rarity] + "35",
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{a.emoji}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: RARITY_COLORS[a.rarity] }}>
                    {a.title}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {/* Insights */}
        {insights.length > 0 && (
          <View
            style={{
              backgroundColor: "#111118",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1e1e2a",
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: "#6b6b80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 }}>
              Insights
            </Text>
            <View style={{ gap: 10 }}>
              {insights.slice(0, 4).map((insight) => {
                const borderColor =
                  insight.type === "strength" ? "#10b981"
                  : insight.type === "warning" ? "#f59e0b"
                  : insight.type === "milestone" ? "#8b5cf6"
                  : "#6366f1";
                return (
                  <View
                    key={insight.id}
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      paddingLeft: 10,
                      borderLeftWidth: 3,
                      borderLeftColor: borderColor,
                    }}
                  >
                    <Text style={{ fontSize: 18, lineHeight: 22 }}>{insight.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: "#f4f4f8", marginBottom: 2 }}>
                        {insight.title}
                      </Text>
                      <Text style={{ fontSize: 12, color: "#6b6b80", lineHeight: 17 }}>
                        {insight.body}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Time of day */}
        {monthCompletions.length >= 5 && (
          <View
            style={{
              backgroundColor: "#111118",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1e1e2a",
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: "#6b6b80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 }}>
              When you complete habits
            </Text>
            <View style={{ flexDirection: "row", alignItems: "flex-end", height: 48, gap: 2 }}>
              {hourData.map((d) => {
                const heightPct = d.count / maxHourCount;
                const isPeak = d.count === maxHourCount && d.count > 0;
                return (
                  <View
                    key={d.hour}
                    style={{
                      flex: 1,
                      height: Math.max(heightPct * 48, d.count > 0 ? 3 : 1),
                      borderRadius: 2,
                      backgroundColor: isPeak ? "#6366f1" : "#6366f140",
                    }}
                  />
                );
              })}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              {[0, 6, 12, 18, 23].map((h) => (
                <Text key={h} style={{ fontSize: 9, color: "#6b6b80" }}>
                  {h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
                </Text>
              ))}
            </View>
          </View>
        )}

        {activeHabits.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 64 }}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>📊</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#f4f4f8" }}>
              No data yet
            </Text>
            <Text style={{ fontSize: 13, color: "#6b6b80", marginTop: 4 }}>
              Start tracking habits to see stats here
            </Text>
          </View>
        ) : (
          activeHabits.map((habit) => {
            const habitCompletions = monthCompletions.filter(
              (c) => c.habit_id === habit.id
            );
            const rate = completionRate(habitCompletions, habit.frequency, 30);
            const streak = streaks?.find((s) => s.habit_id === habit.id);

            return (
              <View
                key={habit.id}
                style={{
                  backgroundColor: "#111118",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "#1e1e2a",
                  padding: 16,
                }}
              >
                {/* Habit header */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 20 }}>{habit.icon}</Text>
                    <View>
                      <Text
                        style={{ fontSize: 15, fontWeight: "600", color: "#f4f4f8" }}
                        numberOfLines={1}
                      >
                        {habit.title}
                      </Text>
                      <Text style={{ fontSize: 12, color: "#6b6b80" }}>
                        {rate}% last 30 days
                      </Text>
                    </View>
                  </View>
                  {streak && streak.current_streak > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        backgroundColor: "#f9741620",
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ fontSize: 13 }}>🔥</Text>
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "700",
                          color: "#f97316",
                        }}
                      >
                        {streak.current_streak}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Heatmap */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <MiniHeatmap
                    color={habit.color}
                    habitId={habit.id}
                    completions={monthCompletions}
                  />
                </ScrollView>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
