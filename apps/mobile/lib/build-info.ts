import * as Application from "expo-application";

export interface BuildInfo {
  versionName: string;
  versionCode: string;
  buildDate: string | null;
  gitSha: string | null;
  channel: "release" | "dev" | "debug";
  updateRepo: string;
}

export function getBuildInfo(): BuildInfo {
  const versionName = Application.nativeApplicationVersion ?? "dev";
  const versionCode = Application.nativeBuildVersion ?? "—";
  // Metro only inlines EXPO_PUBLIC_* env vars read via a literal
  // `process.env.EXPO_PUBLIC_…` member access.
  const buildDate = process.env.EXPO_PUBLIC_BUILD_DATE ?? null;
  const gitSha = process.env.EXPO_PUBLIC_GIT_SHA ?? null;
  const updateRepo = process.env.EXPO_PUBLIC_UPDATE_REPO ?? "13/rock_ht";

  let channel: BuildInfo["channel"];
  if (__DEV__) {
    channel = "debug";
  } else if (versionName.includes("-dev.")) {
    channel = "dev";
  } else {
    channel = "release";
  }

  return { versionName, versionCode, buildDate, gitSha, channel, updateRepo };
}
