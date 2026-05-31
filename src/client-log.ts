// Fire-and-forget device logger. POSTs structured events to the dev server's
// /api/save-device-log sink (see vite-perf-plugin.ts). The live-reload iOS shell
// loads the page from the LAN dev server, so the relative URL resolves there and
// logs stream into the `npm run dev:lan` terminal plus device-logs/<day>.jsonl.
//
// Enabled on dev builds only; silent in tests and production. Force on/off at
// runtime with localStorage["dmc:clientLog"] = "1" | "0", or ?clientLog=1 in the URL.

type LogData = Record<string, unknown>;

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

const enabled = resolveEnabled();

export function clientLogEnabled(): boolean {
  return enabled;
}

export function clientLog(channel: string, event: string, data?: LogData): void {
  if (!enabled || typeof fetch !== "function") return;
  let body: string;
  try {
    body = JSON.stringify({ t: Date.now(), channel, event, ...(data ?? {}) });
  } catch {
    return;
  }
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
