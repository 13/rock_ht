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
        };
        Insert: {
          id?: string;
          habit_id: string;
          user_id: string;
          completed_date: string;
          value?: number;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          habit_id?: string;
          user_id?: string;
          completed_date?: string;
          value?: number;
          note?: string | null;
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
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string | null;
          entry_date?: string;
          content?: string;
          mood?: number | null;
          updated_at?: string;
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
