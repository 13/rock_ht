import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncChange, SyncLocal, SyncRemote } from "@rock_ht/sync";

// The real service reads its store, config and backend through native modules; the test drives them.
const meta = new Map<string, string | null>();
let outbox: SyncChange[] = [];
let skippedPerPush = 0;

const local: SyncLocal = {
  async readOutbox(limit) { return outbox.slice(0, limit).map((change, i) => ({ seq: i + 1, change })); },
  async ackOutbox(upto) { outbox = outbox.slice(upto); },
  async getRow() { return null; },
  async getCursor() { return null; },
  async applyRemote() {},
};
const remote: SyncRemote = {
  async push(changes) {
    return { skipped: changes.slice(0, skippedPerPush).map((c) => ({ tbl: c.table, id: c.row.id, reason: "foreign_owner" })) };
  },
  async pull() { return { changes: [], cursor: null, hasMore: false }; },
};

vi.mock("@/lib/local", () => ({
  openLocalStore: async () => ({
    getMeta: async (k: string) => meta.get(k) ?? null,
    setMeta: async (k: string, v: string | null) => { meta.set(k, v); },
    sync: local,
  }),
}));
vi.mock("../config", () => ({ loadSyncConfig: async () => ({ kind: "selfhost", baseUrl: "http://x.test" }) }));
vi.mock("../remote-factory", () => ({ createBackend: async () => ({ remote, currentUserId: async () => "acct" }) }));

const service = await import("../service");

const habit = (id: string): SyncChange => ({ table: "habits", row: { id, updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null } });

describe("sync service: changes the server rejected", () => {
  beforeEach(async () => {
    meta.clear();
    meta.set("account_user_id", "acct");
    outbox = [];
    skippedPerPush = 0;
    await service.resetSyncState();
  });

  it("reports a clean run as no rejections", async () => {
    outbox = [habit("a")];
    expect(await service.syncNow()).toMatchObject({ pushed: 1, skipped: 0 });
    expect(service.getSyncState()).toMatchObject({ error: null, rejected: 0 });
  });

  it("keeps a warning (not a plain 'synced') once the server rejects changes, across later clean runs", async () => {
    outbox = [habit("a"), habit("b"), habit("c")];
    skippedPerPush = 2;
    await service.syncNow();
    expect(service.getSyncState()).toMatchObject({ error: null, rejected: 2 });
    expect(service.rejectedWarning(service.getSyncState().rejected)).toBe("2 changes were rejected by the server");
    // Acked like every other change: nothing is retried.
    expect(outbox).toEqual([]);

    skippedPerPush = 0;
    outbox = [habit("d")];
    await service.syncNow();
    expect(service.getSyncState().rejected).toBe(2);
    // Survives a restart of the service's in-memory state (persisted in the store's meta).
    await service.refreshSyncState();
    expect(service.getSyncState().rejected).toBe(2);
  });

  it("clears the warning when dismissed and on disconnect", async () => {
    outbox = [habit("a")];
    skippedPerPush = 1;
    await service.syncNow();
    expect(service.rejectedWarning(service.getSyncState().rejected)).toBe("1 change was rejected by the server");
    await service.dismissSyncWarning();
    expect(service.getSyncState().rejected).toBe(0);

    outbox = [habit("b")];
    await service.syncNow();
    expect(service.getSyncState().rejected).toBe(1);
    await service.resetSyncState();
    expect(service.getSyncState().rejected).toBe(0);
    expect(service.rejectedWarning(0)).toBeNull();
  });
});
