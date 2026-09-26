import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalStore } from "@rock_ht/local-db";
import type { SyncConfig } from "../config";

vi.mock("../service", () => ({
  pauseSync: vi.fn(),
  resumeSync: vi.fn(),
  waitForSyncIdle: vi.fn(async () => {}),
  resetSyncState: vi.fn(async () => {}),
}));
vi.mock("../config", () => ({
  loadSyncConfig: vi.fn(async () => ({ kind: "off" })),
  saveSyncConfig: vi.fn(async () => {}),
}));

type SignResult = string | Error;
let signInResult: SignResult = "acct-1";
let signUpResult: SignResult = "acct-1";
const claimCalls: { toUserId: string; opts: { pushLocalProfile: boolean } }[] = [];
const backend = {
  remote: {} as never,
  signIn: vi.fn(async (_email: string, _password: string) => {
    if (signInResult instanceof Error) throw signInResult;
    return signInResult;
  }),
  signUp: vi.fn(async (_email: string, _password: string, _name: string) => {
    if (signUpResult instanceof Error) throw signUpResult;
    return signUpResult;
  }),
  signOut: vi.fn(async () => {}),
  currentUserId: vi.fn(async () => null),
};
vi.mock("../remote-factory", () => ({ createBackend: async () => backend }));

const { connectSync, disconnectSync, shouldPushProfileOnSignIn } = await import("../account");
const { ConfirmEmailError } = await import("../errors");

function fakeStore(): LocalStore {
  const meta = new Map<string, string | null>();
  return {
    async getMeta(k: string) { return meta.get(k) ?? null; },
    async setMeta(k: string, v: string | null) { meta.set(k, v); },
    async claim(toUserId: string, opts: { pushLocalProfile: boolean }) {
      claimCalls.push({ toUserId, opts });
      return { completed: Promise.resolve() };
    },
  } as unknown as LocalStore;
}

const selfhost: SyncConfig = { kind: "selfhost", baseUrl: "http://x.test" };

describe("shouldPushProfileOnSignIn", () => {
  it("matches the pending signup email case- and whitespace-insensitively", () => {
    expect(shouldPushProfileOnSignIn("a@b.co", "A@B.co")).toBe(true);
    expect(shouldPushProfileOnSignIn("a@b.co", " a@b.co ")).toBe(true);
  });

  it("is false when there is no pending email", () => {
    expect(shouldPushProfileOnSignIn(null, "a@b.co")).toBe(false);
  });

  it("is false when the emails differ", () => {
    expect(shouldPushProfileOnSignIn("a@b.co", "c@d.co")).toBe(false);
  });
});

describe("connectSync: profile push after email confirmation", () => {
  beforeEach(() => {
    claimCalls.length = 0;
    signInResult = "acct-1";
    signUpResult = "acct-1";
    backend.signOut.mockClear();
  });

  it("remembers the sign-up email when the server requires confirmation, without claiming anything", async () => {
    signUpResult = new ConfirmEmailError();
    const store = fakeStore();
    await expect(
      connectSync(store, selfhost, { mode: "signup", email: "New@Test.com", password: "password1", name: "N" }),
    ).rejects.toBeInstanceOf(ConfirmEmailError);
    expect(await store.getMeta("pending_signup_email")).toBe("new@test.com");
    expect(claimCalls).toEqual([]);
  });

  it("pushes the local profile on the next sign-in with the same (confirmed) email, then clears the marker", async () => {
    const store = fakeStore();
    await store.setMeta("pending_signup_email", "new@test.com");
    await connectSync(store, selfhost, { mode: "signin", email: "New@Test.com", password: "pw", name: "" });
    expect(claimCalls).toEqual([{ toUserId: "acct-1", opts: { pushLocalProfile: true } }]);
    expect(await store.getMeta("pending_signup_email")).toBeNull();
  });

  it("does not push the local profile, and keeps the marker, when the pending email differs", async () => {
    const store = fakeStore();
    await store.setMeta("pending_signup_email", "someone-else@test.com");
    await connectSync(store, selfhost, { mode: "signin", email: "new@test.com", password: "pw", name: "" });
    expect(claimCalls).toEqual([{ toUserId: "acct-1", opts: { pushLocalProfile: false } }]);
    expect(await store.getMeta("pending_signup_email")).toBe("someone-else@test.com");
  });

  it("a plain sign-in with no pending marker still just does a normal (non-pushing) claim", async () => {
    const store = fakeStore();
    await connectSync(store, selfhost, { mode: "signin", email: "new@test.com", password: "pw", name: "" });
    expect(claimCalls).toEqual([{ toUserId: "acct-1", opts: { pushLocalProfile: false } }]);
  });
});

describe("connectSync / disconnectSync: local-only account email", () => {
  beforeEach(() => {
    claimCalls.length = 0;
    signInResult = "acct-1";
  });

  it("stores the email used to connect, and disconnect clears it", async () => {
    const store = fakeStore();
    await connectSync(store, selfhost, { mode: "signin", email: "me@x.com", password: "pw", name: "" });
    expect(await store.getMeta("account_email")).toBe("me@x.com");
    await disconnectSync(store);
    expect(await store.getMeta("account_email")).toBeNull();
  });
});
