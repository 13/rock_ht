import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { useLocal } from "./local-provider";

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        networkMode: "always",
      },
      mutations: {
        networkMode: "always",
      },
    },
  });
}

/**
 * One cache per local identity: query keys don't carry the user id, so when sign-in (claim) or
 * disconnect switches `userId`, a fresh client guarantees no screen renders the previous user's
 * cached habits, completions or streaks — not even for the frame before a refetch.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { userId } = useLocal();
  const queryClient = useMemo(() => newQueryClient(), [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
