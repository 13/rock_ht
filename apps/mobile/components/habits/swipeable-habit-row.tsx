import { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { hapticSuccess, hapticMedium, hapticError } from "@/lib/haptics";
import { isStreakAtRisk } from "@sisigo/utils";
import type { HabitWithFrequency, StreakRow } from "@sisigo/types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_COMPLETE_THRESHOLD = 72;
const SWIPE_DELETE_THRESHOLD = SCREEN_WIDTH * 0.45;
const SPRING = { damping: 18, stiffness: 180 };

interface SwipeableHabitRowProps {
  habit: HabitWithFrequency;
  streak: StreakRow | null;
  completed: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onPress: () => void;
}

export function SwipeableHabitRow({
  habit,
  streak,
  completed,
  onToggle,
  onDelete,
  onPress,
}: SwipeableHabitRowProps) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const isDeleting = useSharedValue(false);

  const handleToggle = useCallback(() => {
    hapticSuccess();
    onToggle();
  }, [onToggle]);

  const handleDelete = useCallback(() => {
    hapticError();
    onDelete();
  }, [onDelete]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
    })
    .onEnd((e) => {
      const total = translateX.value;

      // Swipe right: complete
      if (total > SWIPE_COMPLETE_THRESHOLD) {
        runOnJS(handleToggle)();
        translateX.value = withSpring(0, SPRING);
        return;
      }

      // Swipe left far enough: delete
      if (total < -SWIPE_DELETE_THRESHOLD) {
        isDeleting.value = true;
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 }, () => {
          runOnJS(handleDelete)();
        });
        return;
      }

      // Snap back
      translateX.value = withSpring(0, SPRING);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Green check reveal on right swipe
  const completeRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SWIPE_COMPLETE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [0, SWIPE_COMPLETE_THRESHOLD],
          [0.6, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  // Red trash reveal on left swipe
  const deleteRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_COMPLETE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const currentStreak = streak?.current_streak ?? 0;
  const atRisk = isStreakAtRisk(currentStreak, habit.frequency, completed);

  return (
    <View style={{ overflow: "hidden" }} className="mb-2">
      {/* Background actions */}
      <View className="absolute inset-0 flex-row">
        {/* Left: complete action */}
        <Animated.View
          style={completeRevealStyle}
          className="flex-1 bg-emerald-500 items-start justify-center pl-5"
        >
          <Text className="text-white text-2xl">✓</Text>
        </Animated.View>

        {/* Right: delete action */}
        <Animated.View
          style={deleteRevealStyle}
          className="absolute right-0 top-0 bottom-0 w-24 bg-destructive items-center justify-center"
        >
          <Text className="text-white text-xl">🗑</Text>
          <Text className="text-white text-xs mt-1">Delete</Text>
        </Animated.View>
      </View>

      {/* Row content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={rowStyle}>
          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            className="bg-card border border-border rounded-2xl p-4 flex-row items-center gap-3"
          >
            {/* Completion toggle */}
            <TouchableOpacity
              onPress={handleToggle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: completed ? habit.color : "#6b7280",
                  backgroundColor: completed ? habit.color : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {completed && (
                  <Text style={{ color: "white", fontSize: 14 }}>✓</Text>
                )}
              </View>
            </TouchableOpacity>

            {/* Icon + title */}
            <View className="flex-row items-center gap-2 flex-1 min-w-0">
              <Text style={{ fontSize: 22 }}>{habit.icon}</Text>
              <View className="flex-1 min-w-0">
                <Text
                  className="text-foreground font-medium text-base"
                  numberOfLines={1}
                >
                  {habit.title}
                </Text>
                {atRisk ? (
                  <Text style={{ fontSize: 11, color: "#f59e0b", marginTop: 2, fontWeight: "600" }}>
                    ⚡ Keep streak alive
                  </Text>
                ) : habit.description ? (
                  <Text
                    className="text-muted-foreground text-sm mt-0.5"
                    numberOfLines={1}
                  >
                    {habit.description}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Streak badge */}
            {currentStreak > 0 && (
              <View className="items-center">
                <Text style={{ fontSize: 16 }}>🔥</Text>
                <Text className="text-xs font-semibold text-foreground">
                  {currentStreak}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
