import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncAuthError } from "@rock_ht/sync";

// The real module loads native SecureStore and the URL polyfill; the test drives supabase-js too.
const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { secure.set(k, v); },
  deleteItemAsync: async (k: string) => { secure.delete(k); },
}));
vi.mock("react-native-url-polyfill/auto", () => ({}));

type Session = { user: { id: string } } | null;
const auth = {
  session: null as Session,
  sessionError: null as { name: string; message: string } | null,
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  async getSession() { return { data: { session: auth.session }, error: auth.sessionError }; },
};
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { skipped: [] }, error: null, status: 200 }));
const createClient = vi.fn((_url: string, _key: string, _opts: { auth: { storageKey: string; storage: unknown } }) => ({ auth, rpc }));
class AuthRetryableFetchError extends Error { name = "AuthRetryableFetchError"; }
vi.mock("@supabase/supabase-js", () => ({
  createClient,
  processLock: async (_n: string, _t: number, fn: () => Promise<unknown>) => fn(),
  isAuthRetryableFetchError: (e: unknown) => e instanceof AuthRetryableFetchError,
}));

const { supabaseBackend, sessionStorageKey } = await import("../supabase-backend");
const { ConfirmEmailError } = await import("../errors");

beforeEach(() => {
  secure.clear();
  auth.session = null;
  auth.sessionError = null;
  auth.signUp.mockReset();
  auth.signInWithPassword.mockReset();
  auth.signOut.mockReset();
  rpc.mockClear();
  createClient.mockClear();
});

describe("supabaseBackend", () => {
  it("keeps each project's session under its own SecureStore-safe key", async () => {
    await supabaseBackend("http://10.0.2.2:54321", "anon");
    await supabaseBackend("https://abc.supabase.co", "anon");
    const keys = createClient.mock.calls.map((c) => c[2].auth.storageKey);
    expect(keys[0]).not.toBe(keys[1]);
    for (const k of keys) expect(k).toMatch(/^[\w.-]+$/);
    expect(sessionStorageKey("http://10.0.2.2:54321")).toBe(keys[0]);
  });

  it("signs up and returns the new user id when the project hands out a session", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: { user: { id: "u1" } } }, error: null });
    const b = await supabaseBackend("http://x.test", "anon");
    expect(await b.signUp("a@b.co", "password1", "Ann")).toBe("u1");
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@b.co", password: "password1", options: { data: { full_name: "Ann", name: "Ann" } },
    });
  });

  it("throws ConfirmEmailError when sign-up returns no session (email confirmation on)", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    const b = await supabaseBackend("http://x.test", "anon");
    await expect(b.signUp("a@b.co", "password1", "Ann")).rejects.toBeInstanceOf(ConfirmEmailError);
  });

  it("surfaces sign-in/sign-up errors", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } });
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "User already registered" } });
    const b = await supabaseBackend("http://x.test", "anon");
    await expect(b.signIn("a@b.co", "x")).rejects.toThrow("Invalid login credentials");
    await expect(b.signUp("a@b.co", "password1", "Ann")).rejects.toThrow("User already registered");
  });

  it("signs in and reports the user from the stored session", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u2" }, session: { user: { id: "u2" } } }, error: null });
    const b = await supabaseBackend("http://x.test", "anon");
    expect(await b.signIn("a@b.co", "pw")).toBe("u2");
    expect(await b.currentUserId()).toBeNull();
    auth.session = { user: { id: "u2" } };
    expect(await b.currentUserId()).toBe("u2");
  });

  it("throws (not signed out) when the session can't be refreshed because the server is unreachable", async () => {
    auth.sessionError = new AuthRetryableFetchError("Failed to fetch");
    const b = await supabaseBackend("http://x.test", "anon");
    await expect(b.currentUserId()).rejects.toThrow("Failed to fetch");
  });

  it("clears the stored session even when signing out can't reach the server", async () => {
    const b = await supabaseBackend("http://x.test", "anon");
    const key = sessionStorageKey("http://x.test");
    const storage = createClient.mock.calls[0]![2].auth.storage as { setItem(k: string, v: string): Promise<void> };
    await storage.setItem(key, "x".repeat(3000));
    await storage.setItem(`${key}-user`, "{}");
    auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError("Failed to fetch") });
    await b.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(secure.size).toBe(0);
  });

  it("fails sync with SyncAuthError without calling the server when there is no session", async () => {
    const b = await supabaseBackend("http://x.test", "anon");
    await expect(b.remote.push([])).rejects.toBeInstanceOf(SyncAuthError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("syncs through the sync_push/sync_pull RPCs while signed in", async () => {
    auth.session = { user: { id: "u1" } };
    const b = await supabaseBackend("http://x.test", "anon");
    expect(await b.remote.push([])).toEqual({ skipped: [] });
    expect(rpc).toHaveBeenCalledWith("sync_push", { p_changes: [] });
  });
});
