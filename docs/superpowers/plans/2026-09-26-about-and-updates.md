# About & In-App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings gets an **About** section showing the version, build number, build date, commit and channel. Below it sits an inline **update** row: it checks the latest GitHub release of `13/rock_ht`, downloads the APK with progress, verifies its SHA-256 and hands it to the Android installer, all without leaving Settings.

**Architecture:**
- **Build facts at bundle time.** `scripts/build-apk.sh` exports `EXPO_PUBLIC_BUILD_DATE`, `EXPO_PUBLIC_GIT_SHA` and `EXPO_PUBLIC_UPDATE_REPO`, and Metro inlines them into the bundle. Version name and code come from the installed package through `expo-application`.
- **Pure logic in `@rock_ht/utils`, tested with vitest.** Covers version parsing and comparison (semver with pre-release), picking the APK asset, and deciding whether a release is newer.
- **Side effects in a mobile service** (`apps/mobile/lib/app-update.ts`):
  - fetch `https://api.github.com/repos/<repo>/releases/latest`,
  - download with the legacy `expo-file-system` download API for progress,
  - hash with `expo-crypto`,
  - install through `expo-intent-launcher` (`ACTION_VIEW` + content URI).
- **UI.** A small state machine drives the inline Settings row.

This mirrors the updater already running in Apex Weather (`~/repo/apexweather/app/src/main/kotlin/it/apexweather/update/`): public GitHub API with no token; `releases/latest` (drafts and pre-releases already excluded); verification against the asset's `digest` (`sha256:<hex>`) when GitHub publishes one; the cache cleared before every check; everything user-initiated.

**Tech Stack:** Expo SDK 55, `expo-application`, `expo-file-system` (legacy API for resumable downloads, `getContentUriAsync`), `expo-crypto`, `expo-intent-launcher`, vitest in `packages/utils`.

## Global Constraints

- **Repository and API:** repo `13/rock_ht` (public). API `https://api.github.com/repos/13/rock_ht/releases/latest`. No token ever ships in the app.
- **Manual only:** a check runs only when the user taps. There is no background or launch-time check in this plan.
- **Version comparison uses semver precedence**, with the `v` stripped from the tag:
  - `0.3.0-dev.106 < 0.3.0 < 0.3.1 < 0.4.0-dev.5`.
  - A release is offered only if it is strictly newer than the installed `versionName`.
  - Unparseable versions produce a "can't compare" state with a link to the release page, never an update offer.
