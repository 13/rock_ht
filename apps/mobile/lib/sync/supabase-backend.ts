// This module is only ever loaded through remote-factory's dynamic import, so the Off and
// self-hosted paths never evaluate supabase-js or the URL polyfill.
import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient, isAuthRetryableFetchError, processLock } from "@supabase/supabase-js";
import { createSupabaseRemote, SyncAuthError, withTimeout } from "@rock_ht/sync";
import { createChunkedStorage } from "./chunked-storage";
import { ConfirmEmailError } from "./errors";
import type { SyncBackend } from "./remote-factory";

/**
 * SecureStore key of a project's session. Per project URL, so switching to another project (or
 * back) never reuses a session issued by a different auth server. SecureStore keys may only hold
 * alphanumerics, `.`, `-` and `_`.
 */
export function sessionStorageKey(url: string): string {
  return `rock_ht.sb.${url.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** PostgREST's own signal that the JWT it was sent has expired (PGRST301), or the message Supabase's
 *  RPCs raise for the same condition. Narrower than `@rock_ht/sync`'s full `AUTH_CODES` set (which
 *  also covers "no session at all") — this is specifically "had one, it just expired". */
function isJwtExpiry(error: { message: string; code?: string } | null | undefined): boolean {
  return error?.code === "PGRST301" || /jwt expired/i.test(error?.message ?? "");
}

export async function supabaseBackend(url: string, anonKey: string): Promise<SyncBackend> {
  const storageKey = sessionStorageKey(url);
  // A session (JWT + refresh token + user) is larger than one SecureStore entry allows.
  const storage = createChunkedStorage(SecureStore);
  const client = createClient(url, anonKey, {
    auth: {
      storage,
      storageKey,
      persistSession: true,
      // No background refresh timer: supabase-js refreshes an expired access token on demand in
      // getSession(), which every rpc() and the backend below go through before each request.
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Serialises concurrent refreshes in this JS runtime (navigator.locks doesn't exist in RN), so
      // a sync run and a session check can't both spend the same single-use refresh token.
      lock: processLock,
    },
  });

  /** The signed-in session, or null when there is none (never signed in, signed out, or the refresh
   *  token was rejected). Throws when the server couldn't be reached to refresh an expired token:
   *  that's "offline", not "signed out". Timed out like every other auth round trip below. */
  async function session() {
    const { data, error } = await withTimeout("getSession", client.auth.getSession());
    if (!data.session && error && isAuthRetryableFetchError(error)) throw new Error(error.message);
    return data.session;
  }

  async function clearLocalSession(): Promise<void> {
    for (const k of [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`]) {
      await storage.removeItem(k).catch(() => {});
    }
  }

  return {
    remote: createSupabaseRemote({
      async rpc(fn, args) {
        // Without a session supabase-js would send the anon key and get a 401 back; fail the same
        // way without the round trip.
        if (!(await session())) throw new SyncAuthError("No Supabase session");
        const res = await client.rpc(fn, args);
        // autoRefreshToken is off, and getSession() above only refreshes a token supabase-js already
        // knows is expired — a token that expired *since* that check (e.g. a long-running push) isn't
        // caught until PostgREST itself rejects it. Refresh once and retry, rather than surfacing a
        // transient SyncAuthError for something a silent refresh would have fixed.
        if (res.error && isJwtExpiry(res.error)) {
          const { error: refreshError } = await withTimeout("refreshSession", client.auth.refreshSession());
          if (refreshError) throw new SyncAuthError(refreshError.message || "Session refresh failed");
          return client.rpc(fn, args);
        }
        return res;
      },
    }),
    async signIn(email, password) {
      const { data, error } = await withTimeout("signIn", client.auth.signInWithPassword({ email, password }));
      if (error || !data.user) throw new Error(error?.message || "Sign-in failed");
      return data.user.id;
    },
    async signUp(email, password, name) {
      // handle_new_user (008) names the profile from full_name, then name.
      const { data, error } = await withTimeout(
        "signUp",
        client.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, name } },
        }),
      );
      if (error || !data.user) throw new Error(error?.message || "Sign-up failed");
      // Email confirmation on: no session until the link is clicked, so there is nothing to claim yet.
      if (!data.session) throw new ConfirmEmailError();
      return data.user.id;
    },
    async signOut() {
      // Only this device's session. signOut keeps the stored session when it can't reach the
      // server, but disconnecting must work offline, so the local copy is always dropped — also
      // when the call hangs: it is timed out like every other auth round trip, and the finally
      // below still runs.
      try {
        await withTimeout("signOut", client.auth.signOut({ scope: "local" }));
      } finally {
        await clearLocalSession();
      }
    },
    async currentUserId() {
      // A local session is the cheap first check: definitely signed out (or never signed in) if
      // there isn't one, with no round trip. But a *present* local session only proves this device
      // once had a valid token — it says nothing about whether the server has since revoked it (the
      // user changed their password, or an admin kicked the session). getUser() re-validates the
      // token against the server on every call, unlike getSession()'s local/cached check.
      if (!(await session())) return null;
      const { data, error } = await withTimeout("getUser", client.auth.getUser());
      if (error) {
        // Unreachable server: offline, not signed out — let the caller keep treating sync as merely
        // interrupted rather than flipping to "signed out".
        if (isAuthRetryableFetchError(error)) throw new Error(error.message);
        // Any other error (invalid/expired/revoked token, user deleted, ...) means the server no
        // longer recognizes this device's session.
        return null;
      }
      return data.user?.id ?? null;
    },
  };
}
