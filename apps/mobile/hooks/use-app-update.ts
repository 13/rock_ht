import { useCallback, useEffect, useRef, useState } from "react";
import type { ReleaseAsset } from "@rock_ht/utils";
import {
  checkForUpdate,
  clearUpdateCache,
  downloadUpdate,
  installUpdate,
} from "@/lib/app-update";

export type AppUpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; checkedAt: Date }
  | { kind: "no-releases"; checkedAt: Date }
  | { kind: "available"; version: string; sizeBytes: number; notes: string | null; releaseUrl: string }
  | { kind: "downloading"; written: number; total: number }
  | { kind: "ready"; version: string; verified: boolean }
  | {
      kind: "newer-build-installed";
      version: string;
      releaseCode: number;
      installedCode: number;
      releaseUrl: string;
    }
  | { kind: "error"; message: string; releaseUrl?: string };

type AvailableState = Extract<AppUpdateState, { kind: "available" }>;

const PROGRESS_MIN_INTERVAL_MS = 100; // at most ~10 progress renders per second
const CANCELLED_MESSAGE = "Cancelled";

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({ kind: "idle" });

  // The offered release: kept outside `state` so download() can reach the
  // asset, and so a cancelled download can fall back to the "available" row.
  const availableRef = useRef<{ state: AvailableState; asset: ReleaseAsset } | null>(null);
  const readyFileRef = useRef<string | null>(null);
  const cancelRef = useRef<(() => Promise<void>) | null>(null);
  // Bumped on every check/download so results of a superseded operation are
  // dropped instead of overwriting newer state.
  const opRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const cancel = cancelRef.current;
      cancelRef.current = null;
      if (cancel) void cancel();
    };
  }, []);

  const isCurrent = useCallback(
    (op: number) => mountedRef.current && opRef.current === op,
    [],
  );

  const check = useCallback(async () => {
    const op = ++opRef.current;
    availableRef.current = null;
    readyFileRef.current = null;
    setState({ kind: "checking" });

    const result = await checkForUpdate();
    if (!isCurrent(op)) return;

    switch (result.kind) {
      case "up-to-date":
        setState({ kind: "up-to-date", checkedAt: new Date() });
        return;
      case "no-releases":
        setState({ kind: "no-releases", checkedAt: new Date() });
        return;
      case "newer-build-installed":
        setState({
          kind: "newer-build-installed",
          version: result.version,
          releaseCode: result.releaseCode,
          installedCode: result.installedCode,
          releaseUrl: result.releaseUrl,
        });
        return;
      case "available": {
        const available: AvailableState = {
          kind: "available",
          version: result.version,
          sizeBytes: result.asset.size,
          notes: result.notes,
          releaseUrl: result.releaseUrl,
        };
        availableRef.current = { state: available, asset: result.asset };
        setState(available);
        return;
      }
      case "no-apk":
        setState({ kind: "error", message: "This release has no APK", releaseUrl: result.releaseUrl });
        return;
      case "unreadable-version":
        setState({
          kind: "error",
          message: "Can't compare versions",
          releaseUrl: result.releaseUrl ?? undefined,
        });
        return;
      case "network-error":
        setState({ kind: "error", message: result.message });
        return;
    }
  }, [isCurrent]);

  const download = useCallback(async () => {
    const offered = availableRef.current;
    if (!offered || cancelRef.current) return;

    const op = ++opRef.current;
    const { asset } = offered;
    setState({ kind: "downloading", written: 0, total: asset.size });

    let lastPercent = -1;
    let lastEmit = 0;
    const onProgress = (written: number, total: number) => {
      if (!isCurrent(op)) return;
      const percent = total > 0 ? Math.floor((written / total) * 100) : 0;
      const now = Date.now();
      if (percent === lastPercent || now - lastEmit < PROGRESS_MIN_INTERVAL_MS) return;
      lastPercent = percent;
      lastEmit = now;
      setState({ kind: "downloading", written, total });
    };

    const { promise, cancel } = downloadUpdate(asset, onProgress);
    cancelRef.current = cancel;
    const result = await promise;
    if (cancelRef.current === cancel) cancelRef.current = null;
    if (!isCurrent(op)) return;

    switch (result.kind) {
      case "ready":
        readyFileRef.current = result.fileUri;
        setState({ kind: "ready", version: offered.state.version, verified: result.verified });
        return;
      case "digest-mismatch":
        setState({
          kind: "error",
          message: "Download didn't match its checksum — deleted",
          releaseUrl: offered.state.releaseUrl,
        });
        return;
      case "failed":
        if (result.message === CANCELLED_MESSAGE) {
          // A user-initiated cancel isn't an error: offer the download again.
          setState(offered.state);
          return;
        }
        // The service already deletes the partial file; clear the rest of
        // the cache so a failure never leaves anything behind.
        await clearUpdateCache().catch(() => undefined);
        if (!isCurrent(op)) return;
        setState({ kind: "error", message: result.message, releaseUrl: offered.state.releaseUrl });
        return;
    }
  }, [isCurrent]);

  const cancel = useCallback(async () => {
    const current = cancelRef.current;
    if (current) await current();
  }, []);

  const install = useCallback(async () => {
    const fileUri = readyFileRef.current;
    if (!fileUri) return;
    try {
      await installUpdate(fileUri);
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message : "Couldn't open the installer";
      setState({
        kind: "error",
        message,
        releaseUrl: availableRef.current?.state.releaseUrl,
      });
    }
  }, []);

  return { state, check, download, install, cancel };
}