- **Integrity:** if the asset has a `digest` starting `sha256:`, the downloaded file must match it or it is deleted and the UI shows a failure. If there is no digest, the UI says so ("not verified") and still allows the install; Android's signature check is the real gate.
- **Cache hygiene:** downloads go to `${FileSystem.cacheDirectory}updates/`. That directory is emptied at the start of every check and after a failure.
- **Permissions:** `android.permission.REQUEST_INSTALL_PACKAGES` goes in both `apps/mobile/app.json` and `apps/mobile/android/app/src/main/AndroidManifest.xml`. The feature only exists on Android: iOS hides the update row and keeps the About rows.
- **Build date and commit:** these come from env inlined at bundle time. In `expo start`/dev they show `dev`/`unknown`. Never fake them.
- **Themes:** use the existing theme tokens (`useTheme().colors`). No hex literals.
- **Devices:** the phone `RZCXA1ZEXJE` gets install and read-only checks only. The emulator can't run arm64, so build `--abi x86_64` for `emulator-5554`.
- `npm run type-check`, `npm run lint` and `npx turbo run test --force` must pass.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01XD64vPnTySw8Fk82cmxSNs`

## File structure

| File | Responsibility |
|---|---|
| `packages/utils/src/app-update.ts` (new) | Pure: `parseVersion`, `compareVersions`, `pickApkAsset`, `sha256FromDigest`, `evaluateRelease`. |
| `packages/utils/src/__tests__/app-update.test.ts` (new) | Tests for the above. |
| `scripts/build-apk.sh` | Export `EXPO_PUBLIC_BUILD_DATE`, `EXPO_PUBLIC_GIT_SHA`, `EXPO_PUBLIC_UPDATE_REPO`. |
| `apps/mobile/lib/build-info.ts` (new) | Assemble `BuildInfo` from `expo-application` and the env. |
| `apps/mobile/lib/app-update.ts` (new) | `checkForUpdate`, `downloadUpdate`, `installUpdate`, `clearUpdateCache`. |
| `apps/mobile/hooks/use-app-update.ts` (new) | UI state machine over the service. |
| `apps/mobile/components/settings/about-section.tsx` (new) | About rows plus the inline update row. |
| `apps/mobile/app/(tabs)/settings.tsx` | Render `<AboutSection />` at the bottom and drop any old static version line. |
| `apps/mobile/app.json`, `android/app/src/main/AndroidManifest.xml` | Permission. |

---

### Task 1: Update logic in `@rock_ht/utils` (TDD)

**Files:**
- Create: `packages/utils/src/app-update.ts`
- Create: `packages/utils/src/__tests__/app-update.test.ts`
- Modify: `packages/utils/src/index.ts` (export)

**Interfaces (produced):**

```ts
export interface Version { major: number; minor: number; patch: number; pre: (string | number)[] }
export function parseVersion(input: string): Version | null        // accepts "v1.2.3", "1.2.3", "1.2.3-dev.4"; rejects "1.2", "", "abc"
export function compareVersions(a: Version, b: Version): number     // semver precedence: <0, 0, >0
export interface ReleaseAsset { name: string; size: number; browser_download_url: string; digest?: string | null }
export interface GitHubRelease { tag_name: string; html_url: string; name?: string | null; body?: string | null; assets: ReleaseAsset[] }
export function pickApkAsset(release: GitHubRelease): ReleaseAsset | null   // first asset ending ".apk" (case-insensitive)
export function sha256FromDigest(digest: string | null | undefined): string | null  // "sha256:<64 hex>" → lowercase hex, else null
export type UpdateEvaluation =
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; asset: ReleaseAsset; releaseUrl: string; notes: string | null }
  | { kind: "no-apk"; releaseUrl: string }
  | { kind: "unreadable-version"; releaseUrl: string | null };
export function evaluateRelease(installedVersionName: string, release: GitHubRelease): UpdateEvaluation
```

- [ ] **Step 1: Write the failing tests**

`packages/utils/src/__tests__/app-update.test.ts` (match the style of the existing tests in that folder):

```ts
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
    const ordered = ["0.2.0", "0.3.0-dev.9", "0.3.0-dev.106", "0.3.0", "0.3.1", "0.4.0-dev.5", "1.0.0"];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(v(ordered[i]), v(ordered[i + 1]))).toBeLessThan(0);
      expect(compareVersions(v(ordered[i + 1]), v(ordered[i]))).toBeGreaterThan(0);
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
```

- [ ] **Step 2: Run the tests and see them fail.** Run `npm test -w @rock_ht/utils`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `app-update.ts`**

- `parseVersion`: use the regex `^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`. Split the pre-release on `.`, and turn all-digit parts into numbers.
- `compareVersions` follows semver §11:
  - Compare major, minor and patch numerically.
  - A version without a pre-release is greater than the same version with one.
  - Compare pre-release parts pairwise: numbers compare numerically, a number sorts before a string, strings compare lexically, and a shorter list sorts first when all its parts are equal.
- `pickApkAsset`: `assets.find(a => a.name.toLowerCase().endsWith(".apk")) ?? null`.
- `sha256FromDigest`: `/^sha256:([0-9a-fA-F]{64})$/`, returned lowercase.
- `evaluateRelease` checks in this order:
  1. Parse both versions. If either fails, return `unreadable-version` (with `releaseUrl: release.html_url || null`).
  2. If the release is not newer, return `up-to-date`.
  3. If there is no APK, return `no-apk`.
  4. Otherwise return `available` with `version` = the tag without its `v`, and `notes` = `body` or `null`.

Export everything from `packages/utils/src/index.ts`.

- [ ] **Step 4: Run the tests and see them pass.** Run `npm test -w @rock_ht/utils`, then the same command with `TZ=Pacific/Kiritimati`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(utils): add release version comparison and APK selection for in-app updates`.

