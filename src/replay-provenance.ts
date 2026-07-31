import { Capacitor } from "@capacitor/core";
import type { ReplayData, ReplayEnvironment } from "./types";

export function describeEnvironment(): ReplayEnvironment {
  return {
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    ua: typeof navigator === "undefined" ? "" : navigator.userAgent,
    dpr: typeof window === "undefined" || !Number.isFinite(window.devicePixelRatio) ? 1 : window.devicePixelRatio,
    screenW: typeof screen === "undefined" || !Number.isFinite(screen.width) ? 0 : screen.width,
    screenH: typeof screen === "undefined" || !Number.isFinite(screen.height) ? 0 : screen.height,
  };
}

/** Decorates a shallow copy so provenance cannot perturb the live replay object. */
export function stampReplayProvenance(replay: ReplayData, build: string): ReplayData {
  return {
    ...replay,
    _buildId: replay._buildId ?? build,
    _savedAt: replay._savedAt ?? new Date().toISOString(),
    _env: replay._env ?? describeEnvironment(),
  };
}
