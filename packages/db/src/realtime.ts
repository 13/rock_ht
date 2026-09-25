import type { TypedSupabaseClient } from "./client";
import type {
  HabitRow,
  CompletionRow,
  StreakRow,
} from "@rock_ht/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

type HabitChangeCallback = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: HabitRow | null;
  old: HabitRow | null;
}) => void;

type CompletionChangeCallback = (payload: {
  eventType: "INSERT" | "DELETE";
  new: CompletionRow | null;
  old: CompletionRow | null;
}) => void;

type StreakChangeCallback = (payload: {
  eventType: "INSERT" | "UPDATE";
  new: StreakRow | null;
}) => void;

// Random suffix prevents the Supabase client from returning a cached channel
// object with joinedOnce=true when the hook re-mounts (e.g. React StrictMode).
function uid() {
  return Math.random().toString(36).slice(2, 8);
}

export function subscribeToHabits(
  client: TypedSupabaseClient,
  userId: string,
  callback: HabitChangeCallback
): RealtimeChannel {
  return client
    .channel(`habits:${userId}:${uid()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "habits",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        callback({
          eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
          new: (payload.new as HabitRow) ?? null,
          old: (payload.old as HabitRow) ?? null,
        });
      }
    )
    .subscribe();
}

export function subscribeToCompletions(
  client: TypedSupabaseClient,
  userId: string,
  callback: CompletionChangeCallback
): RealtimeChannel {
  return client
    .channel(`completions:${userId}:${uid()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "habit_completions",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        callback({
          eventType: payload.eventType as "INSERT" | "DELETE",
          new: (payload.new as CompletionRow) ?? null,
          old: (payload.old as CompletionRow) ?? null,
        });
      }
    )
    .subscribe();
}

export function subscribeToStreaks(
  client: TypedSupabaseClient,
  userId: string,
  callback: StreakChangeCallback
): RealtimeChannel {
  return client
    .channel(`streaks:${userId}:${uid()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "habit_streaks",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        callback({
          eventType: payload.eventType as "INSERT" | "UPDATE",
          new: (payload.new as StreakRow) ?? null,
        });
      }
    )
    .subscribe();
}

export function unsubscribe(
  _client: TypedSupabaseClient,
  channel: RealtimeChannel
): void {
  channel.unsubscribe();
}
