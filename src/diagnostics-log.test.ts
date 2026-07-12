// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsStore } from "./diagnostics-store";

interface FakeStore extends DiagnosticsStore {
  appends: { line: string; flushNow: boolean }[];
  sessions: number[];
  cleared: number;
}

function createFakeStore(): FakeStore {
  const appends: { line: string; flushNow: boolean }[] = [];
  const sessions: number[] = [];
  return {
    appends,
    sessions,
    cleared: 0,
    append(line, flushNow) {
      appends.push({ line, flushNow });
    },
    flush: async () => {},
    exportConcatenated: async () => appends.map((a) => a.line).join("\n"),
    totalBytes: async () => 0,
    async clear() {
      this.cleared += 1;
      appends.length = 0;
    },
    startSession(startedAtMs) {
      sessions.push(startedAtMs);
    },
  };
}

async function importFresh() {
  vi.resetModules();
  const clientLogModule = await import("./client-log");
  const diagModule = await import("./diagnostics-log");
  return { ...clientLogModule, ...diagModule };
}

function parsed(store: FakeStore): Record<string, unknown>[] {
  return store.appends.map((a) => JSON.parse(a.line) as Record<string, unknown>);
}

describe("diagnostics log orchestrator", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to disabled and writes nothing", async () => {
    const store = createFakeStore();
    const { initDiagnostics, isDiagnosticsEnabled, clientLog, clientLogEnabled } = await importFresh();
    initDiagnostics({ store });

    expect(isDiagnosticsEnabled()).toBe(false);
    expect(clientLogEnabled()).toBe(false);
    clientLog("screen", "change", { from: "title", to: "playing" });
    expect(store.appends).toHaveLength(0);
    expect(store.sessions).toHaveLength(0);
  });

  it("starts a session at boot when the persisted toggle is on", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    const store = createFakeStore();
    const { initDiagnostics, isDiagnosticsEnabled, getBootId } = await importFresh();
    initDiagnostics({ store });

    expect(isDiagnosticsEnabled()).toBe(true);
    expect(store.sessions).toHaveLength(1);
    const events = parsed(store);
    expect(events[0]).toMatchObject({ seq: 0, boot: getBootId(), channel: "session", event: "session-start" });
    expect(store.appends[0].flushNow).toBe(true);
    const marker = JSON.parse(storage.get("dmc.diag.session.v1")!) as { bootId: string; clean: boolean };
    expect(marker).toMatchObject({ bootId: getBootId(), clean: false });
  });

  it("enables at runtime, persists the flag, and emits session-start", async () => {
    const store = createFakeStore();
    const { initDiagnostics, setDiagnosticsEnabled, clientLog } = await importFresh();
    initDiagnostics({ store });

    setDiagnosticsEnabled(true);
    expect(storage.get("dmc.diag.enabled.v1")).toBe("1");
    expect(parsed(store)[0]).toMatchObject({ channel: "session", event: "session-start" });

    setDiagnosticsEnabled(false);
    expect(storage.get("dmc.diag.enabled.v1")).toBe("0");
    const disableEvent = parsed(store)[parsed(store).length - 1];
    expect(disableEvent).toMatchObject({ channel: "session", event: "disabled" });
    const marker = JSON.parse(storage.get("dmc.diag.session.v1")!) as { clean: boolean };
    expect(marker.clean).toBe(true);

    const countBefore = store.appends.length;
    clientLog("screen", "change", {});
    expect(store.appends).toHaveLength(countBefore);
  });

  it("classifies critical events: immediate flush + ring buffer", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    const store = createFakeStore();
    const { initDiagnostics, clientLog } = await importFresh();
    const ring = await import("./diagnostics-ring");
    initDiagnostics({ store });

    clientLog("death-clip", "seek-progress", { tick: 100 });
    let last = store.appends[store.appends.length - 1];
    expect(last.flushNow).toBe(false);
    expect(ring.ringReadAll().some((line) => line.includes("seek-progress"))).toBe(false);

    clientLog("death-clip", "replay-click", {});
    last = store.appends[store.appends.length - 1];
    expect(last.flushNow).toBe(true);
    expect(ring.ringReadAll().some((line) => line.includes("replay-click"))).toBe(true);

    for (const [channel, event] of [
      ["screen", "change"],
      ["app", "pagehide"],
      ["error", "window-error"],
      ["replay", "divergence"],
    ] as const) {
      clientLog(channel, event, {});
      expect(store.appends[store.appends.length - 1].flushNow).toBe(true);
    }

    clientLog("replay", "finish", {});
    expect(store.appends[store.appends.length - 1].flushNow).toBe(false);
    clientLog("game", "start-request", {});
    expect(store.appends[store.appends.length - 1].flushNow).toBe(false);
  });

  it("recovers the ring buffer after an unclean shutdown", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    storage.set("dmc.diag.session.v1", JSON.stringify({ bootId: "prev-boot", startedAt: 123, clean: false }));
    storage.set(
      "dmc.diag.ring.v1",
      JSON.stringify(['{"boot":"prev-boot","channel":"death-clip","event":"replay-click"}']),
    );

    const store = createFakeStore();
    const { initDiagnostics } = await importFresh();
    initDiagnostics({ store });

    const events = parsed(store);
    expect(events[0]).toMatchObject({ channel: "session", event: "session-start" });
    expect(events[1]).toMatchObject({
      channel: "session",
      event: "unclean-shutdown",
      prevBootId: "prev-boot",
      prevStartedAt: 123,
      recoveredCount: 1,
    });
    expect(events[2]).toMatchObject({ boot: "prev-boot", channel: "death-clip", event: "replay-click" });

    // The recovered old-boot line is cleared from the ring; only fresh-boot
    // critical events (which may reference prevBootId in their data) remain.
    const ring = await import("./diagnostics-ring");
    const ringLines = ring.ringReadAll();
    expect(ringLines.some((line) => line.includes('"boot":"prev-boot"'))).toBe(false);
  });

  it("does not report unclean shutdown after a clean one, and discards the stale ring", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    storage.set("dmc.diag.session.v1", JSON.stringify({ bootId: "prev-boot", startedAt: 123, clean: true }));
    storage.set("dmc.diag.ring.v1", JSON.stringify(['{"boot":"prev-boot","channel":"screen","event":"change"}']));

    const store = createFakeStore();
    const { initDiagnostics } = await importFresh();
    initDiagnostics({ store });

    const events = parsed(store);
    expect(events.some((e) => e.event === "unclean-shutdown")).toBe(false);
    expect(events.some((e) => e.boot === "prev-boot")).toBe(false);
  });

  it("marks the session clean on pagehide and dirty again on pageshow", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    const store = createFakeStore();
    const { initDiagnostics } = await importFresh();
    initDiagnostics({ store });

    window.dispatchEvent(new Event("pagehide"));
    expect((JSON.parse(storage.get("dmc.diag.session.v1")!) as { clean: boolean }).clean).toBe(true);

    window.dispatchEvent(new Event("pageshow"));
    expect((JSON.parse(storage.get("dmc.diag.session.v1")!) as { clean: boolean }).clean).toBe(false);
  });

  it("stamps a monotonic seq and stable boot id on every entry", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    const store = createFakeStore();
    const { initDiagnostics, clientLog, getBootId } = await importFresh();
    initDiagnostics({ store });

    clientLog("game", "start-request", {});
    clientLog("screen", "change", {});
    const events = parsed(store);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(new Set(events.map((e) => e.boot))).toEqual(new Set([getBootId()]));
  });

  it("clears the store and ring, then re-seeds a session-start marker event", async () => {
    storage.set("dmc.diag.enabled.v1", "1");
    const store = createFakeStore();
    const { initDiagnostics, clearDiagnostics, clientLog } = await importFresh();
    initDiagnostics({ store });
    clientLog("screen", "change", {});

    await clearDiagnostics();
    expect(store.cleared).toBe(1);
    const events = parsed(store);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ channel: "session", event: "session-start", afterClear: true });
  });
});
