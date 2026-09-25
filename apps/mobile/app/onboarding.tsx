import { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useAuth } from "@/providers/supabase-provider";
import { useHabits } from "@/hooks/use-habits";
import {
  requestNotificationPermission,
  scheduleDailyDigest,
} from "@/lib/notifications";
import { hapticLight, hapticSuccess, hapticMedium } from "@/lib/haptics";
import { HABIT_TEMPLATES, TEMPLATE_CATEGORIES } from "@rock_ht/utils";
import { updateProfile } from "@rock_ht/db";
import { supabase } from "@/lib/supabase";
import type { HabitTemplate } from "@rock_ht/utils";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const STEPS = 4;

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
      <Text style={{ fontSize: 80, marginBottom: 32 }}>✨</Text>
      <Text style={{ fontSize: 32, fontWeight: "800", color: "#f4f4f8", textAlign: "center", marginBottom: 12, letterSpacing: -0.5 }}>
        Welcome to{"\n"}rock
      </Text>
      <Text style={{ fontSize: 16, color: "#9ca3af", textAlign: "center", lineHeight: 24, marginBottom: 40 }}>
        The simplest way to build habits that stick. One tap, every day.
      </Text>

      <View style={{ flexDirection: "row", gap: 12, marginBottom: 48 }}>
        {[
          { emoji: "🎯", label: "Track habits" },
          { emoji: "🔥", label: "Build streaks" },
          { emoji: "📊", label: "See growth" },
        ].map(({ emoji, label }) => (
          <View
            key={label}
            style={{
              flex: 1,
              alignItems: "center",
              backgroundColor: "#111118",
              borderRadius: 16,
              padding: 14,
              borderWidth: 1,
              borderColor: "#1e1e2a",
            }}
          >
            <Text style={{ fontSize: 24, marginBottom: 6 }}>{emoji}</Text>
            <Text style={{ fontSize: 11, color: "#9ca3af", fontWeight: "500", textAlign: "center" }}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        onPress={() => { hapticMedium(); onNext(); }}
        style={{
          backgroundColor: "#6366f1",
          paddingVertical: 16,
          paddingHorizontal: 48,
          borderRadius: 16,
          width: "100%",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
          Get started →
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 2: Template picker ──────────────────────────────────────────────────

function TemplatesStep({
  onNext,
}: {
  onNext: (selected: HabitTemplate[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    hapticLight();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  }

  const selectedTemplates = HABIT_TEMPLATES.filter((t) => selected.has(t.id));

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "800", color: "#f4f4f8", marginBottom: 6 }}>
          Pick your first habits
        </Text>
        <Text style={{ fontSize: 14, color: "#9ca3af" }}>
          Choose up to 5 to start. Add more anytime.
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {HABIT_TEMPLATES.map((template) => {
            const isSelected = selected.has(template.id);
            return (
              <TouchableOpacity
                key={template.id}
                onPress={() => toggle(template.id)}
                style={{
                  width: (SCREEN_WIDTH - 48 - 10) / 2,
                  backgroundColor: isSelected ? template.color + "20" : "#111118",
                  borderRadius: 16,
                  padding: 14,
                  borderWidth: 1.5,
                  borderColor: isSelected ? template.color : "#1e1e2a",
                }}
              >
                {isSelected && (
                  <View
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: template.color,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>✓</Text>
                  </View>
                )}
                <Text style={{ fontSize: 24, marginBottom: 8 }}>{template.icon}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#f4f4f8", marginBottom: 2, lineHeight: 18 }} numberOfLines={2}>
                  {template.title}
                </Text>
                <Text style={{ fontSize: 11, color: "#9ca3af", lineHeight: 15 }} numberOfLines={2}>
                  {template.description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ padding: 24, paddingTop: 12 }}>
        <TouchableOpacity
          onPress={() => { hapticMedium(); onNext(selectedTemplates); }}
          style={{
            backgroundColor: selected.size > 0 ? "#6366f1" : "#2d2d3a",
            paddingVertical: 16,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
            {selected.size === 0
              ? "Skip →"
              : `Add ${selected.size} habit${selected.size > 1 ? "s" : ""} →`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 3: Notifications ────────────────────────────────────────────────────

function NotificationsStep({ onNext }: { onNext: (enabled: boolean) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleEnable() {
    setLoading(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      await scheduleDailyDigest(20, 0);
      hapticSuccess();
    }
    setLoading(false);
    onNext(granted);
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
      <Text style={{ fontSize: 64, marginBottom: 24 }}>🔔</Text>
      <Text style={{ fontSize: 26, fontWeight: "800", color: "#f4f4f8", textAlign: "center", marginBottom: 12 }}>
        Stay on track
      </Text>
      <Text style={{ fontSize: 15, color: "#9ca3af", textAlign: "center", lineHeight: 22, marginBottom: 40 }}>
        Get a daily reminder at 8 PM to check in on your habits. You can customize this in Settings.
      </Text>

      <TouchableOpacity
        onPress={handleEnable}
        disabled={loading}
        style={{
          backgroundColor: "#6366f1",
          paddingVertical: 16,
          borderRadius: 16,
          width: "100%",
          alignItems: "center",
          marginBottom: 14,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
            Enable notifications
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { hapticLight(); onNext(false); }}>
        <Text style={{ color: "#6b7280", fontSize: 14 }}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function DoneStep({ habitCount, onFinish }: { habitCount: number; onFinish: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
      <Text style={{ fontSize: 72, marginBottom: 24 }}>🎉</Text>
      <Text style={{ fontSize: 28, fontWeight: "800", color: "#f4f4f8", textAlign: "center", marginBottom: 12 }}>
        You're ready!
      </Text>
      <Text style={{ fontSize: 15, color: "#9ca3af", textAlign: "center", lineHeight: 22, marginBottom: 40 }}>
        {habitCount > 0
          ? `${habitCount} habit${habitCount > 1 ? "s" : ""} added. Start checking them off today.`
          : "Your dashboard is ready. Add your first habit to begin."}
      </Text>
      <TouchableOpacity
        onPress={onFinish}
        style={{
          backgroundColor: "#6366f1",
          paddingVertical: 16,
          borderRadius: 16,
          width: "100%",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
          Open my dashboard
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { createHabit } = useHabits();
  const [step, setStep] = useState(0);
  const [habitCount, setHabitCount] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  async function handleTemplates(templates: HabitTemplate[]) {
    if (templates.length > 0) {
      setIsCreating(true);
      try {
        await Promise.all(
          templates.map((t) =>
            createHabit({
              title: t.title,
              description: t.description,
              icon: t.icon,
              color: t.color,
              frequency: t.frequency,
            })
          )
        );
        setHabitCount(templates.length);
      } finally {
        setIsCreating(false);
      }
    }
    setStep(2);
  }

  async function handleFinish() {
    if (user) {
      await updateProfile(supabase as any, user.id, {
        onboarding_completed: true,
      });
    }
    hapticSuccess();
    router.replace("/(tabs)");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0a0f" }} edges={["top", "bottom"]}>
      {/* Progress bar */}
      <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 }}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: i <= step ? "#6366f1" : "#2d2d3a",
            }}
          />
        ))}
      </View>

      {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
      {step === 1 && <TemplatesStep onNext={handleTemplates} />}
      {step === 2 && <NotificationsStep onNext={() => setStep(3)} />}
      {step === 3 && <DoneStep habitCount={habitCount} onFinish={handleFinish} />}

      {isCreating && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#0a0a0f99",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color="#6366f1" size="large" />
          <Text style={{ color: "#9ca3af", marginTop: 12, fontSize: 14 }}>
            Creating your habits…
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
