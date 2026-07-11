import type { Tables } from "./database.types";

export type Theme = "light" | "dark" | "midnight" | "forest" | "sunset";
export type TimeFormat = "12h" | "24h";
export type DateFormat = "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "D MMM YYYY";

export type ProfileRow = Tables<"profiles">;

export interface UserProfile extends ProfileRow {
  theme: Theme;
}

export interface UpdateProfileInput {
  display_name?: string;
  avatar_url?: string;
  timezone?: string;
  theme?: Theme;
  time_format?: TimeFormat;
  date_format?: DateFormat;
  onboarding_completed?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: UserProfile | null;
}
