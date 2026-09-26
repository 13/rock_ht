import { useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import { getSyncState, onSyncPulled, rejectedWarning, subscribeSync, syncNow, type SyncState } from "@/lib/sync/service";
import { useLocal } from "@/providers/local-provider";
import { rebuildRemindersFromStore } from "@/hooks/use-reminders";

/** "warning": the last runs succeeded, but the server rejected some changes (see `SyncState.rejected`). */
export type SyncStatus = "off" | "idle" | "syncing" | "error" | "signed-out" | "warning";

export function useSync(): {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  /** e.g. "2 changes were rejected by the server"; null when nothing was. */
  warning: string | null;
  syncNow: () => void;
} {
  const [state, setState] = useState<SyncState>(getSyncState);
  useEffect(() => subscribeSync(setState), []);
  return {
    status: state.off
      ? "off"
      : state.signedOut
        ? "signed-out"
        : state.syncing
          ? "syncing"
          : state.error
            ? "error"
            : state.rejected > 0
              ? "warning"
              : "idle",
    lastSyncedAt: state.at,
    error: state.error,
    warning: rejectedWarning(state.rejected),
    syncNow: () => void syncNow(),
  };
}

const INTERVAL_MS = 5 * 60_000;

/**
 * Mount once in the root layout: sync on launch, on foreground, on reconnect and every 5 minutes;
 * after a run that pulled rows, refetch every query and rebuild reminders for pulled habits.
 * Every trigger is a no-op while sync is Off.
 */
export function useSyncTriggers(): void {
  const qc = useQueryClient();
  const { store, userId } = useLocal();

  useEffect(
    () =>
      onSyncPulled(() => {
        void qc.invalidateQueries();
        rebuildRemindersFromStore(store, userId).catch((e) => Sentry.captureException(e));
      }),
    [qc, store, userId],
  );

  useEffect(() => {
    void syncNow();
    const app = AppState.addEventListener("change", (s) => { if (s === "active") void syncNow(); });
    // NetInfo fires once on subscribe too; single-flight folds it into the launch run.
    const net = NetInfo.addEventListener((s) => { if (s.isConnected) void syncNow(); });
    const timer = setInterval(() => void syncNow(), INTERVAL_MS);
    return () => { app.remove(); net(); clearInterval(timer); };
  }, []);
}
