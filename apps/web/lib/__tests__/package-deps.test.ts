import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The web Docker image runs `npm ci` on node:20-alpine without a compiler, so a
// native module in web's (dev)dependencies breaks every image build. Tests that
// need better-sqlite3 / @rock_ht/local-db resolve them through the root install.
const NATIVE_OR_MOBILE_ONLY = ["better-sqlite3", "@types/better-sqlite3", "@rock_ht/local-db"];

describe("apps/web package.json", () => {
  it("has no native or mobile-only dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(NATIVE_OR_MOBILE_ONLY.filter((name) => name in all)).toEqual([]);
  });
});
