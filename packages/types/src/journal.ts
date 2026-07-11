import type { Tables } from "./database.types";

export type JournalEntry = Tables<"journal_entries">;

export const MOOD_LABELS: Record<number, string> = {
  1: "Rough",
  2: "Meh",
  3: "Okay",
  4: "Good",
  5: "Great",
};

export const MOOD_EMOJIS: Record<number, string> = {
  1: "😔",
  2: "😐",
  3: "🙂",
  4: "😊",
  5: "🤩",
};

export interface CreateJournalEntryInput {
  habit_id?: string | null;
  entry_date?: string;
  content: string;
  mood?: number | null;
}

export interface UpdateJournalEntryInput {
  id: string;
  content?: string;
  mood?: number | null;
}
