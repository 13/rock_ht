import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * One cache for the app's lifetime, reset whenever the local identity changes. Query keys don't
 * carry the user id, so when sign-in (claim) or disconnect switches `userId`, every cached query is
 * dropped and the mounted ones refetch under the new id.
 *
 * Not a fresh `QueryClient` per identity: `useQuery`/`useMutation` bind their observer to the client
 * of their *first* render, so screens that stay mounted across the switch (the tabs under Sync
 * settings) would keep reading — and never again be invalidated on — the discarded client, showing
 * the pre-sign-in cache until the app restarts.
 *
 * `resetQueries` runs in a passive effect: React runs children's effects before their parent's, so by
 * then every mounted `useQuery` has already applied its new options (a `queryFn` bound to the new
 * `userId`). There's one render in between where a mounted query still reads under the old id: for
 * sign-in/reconnecting to the same account (`claim`'s already-owned path) that shows the same rows,
 * since ids don't change; but for sign-up, disconnect-then-different-account, or any switch `claim`
 * re-keys (see `packages/local-db`'s `claim`/`rekey`), the row ids themselves change, so that one
 * frame briefly shows either nothing (new, still-empty ids) or the previous identity's now-orphaned
 * rows until the reset lands a moment later — never a mix of two identities' data at rest.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { userId } = useLocal();
  const [client] = useState(newQueryClient);
  const identity = useRef(userId);

  useEffect(() => {
    if (identity.current === userId) return;
    identity.current = userId;
    void client.resetQueries();
  }, [client, userId]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
