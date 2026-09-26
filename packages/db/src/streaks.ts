import type { TypedSupabaseClient } from "./client";
import type { StreakRow, TablesInsert } from "@rock_ht/types";

/**
 * `habit_streaks` rows outlive a soft-deleted habit (a tombstone keeps its streak row), so list
 * reads join the parent and keep only live habits, the same way completions do. The embedded
 * `habits` key is dropped again before returning.
 */
const LIVE_STREAKS = "*, habits!inner(deleted_at)";

export async function getStreaks(
  client: TypedSupabaseClient,
  userId: string
): Promise<StreakRow[]> {
  const { data, error } = await client
    .from("habit_streaks")
    .select(LIVE_STREAKS)
    .eq("user_id", userId)
    .is("habits.deleted_at", null);

  if (error) throw error;
  return ((data ?? []) as unknown[]).map((r) => {
    const { habits: _habit, ...row } = r as StreakRow & { habits?: unknown };
    return row;
  });
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
