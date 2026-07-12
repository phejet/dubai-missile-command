// Emergency ring buffer for critical diagnostics events, backed by localStorage.
// localStorage writes are synchronous, so these entries survive a WebView crash
// that kills in-flight Filesystem appends. Kept deliberately tiny: only critical
// events push here, entries are truncated, and the buffer is capped.
//
// On the next boot, diagnostics-log.ts flushes recovered entries into the file
// log when the previous session did not shut down cleanly.

const RING_KEY = "dmc.diag.ring.v1";
const MAX_ENTRIES = 50;
// Sized so a full resources snapshot with renderer pools and a memory sample
// (~1.1KB) survives crash recovery intact. 50 × 2048 ≈ 100KB of localStorage.
const MAX_LINE_CHARS = 2048;

function readRaw(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function ringPush(line: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const entries = readRaw();
    entries.push(line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line);
    while (entries.length > MAX_ENTRIES) entries.shift();
    localStorage.setItem(RING_KEY, JSON.stringify(entries));
  } catch {
    // Quota or serialization failures must never break gameplay.
  }
}

export function ringReadAll(): string[] {
  return readRaw();
}

export function ringClear(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RING_KEY);
  } catch {
    // Ignore.
  }
}
