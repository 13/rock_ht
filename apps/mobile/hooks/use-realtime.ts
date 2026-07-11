import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/supabase-provider";
import { supabase } from "@/lib/supabase";
import {
  subscribeToHabits,
  subscribeToCompletions,
  subscribeToStreaks,
  unsubscribe,
  type TypedSupabaseClient,
} from "@sisigo/db";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useRealtimeSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    if (!user) return;

    const db = supabase as unknown as TypedSupabaseClient;

    const habitsChannel = subscribeToHabits(db, user.id, () => {
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
