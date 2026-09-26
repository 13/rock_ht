import "../global.css";
import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? "development" : "production",
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  enabled: !__DEV__,
});
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProviders } from "@/providers";
import { useProfile } from "@/hooks/use-profile";
import { useRebuildRemindersOnLaunch } from "@/hooks/use-reminders";
import { useSyncTriggers } from "@/hooks/use-sync";
import { ThemeProvider, useTheme } from "@/theme/theme-provider";

SplashScreen.preventAutoHideAsync();

function OnboardingGuard() {
  useRebuildRemindersOnLaunch();
  useSyncTriggers();
  const { colors } = useTheme();
  const { profile, isLoading } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inOnboarding = segments[0] === "onboarding";
    if (profile && !profile.onboarding_completed && !inOnboarding) router.replace("/onboarding");
    SplashScreen.hideAsync();
  }, [profile, isLoading, segments]);

  // A stack (not a Slot) so pushed screens (habit detail, Sync settings) return to the tab they
  // were opened from instead of remounting the tabs on Today.
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <ThemeProvider>
          <OnboardingGuard />
        </ThemeProvider>
      </AppProviders>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
