"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import { getCompletions, type TypedSupabaseClient } from "@sisigo/db";

function asDbClient(s: unknown): TypedSupabaseClient {
  return s as TypedSupabaseClient;
}

export function useHabitCompletions(habitId: string) {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const db = asDbClient(supabase);

  const query = useQuery({
    queryKey: ["completions", "habit", habitId],
    queryFn: () => getCompletions(db, user!.id, { habitId }),
    enabled: !!user && !!habitId,
  });

  return {
    completions: query.data ?? [],
    isLoading: query.isLoading,
  };
}
