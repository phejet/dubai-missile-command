import type { CaptureChannel, RemoteCaptureConsent } from "./capture-policy";

type RemoteCaptureChannel = Extract<CaptureChannel, "staging" | "production">;

interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "dmc.capture.remote-consent.v1";
const AUTO_UPLOAD_STORAGE_PREFIX = "dmc.capture.auto-upload-sessions.v1";

export function isRemoteCaptureChannel(channel: CaptureChannel): channel is RemoteCaptureChannel {
  return channel === "staging" || channel === "production";
}

function consentStorage(storage?: ConsentStorage): ConsentStorage | null {
  if (storage) return storage;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function storageKey(channel: RemoteCaptureChannel): string {
  return `${STORAGE_PREFIX}.${channel}`;
}

export function getRemoteCaptureConsent(channel: CaptureChannel, storage?: ConsentStorage): RemoteCaptureConsent {
  if (!isRemoteCaptureChannel(channel)) return "unknown";
  try {
    const value = consentStorage(storage)?.getItem(storageKey(channel));
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

export function setRemoteCaptureConsent(
  channel: RemoteCaptureChannel,
  consent: Exclude<RemoteCaptureConsent, "unknown">,
  storage?: ConsentStorage,
): void {
  const resolved = consentStorage(storage);
  if (!resolved) throw new Error("capture consent storage unavailable");
  resolved.setItem(storageKey(channel), consent);
}

export function getAutomaticSessionUploadEnabled(channel: CaptureChannel, storage?: ConsentStorage): boolean {
  if (!isRemoteCaptureChannel(channel)) return false;
  try {
    return consentStorage(storage)?.getItem(`${AUTO_UPLOAD_STORAGE_PREFIX}.${channel}`) === "true";
  } catch {
    return false;
  }
}

export function setAutomaticSessionUploadEnabled(
  channel: RemoteCaptureChannel,
  enabled: boolean,
  storage?: ConsentStorage,
): void {
  const resolved = consentStorage(storage);
  if (!resolved) throw new Error("capture upload setting storage unavailable");
  resolved.setItem(`${AUTO_UPLOAD_STORAGE_PREFIX}.${channel}`, String(enabled));
}
