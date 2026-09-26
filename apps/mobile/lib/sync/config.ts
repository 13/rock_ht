import * as SecureStore from "expo-secure-store";

export type SyncConfig =
  | { kind: "off" }
  | { kind: "selfhost"; baseUrl: string }
  | { kind: "supabase"; url: string; anonKey: string };

const KEY = "rock_ht.sync_config";

/** Off unless the user connected a backend in Settings > Sync. A corrupt entry also reads as Off. */
export async function loadSyncConfig(): Promise<SyncConfig> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return { kind: "off" };
    const c = JSON.parse(raw) as SyncConfig;
    return c.kind === "selfhost" || c.kind === "supabase" ? c : { kind: "off" };
  } catch (e) {
    console.warn("[sync] unreadable sync config; treating sync as off", e);
    return { kind: "off" };
  }
}

export async function saveSyncConfig(c: SyncConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(c));
}

/** Human-readable server of a config, for Settings rows. */
export function describeSyncConfig(c: SyncConfig): string {
  switch (c.kind) {
    case "off": return "Off";
    case "selfhost": return c.baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    case "supabase": return c.url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}
