import { TouchableOpacity, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

interface CompletionButtonProps {
  completed: boolean;
  color: string;
  onToggle: () => void;
  size?: number;
}

export function CompletionButton({
  completed,
  color,
  onToggle,
  size = 36,
}: CompletionButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePress() {
    scale.value = withSequence(
      withSpring(0.85, { damping: 15 }),
      withSpring(1.1, { damping: 15 }),
      withSpring(1, { damping: 20 })
    );
    onToggle();
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.8}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
            backgroundColor: completed ? color : "transparent",
            alignItems: "center",
            justifyContent: "center",
          },
          animatedStyle,
        ]}
      >
        {completed && (
          <Ionicons
            name="checkmark"
            size={size * 0.5}
            color="#fff"
          />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}
