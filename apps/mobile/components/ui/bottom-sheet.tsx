import { useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SPRING_CONFIG = { damping: 20, stiffness: 200 };

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  snapPoint?: number; // 0–1, fraction of screen height
  children: React.ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  snapPoint = 0.65,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const sheetHeight = SCREEN_HEIGHT * snapPoint;
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  const startY = useSharedValue(0);

  const open = useCallback(() => {
    translateY.value = withSpring(0, SPRING_CONFIG);
    backdropOpacity.value = withTiming(1, { duration: 250 });
  }, []);

  const close = useCallback(() => {
    translateY.value = withSpring(sheetHeight, SPRING_CONFIG);
    backdropOpacity.value = withTiming(0, { duration: 200 });
    setTimeout(onClose, 250);
  }, [onClose, sheetHeight]);

  useEffect(() => {
    if (visible) {
      open();
    } else {
      translateY.value = sheetHeight;
      backdropOpacity.value = 0;
    }
  }, [visible]);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = startY.value + e.translationY;
      translateY.value = Math.max(0, next);
    })
    .onEnd((e) => {
      if (e.translationY > sheetHeight * 0.3 || e.velocityY > 800) {
        runOnJS(close)();
      } else {
        translateY.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} className="z-50">
      {/* Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, backdropStyle]}
        className="bg-black/60"
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          sheetStyle,
          {
            height: sheetHeight + insets.bottom,
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
          },
        ]}
        className="bg-card rounded-t-3xl shadow-2xl"
      >
        <GestureDetector gesture={panGesture}>
          <View>
            {/* Drag handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </View>

            {/* Header */}
            {title && (
              <View className="flex-row items-center justify-between px-5 pt-2 pb-3 border-b border-border">
                <Text className="text-lg font-semibold text-foreground">
                  {title}
                </Text>
                <TouchableOpacity
                  onPress={close}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text className="text-muted-foreground text-2xl leading-6">
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </GestureDetector>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}
