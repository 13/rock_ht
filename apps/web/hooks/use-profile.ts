"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/providers/supabase-provider";
import { useAuth } from "./use-auth";
import {
  getProfile,
  updateProfile,
  type TypedSupabaseClient,
} from "@rock_ht/db";
import type { ProfileRow, UpdateProfileInput } from "@rock_ht/types";

export const PROFILE_KEY = ["profile"] as const;

function asDbClient(supabase: unknown): TypedSupabaseClient {
  return supabase as TypedSupabaseClient;
}

export function useProfile() {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const db = asDbClient(supabase);

  const query = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => getProfile(db, user!.id),
    enabled: !!user,
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      updateProfile(db, user!.id, input),
    onSuccess: (profile) => {
      queryClient.setQueryData<ProfileRow>(PROFILE_KEY, profile);
    },
  });

  return {
    profile: query.data ?? null,
    isLoading: query.isLoading,
    updateProfile: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
