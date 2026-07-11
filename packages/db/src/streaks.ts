import type { TypedSupabaseClient } from "./client";
import type { StreakRow, TablesInsert } from "@sisigo/types";

export async function getStreaks(
  client: TypedSupabaseClient,
  userId: string
): Promise<StreakRow[]> {
  const { data, error } = await client
    .from("habit_streaks")
    .select("*")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

export async function getStreak(
  client: TypedSupabaseClient,
  habitId: string
): Promise<StreakRow | null> {
  const { data, error } = await client
    .from("habit_streaks")
    .select("*")
    .eq("habit_id", habitId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data;
}

export async function upsertStreak(
  client: TypedSupabaseClient,
  streakData: TablesInsert<"habit_streaks">
): Promise<StreakRow> {
  const { data, error } = await client
    .from("habit_streaks")
    .upsert(streakData)
    .select()
    .single();

  if (error) throw error;
  return data;
}
