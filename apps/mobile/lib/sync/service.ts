import { runSync, SyncAuthError, type SyncReport } from "@rock_ht/sync";
import { openLocalStore } from "@/lib/local";
import { loadSyncConfig } from "./config";
import { createBackend } from "./remote-factory";

export type SyncState = {
  /** Sync is Off, or configured but no account is signed in. */
  off: boolean;
  /** Config is on and an account was signed in on this device, but the server no longer
   *  recognizes the session (cookie expired or was revoked). Sync runs are skipped until the
   *  user signs in again. */
  signedOut: boolean;
  syncing: boolean;
  error: string | null;
  at: string | null;
  /** Changes the server reported it will never apply (`SyncReport.skipped`), summed since this
   *  device connected or the user dismissed the warning. Non-zero means "synced, but with losses":
   *  the UI shows a warning instead of a plain "synced". The changes themselves are acked. */
  rejected: number;
};

const LAST_SYNCED_KEY = "last_synced_at";
const SESSION_CHECKED_KEY = "session_checked_at";
const REJECTED_KEY = "sync_rejected";
const SESSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let inFlight: Promise<SyncReport | null> | null = null;
// Set when syncNow() is called while a run is already in flight: that caller's config/state
// snapshot may be stale (e.g. it fired right after the user picked a new server), so instead of
// starting a second overlapping run we coalesce every such call into exactly one extra run right
// after the current one finishes.
let rerunRequested = false;
// Set while account.ts's connectSync/disconnectSync are rewriting the account/session under
// syncNow's feet, so a trigger firing mid-change can't race them. Cleared in their `finally`.
let paused = false;
// The previous run's runSync() threw SyncAuthError (a 401 mid-run, e.g. the session expired
// between the pre-run check and the push/pull). Forces the next run to re-check the session
// instead of waiting out the 24h interval.
let lastRunFailedAuth = false;
let state: SyncState = { off: true, signedOut: false, syncing: false, error: null, at: null, rejected: 0 };
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

/** The user-facing warning for `SyncState.rejected`, or null when nothing was rejected. */
export function rejectedWarning(rejected: number): string | null {
  if (rejected <= 0) return null;
  return rejected === 1 ? "1 change was rejected by the server" : `${rejected} changes were rejected by the server`;
}

function parseCount(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
    const off = await isOff();
    emit({
      off,
      signedOut: off ? false : state.signedOut,
      at: await store.getMeta(LAST_SYNCED_KEY),
      rejected: parseCount(await store.getMeta(REJECTED_KEY)),
    });
  } catch (e) {
    console.warn("[sync] couldn't read sync state", e);
  }
}

/** Forget the last error, sync time and session-check clock (on disconnect), so a later
 *  reconnect re-checks the session on its first run instead of trusting a stale timestamp. */
export async function resetSyncState(): Promise<void> {
  const store = await openLocalStore();
  await store.setMeta(LAST_SYNCED_KEY, null);
  await store.setMeta(SESSION_CHECKED_KEY, null);
  await store.setMeta(REJECTED_KEY, null);
  lastRunFailedAuth = false;
  emit({ error: null, at: null, signedOut: false, rejected: 0 });
  await refreshSyncState();
}

/** The user has seen the "rejected by the server" warning: back to a plain sync status. */
export async function dismissSyncWarning(): Promise<void> {
  const store = await openLocalStore();
  await store.setMeta(REJECTED_KEY, null);
  emit({ rejected: 0 });
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Prevents new sync runs from starting: `syncNow()` resolves to `null` immediately without
 *  touching the network or state. A run already in flight is unaffected — pair with
 *  `waitForSyncIdle()` to wait for it out. Cleared by `resumeSync()`. Used by account.ts's
 *  `connectSync`/`disconnectSync` while they rewrite the account/session, so a trigger (launch,
 *  foreground, reconnect, the 5-minute timer) can't race them. */
export function pauseSync(): void {
  paused = true;
}

export function resumeSync(): void {
  paused = false;
}

/** Resolves once no sync run is in flight (immediately if none is). Swallows any error from that
 *  run — `runOnce` never rejects anyway, but this is also safe to call speculatively. */
export function waitForSyncIdle(): Promise<void> {
  return inFlight ? inFlight.then(() => undefined, () => undefined) : Promise.resolve();
}

async function sessionCheckDue(store: Awaited<ReturnType<typeof openLocalStore>>): Promise<boolean> {
  const raw = await store.getMeta(SESSION_CHECKED_KEY);
  if (!raw) return true;
  const last = Number(raw);
  return !Number.isFinite(last) || Date.now() - last >= SESSION_CHECK_INTERVAL_MS;
}

/**
 * One push-then-pull pass. Single-flight: concurrent callers share one run, and a call that
 * arrives while a run is in flight queues exactly one more run afterward (see `rerunRequested`)
 * instead of joining or restarting it. Resolves `null` without touching the network when sync is
 * Off, paused (see `pauseSync`), no account is signed in, or the account's session has expired
 * (see "signed-out" below); never rejects (errors land in the subscribed state).
 */
export function syncNow(): Promise<SyncReport | null> {
  if (paused) return Promise.resolve(null);
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = runOnce();
  return inFlight;
}

async function runOnce(): Promise<SyncReport | null> {
  try {
    const off = await isOff();
    if (off) {
      if (off !== state.off || state.signedOut) emit({ off, signedOut: false });
      return null;
    }
    if (state.off) emit({ off: false });
    const config = await loadSyncConfig();
    const store = await openLocalStore();
    const backend = await createBackend(config);
    if (!backend) return null;

    // The better-auth cookie the backend attaches to every request is only ever renewed by a
    // set-cookie header on a better-auth *client* request; the sync push/pull routes don't send
    // one, so it silently expires (e.g. ~7 days after sign-in) and every sync after that would
    // otherwise 401 forever. Cheaply re-validate the session on a clock instead of every run, but
    // always right after a run actually hit a 401 (`lastRunFailedAuth`).
    if (lastRunFailedAuth || (await sessionCheckDue(store))) {
      const userId = await backend.currentUserId();
      await store.setMeta(SESSION_CHECKED_KEY, String(Date.now()));
      if (userId === null) {
        emit({ signedOut: true, error: null });
        return null;
      }
    }

    emit({ syncing: true, error: null, signedOut: false });
    // Captured so a disconnect or account switch mid-run doesn't attribute this run's
    // "last synced" timestamp to whichever account happens to be current when it finishes.
    const accountAtStart = await store.getMeta("account_user_id");
    const report = await runSync(store.sync, backend.remote);
    lastRunFailedAuth = false;
    if (report.skipped > 0) {
      const rejected = parseCount(await store.getMeta(REJECTED_KEY)) + report.skipped;
      await store.setMeta(REJECTED_KEY, String(rejected));
      emit({ rejected });
      console.warn(`[sync] the server rejected ${report.skipped} change(s)`);
    }
    if ((await store.getMeta("account_user_id")) === accountAtStart) {
      const at = new Date().toISOString();
      await store.setMeta(LAST_SYNCED_KEY, at);
      emit({ at, error: null });
    } else {
      emit({ error: null });
    }
    if (report.pulled > 0) pulledListeners.forEach((l) => l(report));
    return report;
  } catch (error) {
    if (error instanceof SyncAuthError) {
      lastRunFailedAuth = true;
      emit({ signedOut: true, error: null });
    } else {
      lastRunFailedAuth = false;
      emit({ error: message(error) });
    }
    return null;
  } finally {
    emit({ syncing: false });
    inFlight = null;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow();
    }
  }
}
