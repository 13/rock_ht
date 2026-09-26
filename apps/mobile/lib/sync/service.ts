import { runSync, type SyncReport } from "@rock_ht/sync";
import { openLocalStore } from "@/lib/local";
import { loadSyncConfig } from "./config";
import { createBackend } from "./remote-factory";

export type SyncState = {
  /** Sync is Off, or configured but no account is signed in. */
  off: boolean;
  syncing: boolean;
  error: string | null;
  at: string | null;
};

const LAST_SYNCED_KEY = "last_synced_at";

let inFlight: Promise<SyncReport | null> | null = null;
let state: SyncState = { off: true, syncing: false, error: null, at: null };
let loadedAt = false;
const listeners = new Set<(s: SyncState) => void>();
const pulledListeners = new Set<(r: SyncReport) => void>();

function emit(next: Partial<SyncState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  if (!loadedAt) {
    loadedAt = true;
    void refreshSyncState();
  }
  return () => { listeners.delete(fn); };
}

/** Called after a run that pulled rows, so the UI can refetch and reminders can be rebuilt. */
export function onSyncPulled(fn: (r: SyncReport) => void): () => void {
  pulledListeners.add(fn);
  return () => { pulledListeners.delete(fn); };
}

async function isOff(): Promise<boolean> {
  const config = await loadSyncConfig();
  if (config.kind === "off") return true;
  const store = await openLocalStore();
  return !(await store.getMeta("account_user_id"));
}

/** Re-read whether sync is on and when it last ran (after Settings > Sync connects or disconnects). */
export async function refreshSyncState(): Promise<void> {
  try {
    const store = await openLocalStore();
    emit({ off: await isOff(), at: await store.getMeta(LAST_SYNCED_KEY) });
  } catch (e) {
    console.warn("[sync] couldn't read sync state", e);
  }
}

/** Forget the last error and sync time (on disconnect). */
export async function resetSyncState(): Promise<void> {
  const store = await openLocalStore();
  await store.setMeta(LAST_SYNCED_KEY, null);
  emit({ error: null, at: null });
  await refreshSyncState();
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One push-then-pull pass. Single-flight: concurrent callers share one run. Resolves `null` without
 * touching the network when sync is Off or no account is signed in; never rejects (errors land in
 * the subscribed state).
 */
export function syncNow(): Promise<SyncReport | null> {
  inFlight ??= (async () => {
    try {
      const off = await isOff();
      if (off !== state.off) emit({ off });
      if (off) return null;
      const config = await loadSyncConfig();
      const store = await openLocalStore();
      emit({ syncing: true, error: null });
      const backend = await createBackend(config);
      if (!backend) return null;
      const report = await runSync(store.sync, backend.remote);
      const at = new Date().toISOString();
      await store.setMeta(LAST_SYNCED_KEY, at);
      emit({ at, error: null });
      if (report.pulled > 0) pulledListeners.forEach((l) => l(report));
      return report;
    } catch (error) {
      emit({ error: message(error) });
      return null;
    } finally {
      emit({ syncing: false });
      inFlight = null;
    }
  })();
  return inFlight;
}
