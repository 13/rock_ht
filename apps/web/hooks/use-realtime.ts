"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import {
  subscribeToHabits,
  subscribeToCompletions,
  subscribeToStreaks,
  unsubscribe,
  type TypedSupabaseClient,
} from "@rock_ht/db";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Realtime sync: Supabase → invalidate TanStack Query cache.
// We don't merge events into state directly — TanStack Query refetches
// authoritatively. This keeps optimistic updates clean and avoids races.
export function useRealtimeSync() {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    if (!user) return;

    const db = supabase as unknown as TypedSupabaseClient;

    const habitsChannel = subscribeToHabits(db, user.id, ({ eventType }) => {
      // Don't refetch on our own optimistic mutations (handled by mutation callbacks)
      // But DO refetch on changes from other devices
      queryClient.invalidateQueries({ queryKey: ["habits"] });
    });

    const completionsChannel = subscribeToCompletions(db, user.id, () => {
      queryClient.invalidateQueries({ queryKey: ["completions"] });
    });

    const streaksChannel = subscribeToStreaks(db, user.id, () => {
      queryClient.invalidateQueries({ queryKey: ["streaks"] });
    });

    channelsRef.current = [habitsChannel, completionsChannel, streaksChannel];

    return () => {
      channelsRef.current.forEach((ch) => unsubscribe(db, ch));
      channelsRef.current = [];
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
