// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientLogEntry, ClientLogSink } from "./client-log";

async function importFresh(): Promise<typeof import("./client-log")> {
  vi.resetModules();
  return import("./client-log");
}

function makeSink(overrides?: Partial<ClientLogSink>): ClientLogSink & { entries: ClientLogEntry[] } {
  const entries: ClientLogEntry[] = [];
  return {
    entries,
    enabled: () => true,
    handle: (entry: ClientLogEntry) => {
      entries.push(entry);
    },
    ...overrides,
  };
}

describe("client-log dispatcher", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is silent in test mode with no sinks", async () => {
    const { clientLog, clientLogEnabled } = await importFresh();
    expect(clientLogEnabled()).toBe(false);
    clientLog("chan", "evt", { a: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the dev POST behavior when the dev gate is on", async () => {
    vi.stubEnv("MODE", "development");
    localStorage.setItem("dmc:clientLog", "1");
    const { clientLog, clientLogEnabled } = await importFresh();

    expect(clientLogEnabled()).toBe(true);
    clientLog("screen", "change", { from: "title", to: "playing" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/save-device-log");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body as string) as ClientLogEntry;
    expect(body).toMatchObject({ channel: "screen", event: "change", from: "title", to: "playing" });
    expect(typeof body.t).toBe("number");
  });

  it("respects the localStorage kill switch for the dev sink", async () => {
    vi.stubEnv("MODE", "development");
    localStorage.setItem("dmc:clientLog", "0");
    const { clientLog, clientLogEnabled } = await importFresh();

    expect(clientLogEnabled()).toBe(false);
    clientLog("chan", "evt");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("dispatches entries to registered sinks and reflects their gating live", async () => {
    const { clientLog, clientLogEnabled, registerClientLogSink } = await importFresh();
    let on = false;
    const sink = makeSink({ enabled: () => on });
    registerClientLogSink(sink);

    expect(clientLogEnabled()).toBe(false);
    clientLog("chan", "evt", { a: 1 });
    expect(sink.entries).toHaveLength(0);

    on = true;
    expect(clientLogEnabled()).toBe(true);
    clientLog("chan", "evt", { a: 2 });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({ channel: "chan", event: "evt", a: 2 });
    expect(typeof sink.entries[0].t).toBe("number");

    on = false;
    expect(clientLogEnabled()).toBe(false);
    clientLog("chan", "evt", { a: 3 });
    expect(sink.entries).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swallows throwing sinks without starving the others", async () => {
    const { clientLog, registerClientLogSink } = await importFresh();
    registerClientLogSink({
      enabled: () => true,
      handle: () => {
        throw new Error("boom");
      },
    });
    registerClientLogSink({
      enabled: () => {
        throw new Error("gate boom");
      },
      handle: () => {},
    });
    const healthy = makeSink();
    registerClientLogSink(healthy);

    expect(() => clientLog("chan", "evt")).not.toThrow();
    expect(healthy.entries).toHaveLength(1);
  });
});
