import { describe, expect, it } from "vitest";
import { createChunkedStorage, type SecureKV } from "../chunked-storage";

function memoryKV(maxBytes = 2048) {
  const m = new Map<string, string>();
  const kv: SecureKV = {
    async getItemAsync(k) { return m.get(k) ?? null; },
    async setItemAsync(k, v) {
      if (!/^[\w.-]+$/.test(k)) throw new Error(`invalid SecureStore key ${k}`);
      if (Buffer.byteLength(v, "utf8") > maxBytes) throw new Error(`value for ${k} over ${maxBytes} bytes`);
      m.set(k, v);
    },
    async deleteItemAsync(k) { m.delete(k); },
  };
  return { kv, m };
}

describe("createChunkedStorage", () => {
  it("stores a small value under its own key", async () => {
    const { kv, m } = memoryKV();
    const s = createChunkedStorage(kv);
    await s.setItem("a.b", "hello");
    expect(await s.getItem("a.b")).toBe("hello");
    expect([...m.keys()]).toEqual(["a.b"]);
  });

  it("returns null for a missing key", async () => {
    expect(await createChunkedStorage(memoryKV().kv).getItem("nope")).toBeNull();
  });

  it("splits a value larger than one SecureStore entry and reads it back", async () => {
    const { kv, m } = memoryKV();
    const s = createChunkedStorage(kv);
    const big = JSON.stringify({ access_token: "x".repeat(3000), user: { name: "Zoë 🚀".repeat(200) } });
    await s.setItem("sb", big);
    expect(await s.getItem("sb")).toBe(big);
    expect(m.size).toBeGreaterThan(3);
  });

  it("never splits a surrogate pair across chunks", async () => {
    const { kv, m } = memoryKV();
    const s = createChunkedStorage(kv, 5);
    const v = "abcd😀efgh😀ij";
    await s.setItem("k", v);
    expect(await s.getItem("k")).toBe(v);
    for (const [key, part] of m) {
      if (key === "k") continue;
      expect(part).toBe(Buffer.from(part, "utf8").toString("utf8"));
      expect(/[\ud800-\udbff]$/.test(part)).toBe(false);
    }
  });

  it("drops stale chunks when a value shrinks, and all chunks on remove", async () => {
    const { kv, m } = memoryKV();
    const s = createChunkedStorage(kv, 10);
    await s.setItem("k", "x".repeat(45));
    expect(m.size).toBe(6);
    await s.setItem("k", "y".repeat(15));
    expect(await s.getItem("k")).toBe("y".repeat(15));
    expect([...m.keys()].sort()).toEqual(["k", "k.0", "k.1"]);
    await s.setItem("k", "small");
    expect([...m.keys()]).toEqual(["k"]);
    await s.setItem("k", "z".repeat(25));
    await s.removeItem("k");
    expect(m.size).toBe(0);
  });

  it("reads a value with a missing chunk (interrupted write) as absent", async () => {
    const { kv, m } = memoryKV();
    const s = createChunkedStorage(kv, 10);
    await s.setItem("k", "x".repeat(25));
    m.delete("k.1");
    expect(await s.getItem("k")).toBeNull();
  });

  it("chunks a small value that happens to look like a marker instead of misreading it", async () => {
    const { kv } = memoryKV();
    const s = createChunkedStorage(kv);
    await s.setItem("k", "rock_ht.chunks:3");
    expect(await s.getItem("k")).toBe("rock_ht.chunks:3");
  });
});
