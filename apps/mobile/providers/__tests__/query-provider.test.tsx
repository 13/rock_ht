import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

// The real LocalProvider opens expo-sqlite; the test drives the identity directly.
let currentUserId = "local-device";
vi.mock("../local-provider", () => ({ useLocal: () => ({ userId: currentUserId }) }));

const { QueryProvider } = await import("../query-provider");

type Row = { id: string; user_id: string };
let rows: Row[] = [];
const listHabits = (userId: string) => Promise.resolve(rows.filter((r) => r.user_id === userId));

let seen: Row[] | undefined;
let rootClient: QueryClient | undefined;

/** A screen that stays mounted across the identity switch (a tab under Sync settings). */
function TodayLike() {
  seen = useQuery({ queryKey: ["habits"], queryFn: () => listHabits(currentUserId) }).data;
  return null;
}
/** Where invalidations come from after the switch (useSyncTriggers, onSettled handlers). */
function RootLike() {
  rootClient = useQueryClient();
  return null;
}

const tree = () => (
  <QueryProvider>
    <RootLike />
    <TodayLike />
  </QueryProvider>
);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  currentUserId = "local-device";
  rows = [];
});

describe("QueryProvider across an identity switch", () => {
  it("a screen mounted before sign-in shows the account's rows afterwards", async () => {
    // Fresh device, nothing local yet.
    await act(async () => { renderer = create(tree()); });
    await flush();
    expect(seen).toEqual([]);

    // Sign in: the pull brings the account's rows, and the local identity switches to the account.
    rows = [{ id: "h1", user_id: "acct" }];
    currentUserId = "acct";
    await act(async () => { renderer!.update(tree()); });
    await flush();

    expect(seen).toEqual([{ id: "h1", user_id: "acct" }]);
  });

  it("invalidations issued after the switch still reach screens mounted before it", async () => {
    rows = [{ id: "h1", user_id: "local-device" }];
    await act(async () => { renderer = create(tree()); });
    await flush();
    expect(seen).toEqual([{ id: "h1", user_id: "local-device" }]);

    // Sign up: claim re-owns the device's rows, then the identity switches.
    rows = rows.map((r) => ({ ...r, user_id: "acct" }));
    currentUserId = "acct";
    await act(async () => { renderer!.update(tree()); });
    await flush();

    // A later local write (e.g. a toggle), then the invalidate its onSettled issues.
    rows = [...rows, { id: "h2", user_id: "acct" }];
    await act(async () => { await rootClient!.invalidateQueries(); });
    await flush();

    expect(seen).toEqual([
      { id: "h1", user_id: "acct" },
      { id: "h2", user_id: "acct" },
    ]);
  });
});
