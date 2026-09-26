import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import {
  bytesToHex,
  digestExpectation,
  evaluateRelease,
  type GitHubRelease,
  type ReleaseAsset,
  type UpdateEvaluation,
} from "@rock_ht/utils";
import { getBuildInfo } from "./build-info";

// Metro only inlines EXPO_PUBLIC_* env vars read via a literal
// `process.env.EXPO_PUBLIC_…` member access (see lib/build-info.ts). This
// lets tests/dev point the update check at a local fixture server instead of
// the real GitHub API.
const API_BASE = process.env.EXPO_PUBLIC_UPDATE_API_BASE ?? "https://api.github.com";
// Same override, read again as a plain presence check: it's a signal that
// this is a test build pointed at a local fixture server, which is also the
// only situation where downloadUpdate is allowed to fetch a non-https URL.
const UPDATE_API_OVERRIDDEN = process.env.EXPO_PUBLIC_UPDATE_API_BASE != null;

const CHECK_TIMEOUT_MS = 10_000;
const UPDATES_DIR_NAME = "updates/";
// Fixed name, independent of the release asset's own file name: the asset
// name comes from an untrusted GitHub API response and must never be used to
// build a file-system path.
const DOWNLOAD_FILE_NAME = "update.apk";

function getUpdatesDir(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error("No cache directory available on this platform");
  }
  return FileSystem.cacheDirectory + UPDATES_DIR_NAME;
}

async function computeSha256(fileUri: string): Promise<string> {
  // expo-file-system's `File` class exposes `arrayBuffer()` in SDK 55 (there
  // is no `bytes()` method on this version). `Crypto.digest` types itself as
  // taking a `BufferSource`, but on Android the native module downcasts the
  // JS value to a `TypedArray` and reads its `.buffer` — handing it a plain
  // `ArrayBuffer` throws there. Wrap it in a `Uint8Array` first.
  const buffer = await new File(fileUri).arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(buffer));
  return bytesToHex(new Uint8Array(digest));
}

export type CheckResult =
  | UpdateEvaluation
  | { kind: "network-error"; message: string }
  // The repo has no GitHub releases yet: expected during early development,
  // not a failure, so the UI shows it as a neutral row rather than an error.
  | { kind: "no-releases" };

export async function checkForUpdate(): Promise<CheckResult> {
  const { updateRepo, versionName, versionCodeNumber } = getBuildInfo();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    // Inside the try: a failure clearing the cache (e.g. a locked file)
    // should surface as a network-error-shaped result, not an unhandled
    // rejection from checkForUpdate().
    await clearUpdateCache();

    const response = await fetch(`${API_BASE}/repos/${updateRepo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return { kind: "no-releases" };
    }
    if (!response.ok) {
      return { kind: "network-error", message: `GitHub returned status ${response.status}` };
    }

    const json = (await response.json()) as GitHubRelease;
    return evaluateRelease(versionName, json, versionCodeNumber);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "network-error", message: "Request timed out" };
    }
    const message = error instanceof Error ? error.message : "Network error";
    return { kind: "network-error", message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export type DownloadResult =
  | { kind: "ready"; fileUri: string; verified: boolean }
  | { kind: "digest-mismatch" }
  // Also what the promise resolves to when `cancel()` wins the race — before
  // the download starts, mid-download, or mid-hash — with message "Cancelled".
  | { kind: "failed"; message: string };

export function downloadUpdate(
  asset: ReleaseAsset,
  onProgress: (written: number, total: number) => void,
): { promise: Promise<DownloadResult>; cancel: () => Promise<void> } {
  const dir = getUpdatesDir();
  const fileUri = dir + DOWNLOAD_FILE_NAME;

  let settled = false; // the promise has resolved; cancel() becomes a no-op
  let cancelled = false; // cancel() was called before the promise settled
  let downloadResumable: FileSystem.DownloadResumable | null = null;

  const deleteQuietly = (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);

  const promise = (async (): Promise<DownloadResult> => {
    try {
      // Refuse a non-https download URL — a compromised or malformed API
      // response shouldn't get to hand the app a plaintext download — unless
      // this is a test build deliberately pointed at a local fixture server.
      if (!/^https:/i.test(asset.browser_download_url) && !UPDATE_API_OVERRIDDEN) {
        return { kind: "failed", message: "Insecure download URL" };
      }

      // Race guard: cancel() called before the download task even exists.
      if (cancelled) {
        return { kind: "failed", message: "Cancelled" };
      }

      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      // Race guard: cancel() called while makeDirectoryAsync was pending.
      if (cancelled) {
        return { kind: "failed", message: "Cancelled" };
      }

      downloadResumable = FileSystem.createDownloadResumable(
        asset.browser_download_url,
        fileUri,
        {},
        (data) => {
          const total =
            data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : asset.size;
          onProgress(data.totalBytesWritten, total);
        },
      );

      const downloaded = await downloadResumable.downloadAsync();

      if (cancelled || !downloaded) {
        // `downloadAsync` resolves to undefined when paused; since we only
        // ever pause from cancel(), treat either signal as a cancellation.
        await deleteQuietly(fileUri);
        return { kind: "failed", message: "Cancelled" };
      }

      if (downloaded.status < 200 || downloaded.status >= 300) {
        await deleteQuietly(downloaded.uri);
        return { kind: "failed", message: `Download failed (HTTP ${downloaded.status})` };
      }

      const expectation = digestExpectation(asset.digest);

      if (expectation.kind === "invalid") {
        // The release published a "sha256:" digest that doesn't parse as one
        // — fail closed rather than silently skipping verification.
        await deleteQuietly(downloaded.uri);
        return { kind: "failed", message: "Release checksum is malformed" };
      }

      if (expectation.kind === "sha256") {
        const actualSha256 = await computeSha256(downloaded.uri);

        // Race guard: cancel() called while hashing was in flight.
        if (cancelled) {
          await deleteQuietly(downloaded.uri);
          return { kind: "failed", message: "Cancelled" };
        }

        if (actualSha256 !== expectation.hex) {
          await deleteQuietly(downloaded.uri);
          return { kind: "digest-mismatch" };
        }

        return { kind: "ready", fileUri: downloaded.uri, verified: true };
      }

      return { kind: "ready", fileUri: downloaded.uri, verified: false };
    } catch (error) {
      await deleteQuietly(fileUri);
      const message = error instanceof Error ? error.message : "Download failed";
      return { kind: "failed", message };
    } finally {
      settled = true;
    }
  })();

  const cancel = async (): Promise<void> => {
    if (settled) {
      // Once the promise has resolved, cancel() is a no-op: there is nothing
      // left to stop and the settled result already owns the outcome.
      return;
    }
    cancelled = true;
    if (downloadResumable) {
      await downloadResumable.pauseAsync().catch(() => undefined);
    }
  };

  return { promise, cancel };
}

export async function installUpdate(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
}

export async function clearUpdateCache(): Promise<void> {
  await FileSystem.deleteAsync(getUpdatesDir(), { idempotent: true });
}
