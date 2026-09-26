import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef, type ReactNode } from "react";
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
 *
 * Kept in a ref rather than `useMemo`: `useMemo` is only a cache React is allowed to discard and
 * recompute at will (e.g. under memory pressure), which would silently hand out a second client
 * for the same identity. A ref rebuilt during render when `userId` changes guarantees exactly one
 * `QueryClient` per identity, no more.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { userId } = useLocal();
  const clientRef = useRef<{ userId: string; client: QueryClient } | null>(null);
  if (clientRef.current === null || clientRef.current.userId !== userId) {
    clientRef.current = { userId, client: newQueryClient() };
  }

  return (
    <QueryClientProvider client={clientRef.current.client}>{children}</QueryClientProvider>
  );
}
