import { View, Text, TouchableOpacity } from "react-native";
import Animated, { FadeInRight, Layout } from "react-native-reanimated";
import { CompletionButton } from "./completion-button";
import { formatFrequencyLabel } from "@rock_ht/utils";
import type { HabitWithFrequency, StreakRow } from "@rock_ht/types";
import { useTheme } from "@/theme/theme-provider";

interface HabitRowProps {
  habit: HabitWithFrequency;
  streak: StreakRow | null;
  completed: boolean;
  onToggle: () => void;
  onPress?: () => void;
}

export function HabitRow({
  habit,
  streak,
  completed,
  onToggle,
  onPress,
}: HabitRowProps) {
  const { colors } = useTheme();
  const currentStreak = streak?.current_streak ?? 0;

  return (
    <Animated.View
      entering={FadeInRight.duration(300)}
      layout={Layout.springify()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 8,
        opacity: completed ? 0.7 : 1,
      }}
    >
      {/* Left accent */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 10,
          bottom: 10,
          width: 3,
          borderRadius: 2,
          backgroundColor: habit.color,
          opacity: completed ? 0.3 : 0.8,
        }}
      />

      <CompletionButton
        completed={completed}
        color={habit.color}
        onToggle={onToggle}
        size={34}
      />

      <TouchableOpacity style={{ flex: 1 }} onPress={onPress} activeOpacity={0.7}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 18 }}>{habit.icon}</Text>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: completed ? colors.textMuted : colors.foreground,
              textDecorationLine: completed ? "line-through" : "none",
              flex: 1,
            }}
            numberOfLines={1}
          >
            {habit.title}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            {formatFrequencyLabel(habit.frequency)}
          </Text>
          {currentStreak > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                backgroundColor: colors.streak + "20",
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 10,
              }}
            >
              <Text style={{ fontSize: 11 }}>🔥</Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.streak }}>
                {currentStreak}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
