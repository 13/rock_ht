import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The synced tables (habits, habit_completions, journal_entries) must only ever be soft-deleted:
 * offline devices learn about a delete by pulling its tombstone, so a hard delete is a row they
 * never hear about (and 008 drops the API delete policies, so it would silently affect 0 rows).
 */
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "__tests__", ".turbo", "out", "e2e"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("synced tables are only soft-deleted", () => {
  it("packages/db/src never calls .delete(", () => {
    const offenders = sourceFiles(join(repoRoot, "packages/db/src")).filter((f) =>
      /\.delete\s*\(/.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it("apps/web never hard-deletes habits, habit_completions or journal_entries", () => {
    // `.from("<synced table>")` followed by `.delete(` before the statement ends.
    const pattern =
      /\.from\(\s*["'`](habits|habit_completions|journal_entries)["'`]\s*\)[^;]*?\.delete\s*\(/;
    const offenders = sourceFiles(join(repoRoot, "apps/web")).filter((f) =>
      pattern.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it("the guard pattern catches a hard delete", () => {
    const pattern =
      /\.from\(\s*["'`](habits|habit_completions|journal_entries)["'`]\s*\)[^;]*?\.delete\s*\(/;
    expect(pattern.test('await client\n  .from("habits")\n  .delete()\n  .eq("id", id);')).toBe(true);
    expect(pattern.test('await client.from("habits").update({}); set.delete(x);')).toBe(false);
  });
});
