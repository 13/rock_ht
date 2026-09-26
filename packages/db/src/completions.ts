import { today, subtractDays } from "@rock_ht/utils";
import { completionId } from "@rock_ht/sync";
import type { TypedSupabaseClient } from "./client";
import { softDelete } from "./soft-delete";
import type { CompletionRow, ToggleCompletionInput, TablesInsert } from "@rock_ht/types";

/**
 * Completions are kept when their habit is soft-deleted (as on mobile, where a restored habit gets
 * its history back), so list reads join the habit and keep only live ones. The joined column is
 * dropped again by `stripHabit`.
 */
const LIVE_COMPLETIONS = "*, habits!inner(deleted_at)";
function stripHabit(rows: unknown[] | null): CompletionRow[] {
  return (rows ?? []).map((r) => {
    const { habits: _habit, ...row } = r as CompletionRow & { habits?: unknown };
    return row;
  });
}

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
    .select(LIVE_COMPLETIONS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("habits.deleted_at", null)
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
  return stripHabit(data);
}

export async function getTodayCompletions(
  client: TypedSupabaseClient,
  userId: string,
  dateStr: string
): Promise<CompletionRow[]> {
  const { data, error } = await client
    .from("habit_completions")
    .select(LIVE_COMPLETIONS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("habits.deleted_at", null)
    .eq("completed_date", dateStr);

  if (error) throw error;
  return stripHabit(data);
}

export async function getCompletionForDate(
  client: TypedSupabaseClient,
  habitId: string,
  dateStr: string
): Promise<CompletionRow | null> {
  const { data, error } = await client
    .from("habit_completions")
    .select(LIVE_COMPLETIONS)
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr)
    .is("deleted_at", null)
    .is("habits.deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data ? stripHabit([data])[0]! : null;
}

export async function addCompletion(
  client: TypedSupabaseClient,
  userId: string,
  input: ToggleCompletionInput
): Promise<CompletionRow> {
  // Deterministic id (the one every device derives), and an upsert that revives a tombstone:
  // un-toggling only soft-deletes, so the row for this habit and day may already exist.
  const insert: TablesInsert<"habit_completions"> = {
    id: completionId(input.habit_id, input.date),
    habit_id: input.habit_id,
    user_id: userId,
    completed_date: input.date,
    value: input.value ?? 1,
    note: input.note ?? null,
    updated_at: new Date().toISOString(),
    deleted_at: null,
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
    .update(softDelete())
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr)
    .is("deleted_at", null);

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
    .update({ note: note || null, updated_at: new Date().toISOString() })
    .eq("habit_id", habitId)
    .eq("completed_date", dateStr)
    .is("deleted_at", null);

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
