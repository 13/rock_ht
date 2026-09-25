import { today } from "@sisigo/utils";
import type { TypedSupabaseClient } from "./client";
import type {
  JournalEntry,
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
  TablesInsert,
} from "@sisigo/types";

export async function getJournalEntries(
  client: TypedSupabaseClient,
  userId: string,
  options: { limit?: number; habitId?: string } = {}
): Promise<JournalEntry[]> {
  let query = client
    .from("journal_entries")
    .select("*")
    .eq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.habitId) {
    query = query.eq("habit_id", options.habitId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getJournalEntryForDate(
  client: TypedSupabaseClient,
  userId: string,
  dateStr: string
): Promise<JournalEntry | null> {
  const { data, error } = await client
    .from("journal_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("entry_date", dateStr)
    .is("habit_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createJournalEntry(
  client: TypedSupabaseClient,
  userId: string,
  input: CreateJournalEntryInput
): Promise<JournalEntry> {
  const insert: TablesInsert<"journal_entries"> = {
    user_id: userId,
    habit_id: input.habit_id ?? null,
    entry_date: input.entry_date ?? today(),
    content: input.content,
    mood: input.mood ?? null,
  };

  const { data, error } = await client
    .from("journal_entries")
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateJournalEntry(
  client: TypedSupabaseClient,
  input: UpdateJournalEntryInput
): Promise<JournalEntry> {
  const { data, error } = await client
    .from("journal_entries")
    .update({
      content: input.content,
      mood: input.mood,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteJournalEntry(
  client: TypedSupabaseClient,
  entryId: string
): Promise<void> {
  const { error } = await client
    .from("journal_entries")
    .delete()
    .eq("id", entryId);

  if (error) throw error;
}
