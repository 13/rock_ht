import type { LocalStore } from "@rock_ht/local-db";
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from "./config";
import { createBackend } from "./remote-factory";
import { resetSyncState } from "./service";

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
  let accountId: string;
  try {
    const backend = await createBackend(config);
    if (!backend) throw new Error("Choose a sync server first.");
    accountId =
      creds.mode === "signup"
        ? await backend.signUp(creds.email.trim(), creds.password, creds.name.trim())
        : await backend.signIn(creds.email.trim(), creds.password);
  } catch (e) {
    throw friendly(e, config);
  }
  await saveSyncConfig(config);
  // Early-returns in the store when this device's rows already belong to accountId.
  const { completed } = await store.claim(accountId, { pushLocalProfile: creds.mode === "signup" });
  await completed;
  return accountId;
}

/**
 * Stop syncing: sign out of the backend (best effort — works offline), keep every row on the device
 * under the account id by making it the local identity, and switch sync Off. The caller then
 * refreshes the local identity.
 */
export async function disconnectSync(store: LocalStore): Promise<void> {
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
}
