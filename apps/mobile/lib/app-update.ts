import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import {
  evaluateRelease,
  sha256FromDigest,
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

const CHECK_TIMEOUT_MS = 10_000;
const UPDATES_DIR_NAME = "updates/";

function getUpdatesDir(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error("No cache directory available on this platform");
  }
  return FileSystem.cacheDirectory + UPDATES_DIR_NAME;
}

function hexEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex;
}

async function computeSha256(fileUri: string): Promise<string> {
  // expo-file-system's `File` class exposes `arrayBuffer()` in SDK 55 (there
  // is no `bytes()` method on this version), which is accepted directly by
  // `Crypto.digest` as a `BufferSource` — no base64 round-trip needed.
  const buffer = await new File(fileUri).arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, buffer);
  return hexEncode(digest);
}

export type CheckResult = UpdateEvaluation | { kind: "network-error"; message: string };

export async function checkForUpdate(): Promise<CheckResult> {
  await clearUpdateCache();

  const { updateRepo, versionName } = getBuildInfo();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/repos/${updateRepo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return { kind: "network-error", message: "No releases published yet" };
    }
    if (!response.ok) {
      return { kind: "network-error", message: `GitHub returned status ${response.status}` };
    }

    const json = (await response.json()) as GitHubRelease;
    return evaluateRelease(versionName, json);
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
  | { kind: "failed"; message: string };

export function downloadUpdate(
  asset: ReleaseAsset,
  onProgress: (written: number, total: number) => void,
): { promise: Promise<DownloadResult>; cancel: () => Promise<void> } {
  const dir = getUpdatesDir();
  const fileUri = dir + asset.name;

  let settled = false;
  let downloadResumable: FileSystem.DownloadResumable | null = null;

  const promise = (async (): Promise<DownloadResult> => {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

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
      if (settled) {
        // cancel() already deleted the file and owns the outcome.
        return { kind: "failed", message: "Download was cancelled" };
      }
      if (!downloaded) {
        settled = true;
        return { kind: "failed", message: "Download was cancelled" };
      }

      const expectedSha256 = sha256FromDigest(asset.digest);
      if (expectedSha256) {
        const actualSha256 = await computeSha256(downloaded.uri);
        if (actualSha256 !== expectedSha256) {
          await FileSystem.deleteAsync(downloaded.uri, { idempotent: true });
          settled = true;
          return { kind: "digest-mismatch" };
        }
        settled = true;
        return { kind: "ready", fileUri: downloaded.uri, verified: true };
      }

      settled = true;
      return { kind: "ready", fileUri: downloaded.uri, verified: false };
    } catch (error) {
      settled = true;
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : "Download failed";
      return { kind: "failed", message };
    }
  })();

  const cancel = async (): Promise<void> => {
    if (settled) {
      return;
    }
    settled = true;
    if (downloadResumable) {
      await downloadResumable.pauseAsync().catch(() => undefined);
    }
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
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
