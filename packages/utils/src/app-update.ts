export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  name?: string | null;
  body?: string | null;
  assets: ReleaseAsset[];
}

export type UpdateEvaluation =
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; asset: ReleaseAsset; releaseUrl: string; notes: string | null }
  | { kind: "no-apk"; releaseUrl: string }
  | { kind: "unreadable-version"; releaseUrl: string | null };

export function parseVersion(input: string): Version | null {
  const regex = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  const match = input.match(regex);

  if (!match) {
    return null;
  }

  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];
  const preStr = match[4];

  if (!majorStr || !minorStr || !patchStr) {
    return null;
  }

  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);

  let pre: (string | number)[] = [];
  if (preStr) {
    // Only all-digit identifiers are numeric (semver §9); "1a" stays a string
    pre = preStr.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  }

  return { major, minor, patch, pre };
}

export function compareVersions(a: Version, b: Version): number {
  // Compare major, minor, patch numerically
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }

  // A version without a pre-release is greater than the same version with one
  const aHasPre = a.pre.length > 0;
  const bHasPre = b.pre.length > 0;

  if (aHasPre && !bHasPre) {
    return -1; // a is pre-release, b is not: a < b
  }
  if (!aHasPre && bHasPre) {
    return 1; // a is not pre-release, b is: a > b
  }

  // Both have pre-releases or both don't: compare pre-release parts
  if (!aHasPre && !bHasPre) {
    return 0; // Both are same release
  }

  // Compare pre-release parts pairwise
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const aPart = a.pre[i];
    const bPart = b.pre[i];

    // A shorter list sorts first when all its parts are equal
    if (aPart === undefined) {
      return -1; // a is shorter
    }
    if (bPart === undefined) {
      return 1; // b is shorter
    }

    // Check if parts are numbers or strings
    const aIsNum = typeof aPart === "number";
    const bIsNum = typeof bPart === "number";

    if (aIsNum && bIsNum) {
      // Both numbers: compare numerically
      if (aPart !== bPart) {
        return aPart - bPart;
      }
    } else if (aIsNum && !bIsNum) {
      // Number vs string: number sorts first
      return -1;
    } else if (!aIsNum && bIsNum) {
      // String vs number: number sorts first
      return 1;
    } else {
      // Both strings: compare lexically
      // Semver compares identifiers in ASCII order, not by locale
      const aStr = aPart as string;
      const bStr = bPart as string;
      if (aStr !== bStr) {
        return aStr < bStr ? -1 : 1;
      }
    }
  }

  return 0;
}

export function pickApkAsset(release: GitHubRelease): ReleaseAsset | null {
  return release.assets.find((a) => a.name.toLowerCase().endsWith(".apk")) ?? null;
}

export function sha256FromDigest(digest: string | null | undefined): string | null {
  if (!digest) {
    return null;
  }

  const match = digest.match(/^sha256:([0-9a-fA-F]{64})$/);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].toLowerCase();
}

export function evaluateRelease(installedVersionName: string, release: GitHubRelease): UpdateEvaluation {
  // Step 1: Parse both versions
  const installedVersion = parseVersion(installedVersionName);
  const releaseVersion = parseVersion(release.tag_name);

  if (!installedVersion || !releaseVersion) {
    return {
      kind: "unreadable-version",
      releaseUrl: release.html_url || null,
    };
  }

  // Step 2: If the release is not newer, return up-to-date
  const cmp = compareVersions(releaseVersion as Version, installedVersion as Version);
  if (cmp <= 0) {
    return { kind: "up-to-date" };
  }

  // Step 3: If there is no APK, return no-apk
  const apk = pickApkAsset(release);
  if (!apk) {
    return { kind: "no-apk", releaseUrl: release.html_url };
  }

  // Step 4: Return available
  const versionWithoutV = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : release.tag_name;

  return {
    kind: "available",
    version: versionWithoutV,
    asset: apk,
    releaseUrl: release.html_url,
    notes: release.body || null,
  };
}
