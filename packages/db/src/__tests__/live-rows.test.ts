import { describe, expect, it } from "vitest";
import { getStreaks } from "../streaks";
import { reorderHabits } from "../habits";
import { fakeClient } from "./fake-client";

describe("getStreaks", () => {
  it("joins habits and keeps only streaks of live (not soft-deleted) habits", async () => {
    const { client, queries } = fakeClient(() => ({ data: [], error: null }));
    await getStreaks(client, "user-1");

    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q.table).toBe("habit_streaks");
    expect(q.calls).toContainEqual(["select", "*, habits!inner(deleted_at)"]);
    expect(q.calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(q.calls).toContainEqual(["is", "habits.deleted_at", null]);
  });

  it("strips the embedded habits key from the returned rows", async () => {
    const row = { habit_id: "h1", user_id: "user-1", current_streak: 3, longest_streak: 5 };
    const { client } = fakeClient(() => ({
      data: [{ ...row, habits: { deleted_at: null } }],
      error: null,
    }));

    const result = await getStreaks(client, "user-1");
    expect(result).toEqual([row]);
    expect(result[0]).not.toHaveProperty("habits");
  });

  it("throws the query error", async () => {
    const err = { message: "boom", code: "XX000" };
    const { client } = fakeClient(() => ({ data: null, error: err }));
    await expect(getStreaks(client, "user-1")).rejects.toBe(err);
  });
});

describe("reorderHabits", () => {
  it("updates sort_order only on live habits", async () => {
    const { client, queries } = fakeClient(() => ({ data: null, error: null }));
    await reorderHabits(client, [
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 1 },
    ]);

    expect(queries).toHaveLength(2);
    for (const [i, q] of queries.entries()) {
      expect(q.table).toBe("habits");
      const update = q.calls.find(([m]) => m === "update");
      expect(update?.[1]).toMatchObject({ sort_order: i });
      expect(q.calls).toContainEqual(["eq", "id", i === 0 ? "a" : "b"]);
      expect(q.calls).toContainEqual(["is", "deleted_at", null]);
    }
  });
});
