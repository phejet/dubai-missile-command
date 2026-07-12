// Native memory sampler bridge (iOS side: ios/App/App/MemoryProbePlugin.swift).
//
// WebKit exposes no performance.memory, and the WebContent process that dies
// at its private memory limit cannot be inspected from JS or from the app
// process. The native probe reports host-wide memory plus the app process's
// own footprint; the WebContent leak shows up as host free memory draining
// while the app footprint stays flat.
//
// Critical log lines must not wait on a bridge round-trip — the process can be
// killed within milliseconds of the event they record (see
// docs/death-clip-webcontent-kill-handover.md). Consumers embed the most
// recent cached sample synchronously via getMemorySample(); a background
// interval keeps the cache fresh while diagnostics is enabled.

import { Capacitor, registerPlugin } from "@capacitor/core";

interface MemoryProbeNative {
  sample(): Promise<{
    appAvailableBytes?: number;
    appFootprintBytes?: number;
    hostFreeBytes?: number;
    hostInactiveBytes?: number;
    hostCompressedBytes?: number;
  }>;
}

interface MemorySample {
  appAvailMB: number | null;
  appFootprintMB: number | null;
  hostFreeMB: number | null;
  hostInactiveMB: number | null;
  hostCompressedMB: number | null;
  sampledAt: number;
}

export type MemorySampleWithAge = Omit<MemorySample, "sampledAt"> & { ageMs: number };

const MemoryProbe = registerPlugin<MemoryProbeNative>("MemoryProbe");

const SAMPLE_INTERVAL_MS = 2000;

let last: MemorySample | null = null;
let unavailable = false;
let pending = false;
let timer: ReturnType<typeof setInterval> | null = null;

function toMB(bytes: number | undefined): number | null {
  return typeof bytes === "number" && bytes >= 0 ? Math.round(bytes / 1048576) : null;
}

export function refreshMemorySample(): void {
  if (unavailable || pending) return;
  if (!Capacitor.isNativePlatform()) {
    unavailable = true;
    return;
  }
  pending = true;
  MemoryProbe.sample()
    .then((raw) => {
      last = {
        appAvailMB: toMB(raw.appAvailableBytes),
        appFootprintMB: toMB(raw.appFootprintBytes),
        hostFreeMB: toMB(raw.hostFreeBytes),
        hostInactiveMB: toMB(raw.hostInactiveBytes),
        hostCompressedMB: toMB(raw.hostCompressedBytes),
        sampledAt: Date.now(),
      };
    })
    .catch(() => {
      // Plugin missing (old native build) or bridge failure: stop asking.
      unavailable = true;
    })
    .finally(() => {
      pending = false;
    });
}

/**
 * Last known native memory sample plus its age, or null before the first
 * response arrives (and always null on web). Synchronous by design; also
 * kicks off a refresh so the next reader gets fresher data.
 */
export function getMemorySample(): MemorySampleWithAge | null {
  refreshMemorySample();
  if (!last) return null;
  const { sampledAt, ...rest } = last;
  return { ...rest, ageMs: Date.now() - sampledAt };
}

export function startMemorySampling(): void {
  if (timer !== null || unavailable || !Capacitor.isNativePlatform()) return;
  refreshMemorySample();
  timer = setInterval(refreshMemorySample, SAMPLE_INTERVAL_MS);
}

export function stopMemorySampling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
