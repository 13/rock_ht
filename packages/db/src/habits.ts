import type { TypedSupabaseClient } from "./client";
import type {
  HabitRow,
  CreateHabitInput,
  UpdateHabitInput,
  HabitWithFrequency,
  TablesInsert,
  TablesUpdate,
} from "@rock_ht/types";
import { parseFrequency, frequencyToJson } from "@rock_ht/utils";
import { softDelete } from "./soft-delete";

function parseHabitRow(row: HabitRow): HabitWithFrequency {
  return {
    ...row,
    frequency: parseFrequency(row.frequency),
  };
}

export async function getHabits(
  client: TypedSupabaseClient,
  userId: string
): Promise<HabitWithFrequency[]> {
  const { data, error } = await client
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(parseHabitRow);
}

export async function getAllHabits(
  client: TypedSupabaseClient,
  userId: string
): Promise<HabitWithFrequency[]> {
  const { data, error } = await client
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(parseHabitRow);
}

export async function getHabit(
  client: TypedSupabaseClient,
  habitId: string
): Promise<HabitWithFrequency | null> {
  const { data, error } = await client
    .from("habits")
    .select("*")
    .eq("id", habitId)
    .is("deleted_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return parseHabitRow(data);
}

export async function createHabit(
  client: TypedSupabaseClient,
  userId: string,
  input: CreateHabitInput
): Promise<HabitWithFrequency> {
  const insert: TablesInsert<"habits"> = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    icon: input.icon,
    color: input.color,
    frequency: frequencyToJson(input.frequency),
    target_value: input.target_value ?? 1,
    target_unit: input.target_unit ?? null,
    reminder_time: input.reminder_time ?? null,
    reminder_enabled: input.reminder_enabled ?? false,
    // Stamped by the writer, like every other client: the server keeps it for last-write-wins.
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("habits")
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return parseHabitRow(data);
}

export async function updateHabit(
  client: TypedSupabaseClient,
  input: UpdateHabitInput
): Promise<HabitWithFrequency> {
  const { id, ...updates } = input;

  const updatePayload: TablesUpdate<"habits"> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) updatePayload.title = updates.title;
  if (updates.description !== undefined) updatePayload.description = updates.description;
  if (updates.icon !== undefined) updatePayload.icon = updates.icon;
  if (updates.color !== undefined) updatePayload.color = updates.color;
  if (updates.frequency !== undefined) updatePayload.frequency = frequencyToJson(updates.frequency);
  if (updates.target_value !== undefined) updatePayload.target_value = updates.target_value;
  if (updates.target_unit !== undefined) updatePayload.target_unit = updates.target_unit;
  if (updates.reminder_time !== undefined) updatePayload.reminder_time = updates.reminder_time;
  if (updates.reminder_enabled !== undefined) updatePayload.reminder_enabled = updates.reminder_enabled;
  if (updates.sort_order !== undefined) updatePayload.sort_order = updates.sort_order;
  if (updates.is_archived !== undefined) updatePayload.is_archived = updates.is_archived;

  const { data, error } = await client
    .from("habits")
    .update(updatePayload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) throw error;
  return parseHabitRow(data);
}

export async function archiveHabit(
  client: TypedSupabaseClient,
  habitId: string
): Promise<void> {
  const { error } = await client
    .from("habits")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", habitId);

  if (error) throw error;
}

export async function deleteHabit(
  client: TypedSupabaseClient,
  habitId: string
): Promise<void> {
  // Soft delete: the tombstone syncs to offline devices (a hard delete would never reach them).
  // The habit's completions stay; every read filters them through their live habit.
  const { error } = await client
    .from("habits")
    .update(softDelete())
    .eq("id", habitId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function reorderHabits(
  client: TypedSupabaseClient,
  habitOrders: Array<{ id: string; sort_order: number }>
): Promise<void> {
  // Update each habit's sort_order individually to avoid upsert type conflicts
  await Promise.all(
    habitOrders.map(({ id, sort_order }) =>
      client
        .from("habits")
        .update({ sort_order, updated_at: new Date().toISOString() })
        .eq("id", id)
    )
  );
}
