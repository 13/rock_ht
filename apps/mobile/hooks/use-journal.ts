import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/supabase-provider";
import { supabase } from "@/lib/supabase";
import {
  getJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
} from "@sisigo/db";
import type {
  JournalEntry,
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
} from "@sisigo/types";

export const JOURNAL_KEY = ["journal"] as const;

export function useJournal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: JOURNAL_KEY,
    queryFn: () => getJournalEntries(supabase, user!.id),
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateJournalEntryInput) =>
      createJournalEntry(supabase, user!.id, input),
    onSuccess: (entry) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old ? [entry, ...old] : [entry]
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateJournalEntryInput) =>
      updateJournalEntry(supabase, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e))
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => deleteJournalEntry(supabase, entryId),
    onSuccess: (_data, entryId) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.filter((e) => e.id !== entryId)
      );
    },
  });

  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    createEntry: createMutation.mutateAsync,
    updateEntry: updateMutation.mutateAsync,
    deleteEntry: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
