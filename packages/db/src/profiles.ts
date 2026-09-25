import type { TypedSupabaseClient } from "./client";
import type { ProfileRow, UpdateProfileInput, TablesInsert } from "@rock_ht/types";

export async function getProfile(
  client: TypedSupabaseClient,
  userId: string
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data;
}

export async function updateProfile(
  client: TypedSupabaseClient,
  userId: string,
  input: UpdateProfileInput
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function upsertProfile(
  client: TypedSupabaseClient,
  userId: string,
  email: string,
  displayName?: string
): Promise<ProfileRow> {
  const insert: TablesInsert<"profiles"> = {
    id: userId,
    email,
    display_name: displayName ?? email.split("@")[0],
  };

  const { data, error } = await client
    .from("profiles")
    .upsert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}
