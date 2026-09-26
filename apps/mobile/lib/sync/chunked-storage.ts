/** The expo-secure-store functions this module uses (injected so tests can stand in). */
export interface SecureKV {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The async `storage` shape supabase-js's auth client accepts. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// expo-secure-store warns (and may start throwing) above 2048 bytes per value, and a Supabase
// session (JWT + refresh token + user object) is usually 2-4 KB. 680 UTF-16 code units is at most
// 2040 UTF-8 bytes even if every character takes 3 bytes.
export const CHUNK_CHARS = 680;
const MARKER = "rock_ht.chunks:";

const chunkKey = (key: string, i: number) => `${key}.${i}`;

function split(value: string, size: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < value.length) {
    let end = Math.min(i + size, value.length);
    // Never split a surrogate pair: a lone surrogate doesn't survive the UTF-8 round trip natively.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(value.slice(i, end));
    i = end;
  }
  return out;
}

/**
 * Key-value storage over SecureStore that splits values too large for one entry across
 * `<key>.0 … <key>.<n-1>`, with `<key>` holding a `rock_ht.chunks:<n>` marker. Small values are
 * stored under `<key>` as-is. Keys must already be SecureStore-safe (alphanumerics, `.`, `-`, `_`).
 */
export function createChunkedStorage(kv: SecureKV, chunkChars = CHUNK_CHARS): AsyncStorageLike {
  async function chunkCount(key: string): Promise<number> {
    const head = await kv.getItemAsync(key);
    if (!head?.startsWith(MARKER)) return 0;
    const n = Number(head.slice(MARKER.length));
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  async function deleteChunks(key: string, from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) await kv.deleteItemAsync(chunkKey(key, i));
  }

  return {
    async getItem(key) {
      const head = await kv.getItemAsync(key);
      if (head === null || !head.startsWith(MARKER)) return head;
      const n = Number(head.slice(MARKER.length));
      if (!Number.isInteger(n) || n <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await kv.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // interrupted write: treat as no value rather than a torn one
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key, value) {
      const previous = await chunkCount(key);
      if (value.length <= chunkChars && !value.startsWith(MARKER)) {
        await kv.setItemAsync(key, value);
        await deleteChunks(key, 0, previous);
        return;
      }
      const parts = split(value, chunkChars);
      for (let i = 0; i < parts.length; i++) await kv.setItemAsync(chunkKey(key, i), parts[i]!);
      await kv.setItemAsync(key, `${MARKER}${parts.length}`);
      await deleteChunks(key, parts.length, previous);
    },
    async removeItem(key) {
      const previous = await chunkCount(key);
      await kv.deleteItemAsync(key);
      await deleteChunks(key, 0, previous);
    },
  };
}
