import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/react-native";
import { useLocal } from "./local-provider";

type AuthUser = { id: string; email: string | null; created_at: string };
type AuthContext = { user: AuthUser; loading: boolean; signOut: () => Promise<void> };

const Context = createContext<AuthContext | undefined>(undefined);

/** Offline-first: there is always a user. Signing out of a sync backend is handled in Task 11. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { store, userId } = useLocal();
  const [user, setUser] = useState<AuthUser>({ id: userId, email: null, created_at: new Date().toISOString() });

  useEffect(() => {
    let current = true;
    void store
      .getProfile(userId)
      .then((p) => {
        // Stale guard: ignore a profile fetched for a userId this effect has since moved past
        // (e.g. sign-in swaps the local user mid-flight).
        if (!current) return;
        setUser({ id: userId, email: p?.email || null, created_at: p?.created_at ?? new Date().toISOString() });
      })
      .catch((e) => {
        Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      current = false;
    };
  }, [store, userId]);

  return (
    <Context.Provider value={{ user, loading: false, signOut: async () => {} }}>
      {children}
    </Context.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
