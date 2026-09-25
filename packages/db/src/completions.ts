import { today, subtractDays } from "@rock_ht/utils";
import type { TypedSupabaseClient } from "./client";
import type { CompletionRow, ToggleCompletionInput, TablesInsert } from "@rock_ht/types";

export async function getCompletions(
  client: TypedSupabaseClient,
  userId: string,
  options: {
    habitId?: string;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<CompletionRow[]> {
  let query = client
    .from("habit_completions")
    .select("*")
    .eq("user_id", userId)
    .order("completed_date", { ascending: false });

  if (options.habitId) {
    query = query.eq("habit_id", options.habitId);
  }
  if (options.startDate) {
    query = query.gte("completed_date", options.startDate);
  }
  if (options.endDate) {
    query = query.lte("completed_date", options.endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getTodayCompletions(
  client: TypedSupabaseClient,
  userId: string,
  dateStr: string
): Promise<CompletionRow[]> {
  const { data, error } = await client
    .from("habit_completions")
    .select("*")
    .eq("user_id", userId)
    .eq("completed_date", dateStr);

  if (error) throw error;
  return data ?? [];
}

export async function getCompletionForDate(
  client: TypedSupabaseClient,
  habitId: string,
  dateStr: string
): Promise<CompletionRow | null> {
  const { data, error } = await client
    .from("habit_completions")
    .select("*")
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data;
}

export async function addCompletion(
  client: TypedSupabaseClient,
  userId: string,
  input: ToggleCompletionInput
): Promise<CompletionRow> {
  const insert: TablesInsert<"habit_completions"> = {
    habit_id: input.habit_id,
    user_id: userId,
    completed_date: input.date,
    value: input.value ?? 1,
    note: input.note ?? null,
  };

  const { data, error } = await client
    .from("habit_completions")
    .upsert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeCompletion(
  client: TypedSupabaseClient,
  habitId: string,
  dateStr: string
): Promise<void> {
  const { error } = await client
    .from("habit_completions")
    .delete()
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr);

  if (error) throw error;
}

export async function updateCompletionNote(
  client: TypedSupabaseClient,
  habitId: string,
  dateStr: string,
  note: string
): Promise<void> {
  const { error } = await client
    .from("habit_completions")
    .update({ note: note || null })
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr);

  if (error) throw error;
}

export async function getLast30DaysCompletions(
  client: TypedSupabaseClient,
  userId: string,
  endDate: string = today()
): Promise<CompletionRow[]> {
  const startDate = subtractDays(endDate, 29);

  return getCompletions(client, userId, { startDate, endDate });
}
