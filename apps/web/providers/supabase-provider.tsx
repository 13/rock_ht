"use client";

import { createContext, useContext, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type TypedClient = ReturnType<typeof createClient>;

type SupabaseContext = {
  /** null when this build has no Supabase project (self-hosted image). */
  supabase: TypedClient | null;
  /** Always null without Supabase: there is no web login. */
  user: null;
};

const Context = createContext<SupabaseContext | undefined>(undefined);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  // Without Supabase config, createClient() would throw (and @supabase/ssr would fail prerendering).
  const [supabase] = useState(() => (isSupabaseConfigured() ? createClient() : null));

  return <Context.Provider value={{ supabase, user: null }}>{children}</Context.Provider>;
}

/** The Supabase client. Only for pages that need web login; throws when Supabase is not configured. */
export function useSupabase(): { supabase: TypedClient } {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useSupabase must be used within SupabaseProvider");
  }
  if (!context.supabase) {
    throw new Error("Supabase not configured");
  }
  return { supabase: context.supabase };
}
