export type ThemeName = "light" | "dark" | "midnight" | "forest" | "sunset";

export const THEME_NAMES: ThemeName[] = ["dark", "light", "midnight", "forest", "sunset"];

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: "Dark",
  light: "Light",
  midnight: "Midnight",
  forest: "Forest",
  sunset: "Sunset",
};

export interface Palette {
  background: string;
  card: string;
  muted: string;
  border: string;
  elevated: string;
  foreground: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  danger: string;
  warning: string;
  streak: string;
  success: string;
  /** Stats insight accents (same in every theme) */
  insightStrength: string;
  insightMilestone: string;
  statusBar: "light" | "dark";
}

const shared = {
  onPrimary: "#ffffff",
  danger: "#ef4444",
  warning: "#f59e0b",
  streak: "#f97316",
  success: "#22c55e",
  insightStrength: "#10b981",
  insightMilestone: "#8b5cf6",
};

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    background: "#0a0a0f",
    card: "#111118",
    muted: "#1e1e2a",
    border: "#1e1e2a",
    elevated: "#2d2d3a",
    foreground: "#f4f4f8",
    textSecondary: "#9ca3af",
    textMuted: "#6b6b80",
    primary: "#6366f1",
    statusBar: "light",
    ...shared,
  },
  light: {
    background: "#fafafa",
    card: "#ffffff",
    muted: "#f4f4f5",
    border: "#e4e4e7",
    elevated: "#e4e4e7",
    foreground: "#17171c",
    textSecondary: "#52525b",
    textMuted: "#71717a",
    primary: "#5048e5",
    statusBar: "dark",
    ...shared,
  },
  midnight: {
    background: "#000000",
    card: "#111113",
    muted: "#1d1d20",
    border: "#1f1f23",
    elevated: "#2a2a2f",
    foreground: "#dfdfe2",
    textSecondary: "#a1a1aa",
    textMuted: "#6e6e77",
    primary: "#9b6af1",
    statusBar: "light",
    ...shared,
  },
  forest: {
    background: "#0a100d",
    card: "#121c17",
    muted: "#1e2924",
    border: "#212c26",
    elevated: "#2b3a32",
    foreground: "#e0ebe4",
    textSecondary: "#a3b8aa",
    textMuted: "#708f7a",
    primary: "#21c45d",
    statusBar: "light",
    ...shared,
  },
  sunset: {
    background: "#110b09",
    card: "#1d1511",
    muted: "#2b211d",
    border: "#2d241f",
    elevated: "#3a2d27",
    foreground: "#ebe6e0",
    textSecondary: "#bfb2a5",
    textMuted: "#897a6c",
    primary: "#ec417a",
    statusBar: "light",
    ...shared,
  },
};
