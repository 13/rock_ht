import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@rock_ht/types";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED } from "./config";

/** Throws `Supabase not configured` when the build has no Supabase project (see ./config). */
export async function createClient() {
  if (!isSupabaseConfigured()) throw new Error(SUPABASE_NOT_CONFIGURED);
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component context — cookies are read-only
          }
        },
      },
    }
  );
}
