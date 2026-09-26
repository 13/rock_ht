import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/providers/local-provider";
import { syncNow } from "@/lib/sync/service";
import type {
  JournalEntry,
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
} from "@rock_ht/types";

export const JOURNAL_KEY = ["journal"] as const;

export function useJournal() {
  const { store, userId } = useLocal();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: JOURNAL_KEY,
    queryFn: () => store.listJournal(userId),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateJournalEntryInput) => store.createJournal(userId, input),
    onSuccess: (entry) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old ? [entry, ...old] : [entry]
      );
    },
    onSettled: () => void syncNow(), // no-op while sync is Off
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateJournalEntryInput) => store.updateJournal(input),
    onSuccess: (updated) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e))
      );
    },
    onSettled: () => void syncNow(), // no-op while sync is Off
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => store.deleteJournal(entryId),
    onSuccess: (_data, entryId) => {
      queryClient.setQueryData<JournalEntry[]>(JOURNAL_KEY, (old) =>
        old?.filter((e) => e.id !== entryId)
      );
    },
    onSettled: () => void syncNow(), // no-op while sync is Off
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
