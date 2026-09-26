import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateProfileInput } from "@rock_ht/types";
import { useLocal } from "@/providers/local-provider";
import { syncNow } from "@/lib/sync/service";

export const PROFILE_KEY = ["profile"] as const;

export function useProfile() {
  const { store, userId } = useLocal();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: () => store.getProfile(userId) });
  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => store.updateProfile(userId, input),
    onSuccess: (p) => qc.setQueryData(PROFILE_KEY, p),
    onSettled: () => void syncNow(), // no-op while sync is Off
  });
  return { profile: query.data ?? null, isLoading: query.isLoading, updateProfile: mutation.mutateAsync };
}
