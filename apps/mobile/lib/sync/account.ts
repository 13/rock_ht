import type { LocalStore } from "@rock_ht/local-db";
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from "./config";
import { createBackend, type SyncBackend } from "./remote-factory";
import { pauseSync, resetSyncState, resumeSync, waitForSyncIdle } from "./service";

/** Turns fetch's bare "Network request failed" into something a user can act on. */
function friendly(e: unknown, config: SyncConfig): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/network request failed|failed to fetch|network error|timed? ?out/i.test(msg)) {
    const host = config.kind === "selfhost" ? config.baseUrl : config.kind === "supabase" ? config.url : "the server";
    return new Error(`Couldn't reach ${host}. Check the address and that the server is running.`);
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Sign in (or sign up) against `config`'s backend, then hand this device's data to that account:
 * save the config and `claim` (which also switches `account_user_id`). Resolves with the account id
 * once the claim's re-queue has run. The caller then refreshes the local identity and syncs.
 * Throws — with nothing saved — if the backend is unusable or the credentials are rejected.
 */
export async function connectSync(
  store: LocalStore,
  config: SyncConfig,
  creds: { mode: "signin" | "signup"; email: string; password: string; name: string },
): Promise<string> {
  // Stop new sync runs from starting (a launch/foreground/interval trigger could otherwise read
  // the config or account id mid-change) and let any run already in flight finish first, since it
  // was reading the *previous* account/config.
  pauseSync();
  try {
    await waitForSyncIdle();
    let backend: SyncBackend;
    let accountId: string;
    try {
      const b = await createBackend(config);
      if (!b) throw new Error("Choose a sync server first.");
      backend = b;
      accountId =
        creds.mode === "signup"
          ? await backend.signUp(creds.email.trim(), creds.password, creds.name.trim())
          : await backend.signIn(creds.email.trim(), creds.password);
    } catch (e) {
      throw friendly(e, config);
    }
    try {
      await saveSyncConfig(config);
      // Early-returns in the store when this device's rows already belong to accountId.
      const { completed } = await store.claim(accountId, { pushLocalProfile: creds.mode === "signup" });
      await completed;
      return accountId;
    } catch (e) {
      // The sign-in/up above already stored a session cookie for accountId. If anything after
      // that fails, the connection didn't go through, so leaving that cookie in place would let a
      // later, unrelated action (or a retry against a different server) silently run under this
      // half-connected account. Sign out locally — best effort, and works offline, since
      // @better-auth/expo clears its SecureStore cookie before it even attempts the network
      // request for /sign-out — before rethrowing.
      await backend.signOut().catch(() => {});
      throw e;
    }
  } finally {
    resumeSync();
  }
}

/**
 * Stop syncing: sign out of the backend (best effort — works offline), keep every row on the device
 * under the account id by making it the local identity, and switch sync Off. The caller then
 * refreshes the local identity.
 */
export async function disconnectSync(store: LocalStore): Promise<void> {
  // Same reasoning as connectSync: stop new runs and wait out any run already in flight before
  // rewriting the account id and config it reads.
  pauseSync();
  try {
    await waitForSyncIdle();
    const config = await loadSyncConfig();
    try {
      const backend = await createBackend(config);
      await backend?.signOut();
    } catch (e) {
      console.warn("[sync] sign-out failed; disconnecting locally anyway", e);
    }
    const accountId = await store.getMeta("account_user_id");
    // Local id first, so resolveUserId never sees neither id and mints a fresh one.
    if (accountId) await store.setMeta("local_user_id", accountId);
    await store.setMeta("account_user_id", null);
    await saveSyncConfig({ kind: "off" });
    await resetSyncState();
  } finally {
    resumeSync();
  }
}
