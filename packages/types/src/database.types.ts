/**
 * Supabase schema types for supabase/migrations/001-008, HAND-EDITED on top of the generator's
 * output. After regenerating (`supabase gen types typescript --local`), re-apply these edits, or the
 * web/mobile type-checks and device-row fixtures break:
 *
 * 1. `server_seq` is OPTIONAL (`server_seq?: number`) in the Row type of profiles, habits,
 *    habit_completions and journal_entries (the generator emits `server_seq: number`). It is a
 *    server-only change counter; sync pulls strip it, so rows that come from a device (local-db,
 *    fixtures, optimistic rows) never carry it.
 * 2. `habit_completions.Insert.id` is REQUIRED (`id: string`) and must always be
 *    `completion_id(habit_id, completed_date)` (`completionId` in @rock_ht/sync): 008 drops the
 *    column default, and every client sends the deterministic id.
 * 3. The check-constrained text columns `profiles.theme`, `profiles.time_format` and
 *    `profiles.date_format` are narrowed to literal unions (the generator emits `string`).
 * 4. The doc comments on the fields above.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          theme: "light" | "dark" | "midnight" | "forest" | "sunset";
          onboarding_completed: boolean;
          time_format: "12h" | "24h";
          date_format: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "D MMM YYYY";
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          /** Server-only change counter; sync pulls strip it, so device rows never have it. */
          server_seq?: number;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          theme?: "light" | "dark" | "midnight" | "forest" | "sunset";
          onboarding_completed?: boolean;
          time_format?: "12h" | "24h";
          date_format?: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "D MMM YYYY";
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          theme?: "light" | "dark" | "midnight" | "forest" | "sunset";
          onboarding_completed?: boolean;
          time_format?: "12h" | "24h";
          date_format?: "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "D MMM YYYY";
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Relationships: [];
      };
      habits: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          icon: string;
          color: string;
          frequency: Json;
          target_value: number;
          target_unit: string | null;
          reminder_time: string | null;
          reminder_enabled: boolean;
          is_archived: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          /** Server-only change counter; sync pulls strip it, so device rows never have it. */
          server_seq?: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          icon?: string;
          color?: string;
          frequency?: Json;
          target_value?: number;
          target_unit?: string | null;
          reminder_time?: string | null;
          reminder_enabled?: boolean;
          is_archived?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          icon?: string;
          color?: string;
          frequency?: Json;
          target_value?: number;
          target_unit?: string | null;
          reminder_time?: string | null;
          reminder_enabled?: boolean;
          is_archived?: boolean;
          sort_order?: number;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Relationships: [
          {
            foreignKeyName: "habits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      habit_completions: {
        Row: {
          id: string;
          habit_id: string;
          user_id: string;
          completed_date: string;
          value: number;
          note: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          /** Server-only change counter; sync pulls strip it, so device rows never have it. */
          server_seq?: number;
        };
        Insert: {
          /** Always completion_id(habit_id, completed_date) (`completionId` in @rock_ht/sync): no default. */
          id: string;
          habit_id: string;
          user_id: string;
          completed_date: string;
          value?: number;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Update: {
          id?: string;
          habit_id?: string;
          user_id?: string;
          completed_date?: string;
          value?: number;
          note?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Relationships: [
          {
            foreignKeyName: "habit_completions_habit_id_fkey";
            columns: ["habit_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "habit_completions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      habit_streaks: {
        Row: {
          habit_id: string;
          user_id: string;
          current_streak: number;
          longest_streak: number;
          last_completed_date: string | null;
          updated_at: string;
        };
        Insert: {
          habit_id: string;
          user_id: string;
          current_streak?: number;
          longest_streak?: number;
          last_completed_date?: string | null;
          updated_at?: string;
        };
        Update: {
          habit_id?: string;
          user_id?: string;
          current_streak?: number;
          longest_streak?: number;
          last_completed_date?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "habit_streaks_habit_id_fkey";
            columns: ["habit_id"];
            isOneToOne: true;
            referencedRelation: "habits";
            referencedColumns: ["id"];
          }
        ];
      };
      subscriptions: {
        Row: {
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          plan: string;
          status: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: string;
          status?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          plan?: string;
          status?: string | null;
          current_period_end?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      journal_entries: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string | null;
          entry_date: string;
          content: string;
          mood: number | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          /** Server-only change counter; sync pulls strip it, so device rows never have it. */
          server_seq?: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id?: string | null;
          entry_date?: string;
          content: string;
          mood?: number | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string | null;
          entry_date?: string;
          content?: string;
          mood?: number | null;
          updated_at?: string;
          deleted_at?: string | null;
          server_seq?: number;
        };
        Relationships: [
          {
            foreignKeyName: "journal_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      recalculate_streak: {
        Args: { p_habit_id: string };
        Returns: void;
      };
      /** Offline sync push for auth.uid() (at most 500 changes); `{ skipped: [{ tbl, id, reason: 'rejected' }] }`. */
      sync_push: {
        Args: { p_changes: Json };
        Returns: Json;
      };
      /** Offline sync pull for auth.uid(): `{ changes, cursor, hasMore }`, p_limit clamped to 1..500. */
      sync_pull: {
        Args: { p_cursor: number; p_limit: number };
        Returns: Json;
      };
      completion_id: {
        Args: { p_habit: string; p_date: string };
        Returns: string;
      };
    };
    Enums: {
      theme_type: "light" | "dark" | "midnight" | "forest" | "sunset";
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
