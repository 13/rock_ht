import "../global.css";
import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? "development" : "production",
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  enabled: !__DEV__,
});
import { Slot, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProviders } from "@/providers";
import { useProfile } from "@/hooks/use-profile";
import { useRebuildRemindersOnLaunch } from "@/hooks/use-reminders";
import { ThemeProvider } from "@/theme/theme-provider";

SplashScreen.preventAutoHideAsync();

function OnboardingGuard() {
  useRebuildRemindersOnLaunch();
  const { profile, isLoading } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inOnboarding = segments[0] === "onboarding";
    if (profile && !profile.onboarding_completed && !inOnboarding) router.replace("/onboarding");
    SplashScreen.hideAsync();
  }, [profile, isLoading, segments]);

  return <Slot />;
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
