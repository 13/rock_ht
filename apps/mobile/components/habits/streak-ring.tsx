import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/theme/theme-provider";

interface StreakRingProps {
  streak: number;
  progress: number; // 0-1, today's overall progress
  size?: number;
}

export function StreakRing({ streak, progress, size = 120 }: StreakRingProps) {
  const { colors } = useTheme();
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - progress * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.border}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.primary}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.foreground }}>
          {streak}
        </Text>
        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
          day streak
        </Text>
      </View>
    </View>
  );
}
