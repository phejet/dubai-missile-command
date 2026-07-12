// Structured device event logger with pluggable sinks.
//
// Dev sink: POSTs events to the dev server's /api/save-device-log endpoint (see
// vite-perf-plugin.ts). The live-reload iOS shell loads the page from the LAN dev
// server, so the relative URL resolves there and logs stream into the
// `npm run dev:lan` terminal plus device-logs/<day>.jsonl. Enabled on dev builds
// only; silent in tests and production. Force on/off at runtime with
// localStorage["dmc:clientLog"] = "1" | "0", or ?clientLog=1 in the URL.
//
// Additional sinks (e.g. the production diagnostics file log, see
// diagnostics-log.ts) register via registerClientLogSink and are gated by their
// own enabled() check on every call, so they can be toggled at runtime.

type LogData = Record<string, unknown>;

export type ClientLogEntry = { t: number; channel: string; event: string } & Record<string, unknown>;

export interface ClientLogSink {
  /** Re-checked on every clientLog call so sinks can be toggled at runtime. */
  enabled(): boolean;
  /** Must not throw; the dispatcher also guards, but never rely on that. */
  handle(entry: ClientLogEntry): void;
}

const ENDPOINT = "/api/save-device-log";

function resolveEnabled(): boolean {
  try {
    const env = import.meta.env as { MODE?: string; DEV?: boolean } | undefined;
    if (env?.MODE === "test") return false;

    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("dmc:clientLog") : null;
    if (stored === "0") return false;
    if (stored === "1") return true;

    if (typeof location !== "undefined" && /[?&]clientLog=1\b/.test(location.search)) return true;
    return !!env?.DEV;
  } catch {
    return false;
  }
}

const devEnabled = resolveEnabled();

const sinks: ClientLogSink[] = [];

export function registerClientLogSink(sink: ClientLogSink): void {
  sinks.push(sink);
}

export function clientLogEnabled(): boolean {
  if (devEnabled) return true;
  for (const sink of sinks) {
    try {
      if (sink.enabled()) return true;
    } catch {
      // A broken sink must never disable logging checks for the rest.
    }
  }
  return false;
}

export function clientLog(channel: string, event: string, data?: LogData): void {
  if (!clientLogEnabled()) return;
  const entry: ClientLogEntry = { t: Date.now(), channel, event, ...(data ?? {}) };

  if (devEnabled && typeof fetch === "function") {
    let body: string | null = null;
    try {
      body = JSON.stringify(entry);
    } catch {
      body = null;
    }
    if (body !== null) {
      try {
        void fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {
          // Never let diagnostics break the run.
        });
      } catch {
        // fetch can throw synchronously on some platforms; swallow it.
      }
    }
  }

  for (const sink of sinks) {
    try {
      if (sink.enabled()) sink.handle(entry);
    } catch {
      // Never let diagnostics break the run.
    }
  }
}
