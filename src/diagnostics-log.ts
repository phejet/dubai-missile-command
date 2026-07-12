// Production diagnostics logging orchestrator.
//
// Registers a runtime-toggleable sink on the clientLog dispatcher so every
// existing clientLog call site feeds an on-device JSONL file (see
// diagnostics-store.ts) when the user enables Diagnostics in the Options menu.
// Critical events also go to a synchronous localStorage ring buffer
// (diagnostics-ring.ts) so they survive a WebView crash; the next boot detects
// an unclean shutdown via a session marker and recovers the ring into the file.
//
// The bootId discriminator is the whole point: a fresh bootId whose recovered
// tail ends in a death-clip tap means the WebView restarted; the same bootId
// followed by a screen change means navigation fired in-page.

import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { clientLog, registerClientLogSink, type ClientLogEntry } from "./client-log";
import { createCapacitorFsAdapter, createDiagnosticsStore, type DiagnosticsStore } from "./diagnostics-store";
import { ringClear, ringPush, ringReadAll } from "./diagnostics-ring";
import { triggerWebDownload } from "./save-replay";

const ENABLED_KEY = "dmc.diag.enabled.v1";
const SESSION_KEY = "dmc.diag.session.v1";

const CRITICAL_CHANNELS = new Set(["session", "error", "screen", "app"]);
const CRITICAL_EVENTS = new Set([
  "death-clip:replay-click",
  "death-clip:mount",
  "death-clip:window-error",
  "death-clip:unhandled-rejection",
  "death-clip:seek-timeout",
  "death-clip:seek-error",
  "death-clip:seek-abandoned",
  "death-clip:static-fallback",
  "replay:start",
  "replay:abort",
  "replay:divergence",
  "resources:snapshot",
  "resources:primary-gameplay-release",
  "resources:primary-gameplay-retain",
]);

const BUILD_ID = typeof __DMC_BUILD_ID__ !== "undefined" ? __DMC_BUILD_ID__ : "dev";

interface SessionMarker {
  bootId: string;
  startedAt: number;
  clean: boolean;
}

const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let initialized = false;
let enabled = false;
let sessionStarted = false;
let sessionStartedAt = 0;
let seq = 0;
let store: DiagnosticsStore | null = null;
let createStore: () => DiagnosticsStore = () => createDiagnosticsStore(createCapacitorFsAdapter());

function getStore(): DiagnosticsStore {
  if (!store) store = createStore();
  return store;
}

function readEnabledFlag(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabledFlag(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // Ignore.
  }
}

function readSessionMarker(): SessionMarker | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionMarker>;
    if (typeof parsed?.bootId !== "string") return null;
    return {
      bootId: parsed.bootId,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      clean: parsed.clean === true,
    };
  } catch {
    return null;
  }
}

function writeSessionMarker(marker: SessionMarker): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(marker));
  } catch {
    // Ignore.
  }
}

function isCritical(entry: ClientLogEntry): boolean {
  return CRITICAL_CHANNELS.has(entry.channel) || CRITICAL_EVENTS.has(`${entry.channel}:${entry.event}`);
}

function handleEntry(entry: ClientLogEntry): void {
  let line: string;
  try {
    line = JSON.stringify({ seq: seq++, boot: bootId, ...entry });
  } catch {
    return;
  }
  const critical = isCritical(entry);
  if (critical) ringPush(line);
  getStore().append(line, critical);
}

function sessionStartMeta(): Record<string, unknown> {
  return {
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    build: BUILD_ID,
    mode: (import.meta.env as { MODE?: string } | undefined)?.MODE ?? "unknown",
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

function beginSession(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  sessionStartedAt = Date.now();
  getStore().startSession(sessionStartedAt);

  const prev = readSessionMarker();
  const recovered = prev && !prev.clean ? ringReadAll() : [];
  ringClear();
  writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: false });

  clientLog("session", "session-start", sessionStartMeta());
  if (prev && !prev.clean) {
    clientLog("session", "unclean-shutdown", {
      prevBootId: prev.bootId,
      prevStartedAt: prev.startedAt,
      recoveredCount: recovered.length,
    });
    // Recovered lines keep their original boot/seq envelope, so old-boot
    // entries inside this session's chunk stay unambiguous.
    for (const line of recovered) getStore().append(line, false);
    void getStore().flush();
  }
}

export function initDiagnostics(deps: { store?: DiagnosticsStore } = {}): void {
  if (initialized) return;
  initialized = true;
  if (deps.store) createStore = () => deps.store!;

  enabled = readEnabledFlag();
  registerClientLogSink({ enabled: () => enabled, handle: handleEntry });

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      if (!enabled || !sessionStarted) return;
      writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: true });
      void getStore().flush();
    });
    window.addEventListener("pageshow", () => {
      if (!enabled || !sessionStarted) return;
      writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: false });
    });
  }

  if (enabled) beginSession();
}

export function isDiagnosticsEnabled(): boolean {
  return enabled;
}

export function setDiagnosticsEnabled(on: boolean): void {
  if (on === enabled) return;
  if (on) {
    enabled = true;
    writeEnabledFlag(true);
    if (!sessionStarted) {
      beginSession();
    } else {
      writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: false });
      clientLog("session", "enabled", {});
    }
  } else {
    clientLog("session", "disabled", {});
    if (sessionStarted) writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: true });
    void getStore().flush();
    enabled = false;
    writeEnabledFlag(false);
  }
}

export function getBootId(): string {
  return bootId;
}

export function getDiagnosticsBuildId(): string {
  return BUILD_ID;
}

export type ShareDiagnosticsResult = { ok: true } | { ok: false; error: unknown };

export async function shareDiagnostics(): Promise<ShareDiagnosticsResult> {
  try {
    const content = await getStore().exportConcatenated();
    const filename = `dmc-diagnostics-${Date.now()}.jsonl`;
    if (Capacitor.isNativePlatform()) {
      const written = await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: "Dubai Missile Command diagnostics",
        url: written.uri,
        dialogTitle: "Share diagnostics",
      });
    } else {
      triggerWebDownload(content, filename);
    }
    return { ok: true };
  } catch (error) {
    // Dismissing the iOS share sheet rejects; that is not a failure.
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return { ok: true };
    return { ok: false, error };
  }
}

export async function clearDiagnostics(): Promise<void> {
  await getStore().clear();
  ringClear();
  if (enabled) {
    clientLog("session", "session-start", { ...sessionStartMeta(), afterClear: true });
  }
}
