import * as SecureStore from "expo-secure-store";
import { createHttpRemote, type SyncRemote } from "@rock_ht/sync";
import type { SyncConfig } from "./config";

export interface SyncBackend {
  remote: SyncRemote;
  /** Returns the account user id. */
  signIn(email: string, password: string): Promise<string>;
  /** Returns the new account's user id. */
  signUp(email: string, password: string, name: string): Promise<string>;
  signOut(): Promise<void>;
  /** The signed-in account per the server's session, or null (signed out, expired or unreachable). */
  currentUserId(): Promise<string | null>;
}

type AuthResult<T> = { data: T | null; error: { message?: string; status?: number } | null };

function must<T>(r: AuthResult<T>): T {
  if (r.error || !r.data) throw new Error(r.error?.message || `auth failed${r.error?.status ? ` (${r.error.status})` : ""}`);
  return r.data;
}

/** Normalises a user-typed server URL: trims, drops trailing slashes, rejects anything but http(s). */
export function normalizeServerUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error("Enter a server URL starting with https:// or http://");
  return url;
}

async function selfHostBackend(baseUrl: string): Promise<SyncBackend> {
  // Loaded on first use so the Off path never evaluates the auth client.
  const { createAuthClient } = await import("better-auth/react");
  const { expoClient } = await import("@better-auth/expo/client");
  const auth = createAuthClient({
    baseURL: baseUrl,
    // Must match app.json "scheme" and the intent filter in AndroidManifest.xml.
    plugins: [expoClient({ scheme: "rockht", storagePrefix: "rock_ht", storage: SecureStore })],
  });
  return {
    remote: createHttpRemote({
      baseUrl,
      getHeaders: async (): Promise<Record<string, string>> => {
        const cookie = await auth.getCookie();
        return cookie ? { Cookie: cookie } : {};
      },
    }),
    async signIn(email, password) {
      return must(await auth.signIn.email({ email, password })).user.id;
    },
    async signUp(email, password, name) {
      return must(await auth.signUp.email({ email, password, name })).user.id;
    },
    async signOut() {
      await auth.signOut();
    },
    async currentUserId() {
      const s = await auth.getSession();
      return s.data?.user.id ?? null;
    },
  };
}

// One backend (and auth client) per config, so cookies/session caching live across syncs.
let cached: { key: string; backend: Promise<SyncBackend> } | null = null;

/** `null` for Off. Throws for a config that can't be used (e.g. Supabase before Task 15). */
export async function createBackend(c: SyncConfig): Promise<SyncBackend | null> {
  if (c.kind === "off") return null;
  const key = JSON.stringify(c);
  if (cached?.key !== key) {
    const backend =
      c.kind === "selfhost"
        ? selfHostBackend(normalizeServerUrl(c.baseUrl))
        : import("./supabase-backend").then((m) => m.supabaseBackend(c.url, c.anonKey));
    cached = { key, backend };
    // Don't cache a failure: the next attempt (e.g. after an app update) tries again.
    backend.catch(() => { if (cached?.key === key) cached = null; });
  }
  return cached.backend;
}
