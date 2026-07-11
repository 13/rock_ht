"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import { getStreaks, type TypedSupabaseClient } from "@sisigo/db";
import type { StreakRow } from "@sisigo/types";

export const STREAKS_KEY = ["streaks"] as const;

function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

export function useStreaks() {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const db = asDbClient(supabase);

  const query = useQuery({
    queryKey: STREAKS_KEY,
    queryFn: () => getStreaks(db, user!.id),
    enabled: !!user,
  });

  const streakMap = new Map<string, StreakRow>(
    (query.data ?? []).map((s) => [s.habit_id, s])
  );

  return {
    streaks: query.data ?? [],
    streakMap,
    isLoading: query.isLoading,
    getStreak: (habitId: string) => streakMap.get(habitId) ?? null,
  };
}
