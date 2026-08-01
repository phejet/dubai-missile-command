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
import {
  CHUNK_MAX_BYTES,
  createCapacitorFsAdapter,
  createDiagnosticsStore,
  EXPORT_MAX_BYTES,
  type DiagnosticsStore,
} from "./diagnostics-store";
import { ringClear, ringPush, ringReadAll } from "./diagnostics-ring";
import { startMemorySampling, stopMemorySampling } from "./memory-probe";
import { buildReplayArchiveRecords } from "./replay-archive";
import { triggerWebDownload } from "./save-replay";
import type { ReplayData } from "./types";

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
export const REPLAY_ARCHIVE_MAX_BYTES = EXPORT_MAX_BYTES - 2 * CHUNK_MAX_BYTES;

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
let archiveOrdinal = 0;
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

  startMemorySampling();
  clientLog("session", "session-start", sessionStartMeta());
  clientLog("diag", "capabilities", {
    compressionStream: typeof CompressionStream !== "undefined",
    cryptoSubtle: typeof crypto !== "undefined" && !!crypto.subtle,
  });
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
      startMemorySampling();
      clientLog("session", "enabled", {});
    }
  } else {
    clientLog("session", "disabled", {});
    if (sessionStarted) writeSessionMarker({ bootId, startedAt: sessionStartedAt, clean: true });
    void getStore().flush();
    stopMemorySampling();
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

export interface RecentDiagnosticsEvents {
  events: Record<string, unknown>[];
  unparsed: number;
  truncated: boolean;
}

const EVENT_READ_BUDGET = 2 * CHUNK_MAX_BYTES;

/** Reads a bounded JSONL tail without ever returning replay archive payload parts. */
export async function readRecentEvents(maxBytes: number): Promise<RecentDiagnosticsEvents> {
  if (!enabled || maxBytes <= 0) return { events: [], unparsed: 0, truncated: false };

  let content: string;
  try {
    content = await getStore().exportConcatenated(EVENT_READ_BUDGET);
  } catch {
    return { events: [], unparsed: 0, truncated: true };
  }
  const parsed: { event: Record<string, unknown>; bytes: number }[] = [];
  let unparsed = 0;
  let truncated = false;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an event object");
      event = value as Record<string, unknown>;
    } catch {
      unparsed += 1;
      continue;
    }
    if (event.channel === "export" && event.event === "truncated") truncated = true;
    if (event.channel === "replay-archive") continue;
    parsed.push({ event, bytes: new TextEncoder().encode(`${line}\n`).byteLength });
  }

  const tail: Record<string, unknown>[] = [];
  let used = 0;
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const candidate = parsed[index];
    if (used + candidate.bytes > maxBytes) {
      truncated = true;
      break;
    }
    tail.unshift(candidate.event);
    used += candidate.bytes;
  }
  if (tail.length < parsed.length) truncated = true;
  return { events: tail, unparsed, truncated };
}

export type ArchiveReplayResult =
  | { ok: true; archiveId: string }
  | { ok: false; archiveId: string; stage: string; error: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns null synchronously when diagnostics is disabled. */
export function archiveReplay(replay: ReplayData): Promise<ArchiveReplayResult> | null {
  if (!enabled) return null;
  const ordinal = archiveOrdinal++;
  const fallbackArchiveId = `${bootId}-a${ordinal}`;

  return (async (): Promise<ArchiveReplayResult> => {
    const built = await buildReplayArchiveRecords(replay, { build: BUILD_ID, fallbackArchiveId });
    if (!built.ok) {
      const line = JSON.stringify({
        seq: seq++,
        boot: bootId,
        t: Date.now(),
        channel: "replay-archive",
        event: "error",
        archiveId: fallbackArchiveId,
        stage: built.stage,
        message: errorMessage(built.error),
      });
      getStore().append(line, true);
      return { ok: false, archiveId: fallbackArchiveId, stage: built.stage, error: built.error };
    }

    const firstSeq = seq;
    const lines = built.records.map((record, index) =>
      JSON.stringify({ seq: firstSeq + index, boot: bootId, t: Date.now(), ...record }),
    );
    const totalBytes = lines.reduce((sum, line) => sum + new TextEncoder().encode(`${line}\n`).byteLength, 0);
    if (totalBytes > REPLAY_ARCHIVE_MAX_BYTES) {
      const error = new Error(`archive batch is ${totalBytes} bytes; limit is ${REPLAY_ARCHIVE_MAX_BYTES}`);
      const line = JSON.stringify({
        seq: seq++,
        boot: bootId,
        t: Date.now(),
        channel: "replay-archive",
        event: "error",
        archiveId: built.archiveId,
        stage: "size",
        message: error.message,
      });
      getStore().append(line, true);
      return { ok: false, archiveId: built.archiveId, stage: "size", error };
    }

    seq += lines.length;
    try {
      await getStore().appendBatch(lines);
      const completionLine = lines[lines.length - 1];
      ringPush(completionLine);
      return { ok: true, archiveId: built.archiveId };
    } catch (error) {
      const line = JSON.stringify({
        seq: seq++,
        boot: bootId,
        t: Date.now(),
        channel: "replay-archive",
        event: "error",
        archiveId: built.archiveId,
        stage: "flush",
        message: errorMessage(error),
      });
      getStore().append(line, true);
      return { ok: false, archiveId: built.archiveId, stage: "flush", error };
    }
  })().catch(
    (error): ArchiveReplayResult => ({
      ok: false,
      archiveId: fallbackArchiveId,
      stage: "unknown",
      error,
    }),
  );
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
