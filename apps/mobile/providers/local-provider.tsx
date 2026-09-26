import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import * as SplashScreen from "expo-splash-screen";
import type { LocalStore } from "@rock_ht/local-db";
import { openLocalStore, resetLocalStore, resolveUserId } from "@/lib/local";

type LocalContext = { store: LocalStore; userId: string; refreshUserId: () => Promise<void> };

const Context = createContext<LocalContext | undefined>(undefined);

export function LocalProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<{ store: LocalStore; userId: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const store = await openLocalStore();
      const userId = await resolveUserId(store);
      await store.ensureProfile(userId);
      setError(null);
      setValue({ store, userId });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      Sentry.captureException(err);
      resetLocalStore();
      setError(err);
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Re-resolve the identity after sign-in/disconnect. Unlike the initial load, a failure here is
   * rethrown to the caller (shown inline) and keeps the current tree instead of the error screen:
   * the store is open and still usable under the previous id.
   */
  const refreshUserId = useCallback(async () => {
    const store = await openLocalStore();
    const userId = await resolveUserId(store);
    await store.ensureProfile(userId);
    setValue((cur) => (cur && cur.store === store && cur.userId === userId ? cur : { store, userId }));
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#f4f4f8" }}>Couldn't open your data</Text>
        <Text style={{ fontSize: 13, color: "#6b7280", textAlign: "center" }}>{error.message}</Text>
        <TouchableOpacity
          onPress={() => void load()}
          style={{ marginTop: 8, backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!value) return null;
  return <Context.Provider value={{ ...value, refreshUserId }}>{children}</Context.Provider>;
}

export function useLocal() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useLocal must be used within LocalProvider");
  return ctx;
}