---

### Task 2: Build info plumbing and the About section

**Files:**
- Modify: `scripts/build-apk.sh`
- Modify: `apps/mobile/package.json` (via `npx expo install expo-application`)
- Create: `apps/mobile/lib/build-info.ts`
- Create: `apps/mobile/components/settings/about-section.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`

**Interfaces (produced):**

```ts
export interface BuildInfo {
  versionName: string;        // Application.nativeApplicationVersion ?? "dev"
  versionCode: string;        // Application.nativeBuildVersion ?? "—"
  buildDate: string | null;   // ISO from EXPO_PUBLIC_BUILD_DATE, null in dev
  gitSha: string | null;      // short sha from EXPO_PUBLIC_GIT_SHA, null in dev
  channel: "release" | "dev" | "debug"; // __DEV__ → "debug"; versionName contains "-dev." → "dev"; else "release"
  updateRepo: string;         // EXPO_PUBLIC_UPDATE_REPO ?? "13/rock_ht"
}
export function getBuildInfo(): BuildInfo
```

- [ ] **Step 1: Export the build facts from `build-apk.sh`**

In the `# ---- app env` section, after `.env.local` is loaded, add:

```bash
# Inlined into the JS bundle by Metro; shown under Settings → About
export EXPO_PUBLIC_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export EXPO_PUBLIC_GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- || echo '+dirty')"
export EXPO_PUBLIC_UPDATE_REPO="${EXPO_PUBLIC_UPDATE_REPO:-13/rock_ht}"
```

CI calls the same script, so tagged builds get these values too.

- [ ] **Step 2: Install `expo-application` and write `lib/build-info.ts`**

In `apps/mobile`, run `npx expo install expo-application`. Then implement `getBuildInfo()` per the interface. Read each env var with a **literal** `process.env.EXPO_PUBLIC_…` member access, because Metro only inlines literal accesses.

- [ ] **Step 3: About section**

Create `components/settings/about-section.tsx`. It has a section title "About", matching the other Settings sections, with these rows:
- Version: `versionName`
- Build: `versionCode`
- Built: `buildDate` formatted in local time with `date-fns` `format(parseISO(x), "d MMM yyyy, HH:mm")`, or "Development build" when it is null
- Commit: `gitSha` or "—". A tap opens `https://github.com/<repo>/commit/<sha without +dirty>` via `Linking.openURL`, only when the sha is present.
- Channel: `release` / `dev` / `debug`
- Source code: taps open `https://github.com/<repo>`

Copy the row styling from the existing Settings rows and use theme tokens only. Render `<AboutSection />` as the last section of `settings.tsx`, and remove any existing static version or footer text it duplicates.

- [ ] **Step 4: Verify**

Run `npm run type-check`. Build for the emulator (`scripts/build-apk.sh --abi x86_64 --install emulator-5554`), open Settings, scroll to About and take a screenshot. Expected:
- the version matches `scripts/apk-version.sh`,
- the build number equals the commit count,
- the date is today's,
- the commit is the current short sha (with `+dirty` if the tree is dirty),
- the channel is `dev`.

Tapping Commit opens the browser to that commit.

- [ ] **Step 5: Commit** with the message `feat(mobile): About section with version, build, date and commit`.

---

### Task 3: Update service (Android)

**Files:**
- Modify: `apps/mobile/package.json` (via `npx expo install expo-intent-launcher`)
- Modify: `apps/mobile/app.json` (`android.permissions` += `android.permission.REQUEST_INSTALL_PACKAGES`)
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml` (same permission)
- Create: `apps/mobile/lib/app-update.ts`

**Interfaces:**
- Consumes: Task 1's `evaluateRelease`, `sha256FromDigest`, `GitHubRelease`, `ReleaseAsset` and `UpdateEvaluation`; Task 2's `getBuildInfo()`.
- Produces:

```ts
export type CheckResult = UpdateEvaluation | { kind: "network-error"; message: string };
export function checkForUpdate(): Promise<CheckResult>;
export type DownloadResult =
  | { kind: "ready"; fileUri: string; verified: boolean }
  | { kind: "digest-mismatch" }
  | { kind: "failed"; message: string };
