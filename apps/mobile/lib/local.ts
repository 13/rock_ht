import * as Crypto from "expo-crypto";
import { createLocalStore, migrate, type LocalStore } from "@rock_ht/local-db";
import { createExpoSqliteDriver } from "./sqlite-driver";

let pending: Promise<LocalStore> | null = null;

/** Forget a failed open so the next openLocalStore() retries. */
export function resetLocalStore(): void {
  pending = null;
}

export function openLocalStore(): Promise<LocalStore> {
  pending ??= (async () => {
    const driver = await createExpoSqliteDriver();
    await migrate(driver);
    return createLocalStore({
      driver,
      newId: () => Crypto.randomUUID(),
      now: () => new Date().toISOString(),
    });
  })();
  return pending;
}

/** The id rows are written under: the signed-in account if any, else a stable device id. */
export async function resolveUserId(store: LocalStore): Promise<string> {
  const account = await store.getMeta("account_user_id");
  if (account) return account;
  let local = await store.getMeta("local_user_id");
  if (!local) {
    local = Crypto.randomUUID();
    await store.setMeta("local_user_id", local);
  }
  return local;
}
