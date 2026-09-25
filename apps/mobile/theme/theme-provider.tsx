import { createContext, useContext, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { vars } from "nativewind";
import { StatusBar } from "expo-status-bar";
import { useQueryClient } from "@tanstack/react-query";
import { PROFILE_KEY, useProfile } from "@/hooks/use-profile";
import { PALETTES, type Palette, type ThemeName } from "./palettes";

interface ThemeContextValue {
  name: ThemeName;
  colors: Palette;
  setTheme: (name: ThemeName) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile, isLoading, updateProfile } = useProfile();
  const queryClient = useQueryClient();

  const name: ThemeName =
    !isLoading && profile?.theme && profile.theme in PALETTES
      ? (profile.theme as ThemeName)
      : "dark";

  const colors = PALETTES[name];

  const cssVars = useMemo(
    () =>
      vars({
        "--background": hexToRgbChannels(colors.background),
        "--card": hexToRgbChannels(colors.card),
        "--muted": hexToRgbChannels(colors.muted),
        "--border": hexToRgbChannels(colors.border),
        "--foreground": hexToRgbChannels(colors.foreground),
        "--muted-foreground": hexToRgbChannels(colors.textMuted),
        "--primary": hexToRgbChannels(colors.primary),
      }),
    [colors]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      name,
      colors,
      setTheme: async (next) => {
        const previous = profile?.theme ?? name;
        queryClient.setQueryData(PROFILE_KEY, (current: typeof profile) =>
          current ? { ...current, theme: next } : current
        );
        try {
          await updateProfile({ theme: next });
        } catch (error) {
          queryClient.setQueryData(PROFILE_KEY, (current: typeof profile) =>
            current ? { ...current, theme: previous } : current
          );
          throw error;
        }
      },
    }),
    [name, colors, updateProfile, profile, queryClient]
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1, backgroundColor: colors.background }, cssVars]}>
        <StatusBar style={colors.statusBar} />
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
