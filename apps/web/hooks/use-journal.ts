"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import {
  getJournalEntries,
  getJournalEntryForDate,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  type TypedSupabaseClient,
} from "@rock_ht/db";
import { today } from "@rock_ht/utils";
import type {
  JournalEntry,
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
} from "@rock_ht/types";

export const JOURNAL_KEY = ["journal"] as const;
export const TODAY_JOURNAL_KEY = ["journal", "today"] as const;

function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

export function useJournal(habitId?: string) {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const db = asDbClient(supabase);
  const todayStr = today();

  const query = useQuery({
    queryKey: habitId ? [...JOURNAL_KEY, "habit", habitId] : JOURNAL_KEY,
    queryFn: () => getJournalEntries(db, user!.id, { habitId }),
    enabled: !!user,
  });

  const todayQuery = useQuery({
    queryKey: TODAY_JOURNAL_KEY,
    queryFn: () => getJournalEntryForDate(db, user!.id, todayStr),
    enabled: !!user && !habitId,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateJournalEntryInput) =>
      createJournalEntry(db, user!.id, input),
    onSuccess: (entry) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old ? [entry, ...old] : [entry]
      );
      if (!entry.habit_id) {
        queryClient.setQueryData<JournalEntry | null>(TODAY_JOURNAL_KEY, entry);
      }
      if (entry.habit_id) {
        queryClient.invalidateQueries({
          queryKey: [...JOURNAL_KEY, "habit", entry.habit_id],
        });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateJournalEntryInput) =>
      updateJournalEntry(db, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e))
      );
      if (!updated.habit_id) {
        queryClient.setQueryData<JournalEntry | null>(TODAY_JOURNAL_KEY, (old) =>
          old?.id === updated.id ? updated : old ?? null
        );
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => deleteJournalEntry(db, entryId),
    onSuccess: (_data, entryId) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.filter((e) => e.id !== entryId)
      );
      queryClient.setQueryData<JournalEntry | null>(TODAY_JOURNAL_KEY, (old) =>
        old?.id === entryId ? null : old ?? null
      );
    },
  });

  // Upsert today's daily entry — creates if absent, updates if present
  const upsertTodayMutation = useMutation({
    mutationFn: async ({
      content,
      mood,
    }: {
      content: string;
      mood: number | null;
    }) => {
      const existing = todayQuery.data;
      if (existing) {
        return updateJournalEntry(db, { id: existing.id, content, mood });
      }
      return createJournalEntry(db, user!.id, { content, mood, entry_date: todayStr });
    },
    onSuccess: (entry) => {
      queryClient.setQueryData<JournalEntry | null>(TODAY_JOURNAL_KEY, entry);
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) => {
        if (!old) return [entry];
        const exists = old.some((e) => e.id === entry.id);
        return exists ? old.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...old];
      });
    },
  });

  return {
    entries: query.data ?? [],
    todayEntry: todayQuery.data ?? null,
    todayEntryLoading: todayQuery.isLoading,
    isLoading: query.isLoading,
    createEntry: createMutation.mutateAsync,
    updateEntry: updateMutation.mutateAsync,
    deleteEntry: deleteMutation.mutate,
    upsertToday: upsertTodayMutation.mutate,
    upsertTodayAsync: upsertTodayMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSavingToday: upsertTodayMutation.isPending,
  };
}
