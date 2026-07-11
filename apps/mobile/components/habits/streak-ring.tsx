import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";

interface StreakRingProps {
  streak: number;
  progress: number; // 0-1, today's overall progress
  size?: number;
}

export function StreakRing({ streak, progress, size = 120 }: StreakRingProps) {
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
          stroke="#1e1e2a"
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#6366f1"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: "#f4f4f8" }}>
          {streak}
        </Text>
        <Text style={{ fontSize: 11, color: "#6b6b80", marginTop: 1 }}>
          day streak
        </Text>
      </View>
    </View>
  );
}
