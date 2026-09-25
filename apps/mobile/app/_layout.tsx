import "../global.css";
import * as Sentry from "@sentry/react-native";
import { useEffect, useRef } from "react";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? "development" : "production",
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  enabled: !__DEV__,
});
import { Slot, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import NetInfo from "@react-native-community/netinfo";
import { AppProviders } from "@/providers";
import { useAuth } from "@/providers/supabase-provider";
import { getQueue, removeFromQueue } from "@/lib/offline-queue";
import { addCompletion, removeCompletion } from "@rock_ht/db";
import { supabase } from "@/lib/supabase";

SplashScreen.preventAutoHideAsync();

function AuthGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const checkedOnboarding = useRef(false);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";

    if (!user) {
      if (!inAuthGroup) router.replace("/(auth)/login");
      SplashScreen.hideAsync();
      return;
    }

    // Already handled onboarding check this session
    if (checkedOnboarding.current) {
      if (inAuthGroup) router.replace("/(tabs)");
      SplashScreen.hideAsync();
      return;
    }

    // Check onboarding status once per session
    (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .single();

        checkedOnboarding.current = true;

        if (profile && !profile.onboarding_completed && !inOnboarding) {
          router.replace("/onboarding");
        } else if (inAuthGroup) {
          router.replace("/(tabs)");
        }
      } finally {
        SplashScreen.hideAsync();
      }
    })();
  }, [user, loading, segments]);

  // Flush offline queue when connectivity is restored
  useEffect(() => {
    if (!user) return;

    const unsubscribe = NetInfo.addEventListener(async (state) => {
      if (!state.isConnected) return;
      const queue = await getQueue();
      if (queue.length === 0) return;

      for (const item of queue) {
        try {
          if (item.action === "add") {
            await addCompletion(supabase, user.id, {
              habit_id: item.habit_id,
              date: item.date,
            });
          } else {
            await removeCompletion(supabase, item.habit_id, item.date);
          }
          await removeFromQueue(item.id);
        } catch {
          // Will retry next connectivity event
        }
      }
    });

    return unsubscribe;
  }, [user?.id]);

  return <Slot />;
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <AuthGuard />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
