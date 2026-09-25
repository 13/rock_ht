import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@rock_ht/types";

// Accept any Supabase client — return types in every db function are explicitly
// typed from our Database definition so callers still get full type safety.
// Using `any` avoids the fragile generic-chain type-check that breaks across
// different @supabase/* package versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TypedSupabaseClient = SupabaseClient<Database, any, any>;

export function getSupabaseClient(
  supabaseUrl: string,
  supabaseKey: string
): TypedSupabaseClient {
  return createClient<Database>(
    supabaseUrl,
    supabaseKey,
    { auth: { persistSession: true, autoRefreshToken: true } }
  ) as TypedSupabaseClient;
}

export function createSupabaseClient(
  supabaseUrl: string,
  supabaseKey: string
): TypedSupabaseClient {
  return createClient<Database>(supabaseUrl, supabaseKey) as TypedSupabaseClient;
}