export function downloadUpdate(
  asset: ReleaseAsset,
  onProgress: (written: number, total: number) => void,
): { promise: Promise<DownloadResult>; cancel: () => Promise<void> };
export function installUpdate(fileUri: string): Promise<void>;
export function clearUpdateCache(): Promise<void>;
```

- [ ] **Step 1: Dependencies and permission**

In `apps/mobile`, run `npx expo install expo-intent-launcher`. Then add the permission to both `app.json` and `AndroidManifest.xml`.

- [ ] **Step 2: Implement `lib/app-update.ts`**

Import the legacy file-system API from `expo-file-system/legacy`, which provides `cacheDirectory`, `createDownloadResumable`, `getContentUriAsync`, `deleteAsync` and `makeDirectoryAsync`.

- **`checkForUpdate`:**
  1. Call `clearUpdateCache()`.
  2. `fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })`, with a 10 s `AbortController` timeout.
  3. A non-2xx response, a timeout or a JSON error returns `network-error`. A 404 means the repo has no releases yet; return `network-error` with message "No releases published yet".
  4. Otherwise return `evaluateRelease(getBuildInfo().versionName, json)`.
- **`downloadUpdate`:**
  1. Run `makeDirectoryAsync(cacheDirectory + "updates/", { intermediates: true })`.
  2. Download with `createDownloadResumable(url, dir + asset.name, {}, cb)`, where `cb` forwards `totalBytesWritten` and `totalBytesExpectedToWrite` (falling back to `asset.size`) to `onProgress`.
  3. When it finishes, compute the SHA-256 of the file. Prefer the new `File` API from `expo-file-system` (`new File(uri).bytes()`) plus `Crypto.digest(CryptoDigestAlgorithm.SHA256, bytes)`, then hex-encode the resulting `ArrayBuffer`. If that path isn't available in SDK 55, read base64 → `Uint8Array` instead.
  4. If `sha256FromDigest(asset.digest)` is non-null and differs, delete the file and return `digest-mismatch`. Return `ready` with `verified = digest !== null`.
  5. On an error, delete the partial file and return `failed`. `cancel` calls `pauseAsync` and then deletes the file.
- **`installUpdate`:**

  ```ts
  const contentUri = await getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
  ```

  If the user hasn't allowed "Install unknown apps" for rock, Android shows its own prompt that leads to that setting. Don't reimplement it.
- **`clearUpdateCache`:** `deleteAsync(dir, { idempotent: true })`.

- [ ] **Step 3: Verify with type-check only.** Run `npm run type-check`; the UI arrives in Task 4.

- [ ] **Step 4: Commit** with the message `feat(mobile): GitHub release check, verified APK download and install handoff`.

---

### Task 4: Inline update row in Settings

**Files:**
- Create: `apps/mobile/hooks/use-app-update.ts`
- Modify: `apps/mobile/components/settings/about-section.tsx`

**Interfaces:**
- Consumes: Task 3's service.
- Produces `useAppUpdate()`, which returns a `state` (below) and `check()`, `download()`, `install()` and `cancel()`.

`state` is one of:
- `{ kind: "idle" }`
- `{ kind: "checking" }`
- `{ kind: "up-to-date"; checkedAt: Date }`
- `{ kind: "available"; version; sizeBytes; notes; releaseUrl }`
- `{ kind: "downloading"; written; total }`
- `{ kind: "ready"; version; verified }`
- `{ kind: "error"; message; releaseUrl?: string }`

- [ ] **Step 1: Hook**

`useAppUpdate` keeps the state in `useState` and holds the current `cancel` in a ref. It maps service results to states:
- `no-apk` becomes `error` "This release has no APK", with a link.
- `unreadable-version` becomes `error` "Can't compare versions", with a link.
- `digest-mismatch` becomes `error` "Download didn't match its checksum — deleted".

Throttle progress updates to at most about 10/s (round to whole percent). When the component unmounts during a download, cancel it.

- [ ] **Step 2: UI rows, Android only (`Platform.OS === "android"`), under the About rows:**

| state | row content |
|---|---|
| idle | "Check for updates" (tap: `check()`) |
| checking | spinner and "Checking…" |
| up-to-date | "You're on the latest version", "Checked HH:mm", tap to check again |
| available | "Version X available · 12.3 MB" with a primary **Download** button; release notes (first 300 chars, `textSecondary`) with a "Release notes" link that opens `releaseUrl` |
| downloading | a progress bar (track `colors.border`, fill `colors.primary`), "34% · 4.1 / 12.3 MB", and a **Cancel** text button |
| ready | "Version X downloaded", "Verified ✓" (or "Not verified — no checksum published" in `warning`), and a primary **Install** button |
| error | the message in `danger`, **Try again**, and "Open release page" when a URL exists |

Format sizes as MB with one decimal. Use theme tokens only, and give the Settings rows `hapticLight` on taps, as they have elsewhere.

- [ ] **Step 3: Verify on the emulator against a fake release**

1. Serve a fake API from the host.
   - Build an x86_64 APK with a *higher* version for the fake release (e.g. `EXPO_PUBLIC_…` unchanged, and temporarily tag nothing). Simplest route: copy the current build's APK as the asset, and set the fake `tag_name` to `v9.9.9` so the app offers it.
   - Serve `releases/latest` JSON plus the APK with `python3 -m http.server 8765` in a scratch dir laid out as `repos/13/rock_ht/releases/latest` (a file named `latest` with JSON content), with `browser_download_url` = `http://10.0.2.2:8765/app.apk` and `digest` = `sha256:<sha256sum of app.apk>`.
