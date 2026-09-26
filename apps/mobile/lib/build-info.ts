import * as Application from "expo-application";

export interface BuildInfo {
  versionName: string;
  versionCode: string;
  /** `versionCode` as a number, or null when it can't be parsed (e.g. `Application.nativeBuildVersion` is unavailable/non-numeric on this platform). */
  versionCodeNumber: number | null;
  buildDate: string | null;
  gitSha: string | null;
  channel: "release" | "dev" | "debug";
  updateRepo: string;
}

// Matches "-dev" at the end of the version, or followed by a dot (e.g.
// "0.0.0-dev", "0.3.0-dev.106"), so unversioned test builds are recognized
// alongside the usual "-dev.<n>" dev-build suffix.
const DEV_CHANNEL_RE = /-dev(\.|$)/;

export function getBuildInfo(): BuildInfo {
  const versionName = Application.nativeApplicationVersion ?? "dev";
  const versionCode = Application.nativeBuildVersion ?? "—";
  const versionCodeNumber = (() => {
    const raw = Application.nativeBuildVersion;
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  })();
  // Metro only inlines EXPO_PUBLIC_* env vars read via a literal
  // `process.env.EXPO_PUBLIC_…` member access.
  const buildDate = process.env.EXPO_PUBLIC_BUILD_DATE ?? null;
  const gitSha = process.env.EXPO_PUBLIC_GIT_SHA ?? null;
  const updateRepo = process.env.EXPO_PUBLIC_UPDATE_REPO ?? "13/rock_ht";

  let channel: BuildInfo["channel"];
  if (__DEV__) {
    channel = "debug";
  } else if (DEV_CHANNEL_RE.test(versionName)) {
    channel = "dev";
  } else {
    channel = "release";
  }

  return { versionName, versionCode, versionCodeNumber, buildDate, gitSha, channel, updateRepo };
}
