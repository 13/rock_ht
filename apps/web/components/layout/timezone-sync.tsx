"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { updateProfile, type TypedSupabaseClient } from "@rock_ht/db";
import { PROFILE_KEY } from "@/hooks/use-profile";

function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

interface TimezoneSyncProps {
  userId: string;
  profileTimezone?: string | null;
}

/**
 * Fire-and-forget: writes the browser's IANA time zone onto the user's
 * profile whenever it differs from what's stored server-side. Renders
 * nothing and never blocks rendering — the effect only performs a side
 * effect (a Supabase write + query-cache invalidation), it never calls
 * setState.
 */
export function TimezoneSync({ userId, profileTimezone }: TimezoneSyncProps) {
  const { supabase } = useSupabase();
  const queryClient = useQueryClient();

  useEffect(() => {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTimezone || browserTimezone === profileTimezone) return;

    const db = asDbClient(supabase);
    updateProfile(db, userId, { timezone: browserTimezone })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      })
      .catch((error) => {
        console.error("Failed to sync browser time zone to profile", error);
      });
  }, [userId, profileTimezone, supabase, queryClient]);

  return null;
}