2. Point the build at it. Add a build-time override in `lib/app-update.ts`: `const API_BASE = process.env.EXPO_PUBLIC_UPDATE_API_BASE ?? "https://api.github.com"`. Build with `EXPO_PUBLIC_UPDATE_API_BASE=http://10.0.2.2:8765 scripts/build-apk.sh --abi x86_64 --install emulator-5554`. Release builds never set it.
3. Cleartext HTTP to 10.0.2.2 may be blocked on release builds. If so, serve over the host's `adb reverse tcp:8765 tcp:8765` and use `http://localhost:8765`, adding `usesCleartextTraffic` for **this test build only** via env. Or, if that gets messy, run the check against the real GitHub API once a release exists and skip this step. Report which route you took.
4. Flow and screenshots: Check → "Version 9.9.9 available" → Download (progress moves) → "Verified ✓" → Install. The Android install sheet or the "unknown apps" settings prompt appears; stop there.
5. Corrupt test: serve a digest of 64 zeros → "didn't match its checksum", and `adb shell run-as app.rockht.mobile ls cache/updates` is empty.
6. Offline test: stop the server → Check → a network error with Try again.

- [ ] **Step 4: Phone check (read-only)**

Run `scripts/build-apk.sh --install RZCXA1ZEXJE` without the override. Open Settings → About and take a screenshot: the version, build, date and commit are correct. Tap **Check for updates** once. It's read-only and hits the real API, so the expected result is "No releases published yet", up to date, or v0.2.0 being older. Don't download on the phone.

- [ ] **Step 5: Commit** with the message `feat(mobile): check, download and install app updates from Settings`.

---

## Self-review

- **About section** (version, build, date, commit, channel, source): Task 2.
- **Inline update from the GitHub APK:** Tasks 3–4, reusing the Apex Weather pattern (public API, digest check, cache hygiene, user-initiated steps).
- **Pure logic is unit-tested** (Task 1). The side-effect paths are verified on the emulator against a fake release, including the checksum failure and offline cases.
- **Dependency on the release pipeline:** real updates need GitHub releases with an APK asset. Those come from `android-apk.yml` on `v*` tags, which needs the signing secrets from the APK plan, Task 3 Step 4. Until then the check reports "No releases published yet".
- **Out of scope:** automatic or launch-time checks with notifications, iOS updates (App Store / TestFlight territory), and delta updates.
