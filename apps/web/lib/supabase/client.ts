import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@rock_ht/types";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED } from "./config";

export function createClient() {
  if (!isSupabaseConfigured()) throw new Error(SUPABASE_NOT_CONFIGURED);
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
