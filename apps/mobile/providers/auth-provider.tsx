import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/react-native";
import { useLocal } from "./local-provider";
import { disconnectSync } from "@/lib/sync/account";
import { onSyncPulled } from "@/lib/sync/service";

type AuthUser = { id: string; email: string | null; created_at: string };
type AuthContext = { user: AuthUser; loading: boolean; signOut: () => Promise<void> };

const Context = createContext<AuthContext | undefined>(undefined);

/**
 * Offline-first: there is always a user — the local identity from `LocalProvider`. `user.id` is
 * always the *current* `userId`; the email/created_at are only shown once fetched for that same id,
 * so a sign-in or disconnect never displays the previous identity's details while the new profile
 * loads. `signOut` disconnects sync (same as Settings > Sync > Disconnect); data stays on the device.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { store, userId, refreshUserId } = useLocal();
  const [profile, setProfile] = useState<{ forId: string; email: string | null; created_at: string } | null>(null);
  // A pull can bring the account's real profile (email) after sign-in.
  const [pulls, setPulls] = useState(0);
  useEffect(() => onSyncPulled(() => setPulls((n) => n + 1)), []);

  useEffect(() => {
    let current = true;
    void store
      .getProfile(userId)
      .then((p) => {
        if (!current) return;
        setProfile({ forId: userId, email: p?.email || null, created_at: p?.created_at ?? new Date().toISOString() });
      })
      .catch((e) => {
        Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      current = false;
    };
  }, [store, userId, pulls]);

  const loaded = profile?.forId === userId ? profile : null;
  const user: AuthUser = {
    id: userId,
    email: loaded?.email ?? null,
    created_at: loaded?.created_at ?? new Date().toISOString(),
  };

  const signOut = useCallback(async () => {
    await disconnectSync(store);
    await refreshUserId();
  }, [store, refreshUserId]);

  return <Context.Provider value={{ user, loading: !loaded, signOut }}>{children}</Context.Provider>;
}

export function useAuth() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
