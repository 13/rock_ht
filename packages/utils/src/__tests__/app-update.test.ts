import { describe, expect, it } from "vitest";
import { compareVersions, evaluateRelease, parseVersion, pickApkAsset, sha256FromDigest, type GitHubRelease } from "../app-update";

const v = (s: string) => {
  const p = parseVersion(s);
  if (!p) throw new Error(`unparseable ${s}`);
  return p;
};

describe("parseVersion", () => {
  it("parses plain, v-prefixed and pre-release versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("v0.3.0")).toEqual({ major: 0, minor: 3, patch: 0, pre: [] });
    expect(parseVersion("0.3.0-dev.106")).toEqual({ major: 0, minor: 3, patch: 0, pre: ["dev", 106] });
  });
  it("rejects malformed input", () => {
    for (const s of ["", "1.2", "abc", "1.2.x", "v", "1.2.3-"]) expect(parseVersion(s)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by semver precedence", () => {
    const ordered = ["0.2.0", "0.3.0-dev.9", "0.3.0-dev.106", "0.3.0", "0.3.1", "0.4.0-dev.5", "1.0.0"] as const;
    for (let i = 0; i < ordered.length - 1; i++) {
      const current = ordered[i]!;
      const next = ordered[i + 1]!;
      expect(compareVersions(v(current), v(next))).toBeLessThan(0);
      expect(compareVersions(v(next), v(current))).toBeGreaterThan(0);
    }
    expect(compareVersions(v("v1.2.3"), v("1.2.3"))).toBe(0);
  });
});

const release = (over: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: "v0.3.0",
  html_url: "https://github.com/13/rock_ht/releases/tag/v0.3.0",
  body: "notes",
  assets: [
    { name: "rock_ht-0.3.0-abc1234-mapping.txt", size: 10, browser_download_url: "https://x/m.txt" },
    { name: "rock_ht-0.3.0-abc1234-release.APK", size: 42, browser_download_url: "https://x/a.apk", digest: "sha256:" + "a".repeat(64) },
  ],
  ...over,
});

describe("pickApkAsset / sha256FromDigest", () => {
  it("picks the apk regardless of case", () => {
    expect(pickApkAsset(release())?.browser_download_url).toBe("https://x/a.apk");
    expect(pickApkAsset(release({ assets: [] }))).toBeNull();
  });
  it("extracts only well-formed sha256 digests", () => {
    expect(sha256FromDigest("sha256:" + "A".repeat(64))).toBe("a".repeat(64));
    expect(sha256FromDigest("sha1:" + "a".repeat(40))).toBeNull();
    expect(sha256FromDigest("sha256:abc")).toBeNull();
    expect(sha256FromDigest(undefined)).toBeNull();
  });
});

describe("evaluateRelease", () => {
  it("offers a newer release", () => {
    const r = evaluateRelease("0.3.0-dev.106", release());
    expect(r.kind).toBe("available");
    if (r.kind === "available") {
      expect(r.version).toBe("0.3.0");
      expect(r.asset.size).toBe(42);
      expect(r.notes).toBe("notes");
    }
  });
  it("is up to date on equal or newer installs", () => {
    expect(evaluateRelease("0.3.0", release()).kind).toBe("up-to-date");
    expect(evaluateRelease("0.4.0-dev.2", release()).kind).toBe("up-to-date");
  });
  it("reports a newer release without an apk", () => {
    expect(evaluateRelease("0.2.0", release({ assets: [] }))).toEqual({ kind: "no-apk", releaseUrl: release().html_url });
  });
  it("refuses to compare unreadable versions", () => {
    expect(evaluateRelease("dev", release()).kind).toBe("unreadable-version");
    expect(evaluateRelease("0.2.0", release({ tag_name: "nightly" })).kind).toBe("unreadable-version");
  });
});
