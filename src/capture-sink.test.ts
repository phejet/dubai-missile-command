// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportFixture, sessionFixture } from "../test-fixtures/capture";
import { reportProblem, uploadSession } from "./capture-sink";

describe("capture transports", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts sessions to their dedicated route with gzip integrity headers", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toContain("/api/session");
      expect(init?.headers).toMatchObject({
        "Content-Encoding": "gzip",
        "x-dmc-build": "build+dirty",
        "x-dmc-install": "12345678-abcd",
        "x-dmc-sha256": "a".repeat(64),
      });
      expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
      return new Response(JSON.stringify({ ok: true, id: "run", encoding: "gzip", file: "session.json" }));
    });
    await expect(
      uploadSession(sessionFixture(), {
        endpoint: "http://localhost",
        compress: async () => new Uint8Array([1, 2, 3]),
        digest: async () => "a".repeat(64),
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({ ok: true, id: "run", encoding: "gzip", file: "session.json" });
  });

  it("posts reports to their dedicated route and falls back to plain JSON", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toContain("/api/report");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Encoding"]).toBeUndefined();
      expect(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))).toMatchObject({
        captureSchema: 2,
        kind: "report",
      });
      return new Response(JSON.stringify({ ok: true, id: "boot-c0", encoding: "none" }));
    });
    await expect(
      reportProblem(reportFixture(), {
        endpoint: "http://localhost",
        compress: async () => null,
        digest: async () => "b".repeat(64),
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: true, id: "boot-c0", encoding: "none" });
  });

  it("uses the hashing fallback when WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const raw = new Uint8Array(init?.body as ArrayBuffer);
      expect((init?.headers as Record<string, string>)["x-dmc-sha256"]).toBe(
        createHash("sha256").update(raw).digest("hex"),
      );
      return new Response(JSON.stringify({ ok: true, id: "run", encoding: "none" }));
    });
    await expect(
      uploadSession(sessionFixture(), {
        endpoint: "http://localhost",
        compress: async () => null,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("makes no request without an endpoint and swallows network failures", async () => {
    const fetch = vi.fn();
    await expect(uploadSession(sessionFixture(), { endpoint: null, fetch })).resolves.toEqual({
      ok: false,
      reason: "no-endpoint",
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      reportProblem(reportFixture(), {
        endpoint: "http://localhost",
        digest: async () => "c".repeat(64),
        compress: async () => null,
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "network" });
  });
});
