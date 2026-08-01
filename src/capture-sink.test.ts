// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadCapture } from "./capture-sink";
import type { CaptureEnvelope } from "./capture";

function envelope(): CaptureEnvelope {
  return {
    captureSchema: 1,
    captureId: "boot-c0",
    meta: {
      buildId: "build",
      installId: null,
      displayName: null,
      bootId: "boot",
      runId: "run",
      capturedAt: 1,
      trigger: "manual",
      note: null,
      appScreen: "gameover",
      replaySource: "last-completed",
      partial: false,
      capturedThroughTick: null,
      replaySha256: "r".repeat(64),
      replayComplete: true,
      platform: "web",
      inputClass: "mouse",
      env: { platform: "web", native: false, ua: "test", dpr: 1, screenW: 900, screenH: 1600 },
    },
    summary: null,
    replay: { version: 11, seed: 42, actions: [] },
    events: [],
    eventsUnparsed: 0,
    eventsTruncated: false,
    attachments: [],
  };
}

describe("capture sink", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends gzip bytes with integrity and identity headers", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Content-Encoding": "gzip",
        "x-dmc-build": "build",
        "x-dmc-install": "",
        "x-dmc-sha256": "a".repeat(64),
      });
      expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
      return new Response(JSON.stringify({ ok: true, captureId: "boot-c0", encoding: "gzip", file: "capture.json" }));
    });

    await expect(
      uploadCapture(envelope(), {
        endpoint: "/api/save-capture",
        compress: async () => new Uint8Array([1, 2, 3]),
        digest: async () => "a".repeat(64),
        fetch,
      }),
    ).resolves.toEqual({ ok: true, captureId: "boot-c0", encoding: "gzip", file: "capture.json" });
  });

  it("falls back to plain JSON without a content-encoding header", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Encoding"]).toBeUndefined();
      expect(headers["x-dmc-sha256"]).toBe("b".repeat(64));
      expect(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer))).toMatchObject({ captureSchema: 1 });
      return new Response(JSON.stringify({ ok: true, captureId: "boot-c0", encoding: "none" }));
    });

    await expect(
      uploadCapture(envelope(), {
        endpoint: "/api/save-capture",
        compress: async () => null,
        digest: async () => "b".repeat(64),
        fetch,
      }),
    ).resolves.toMatchObject({ ok: true, encoding: "none" });
  });

  it("keeps integrity and uploads when insecure context WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const raw = new Uint8Array(init?.body as ArrayBuffer);
      expect((init?.headers as Record<string, string>)["x-dmc-sha256"]).toBe(
        createHash("sha256").update(raw).digest("hex"),
      );
      return new Response(JSON.stringify({ ok: true, captureId: "boot-c0", encoding: "none" }));
    });

    await expect(
      uploadCapture(envelope(), {
        endpoint: "/api/save-capture",
        compress: async () => null,
        fetch,
      }),
    ).resolves.toMatchObject({ ok: true, encoding: "none" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("makes no request without an endpoint and swallows network failures", async () => {
    const fetch = vi.fn();
    await expect(uploadCapture(envelope(), { endpoint: null, fetch })).resolves.toEqual({
      ok: false,
      reason: "no-endpoint",
    });
    expect(fetch).not.toHaveBeenCalled();

    await expect(
      uploadCapture(envelope(), {
        endpoint: "/api/save-capture",
        digest: async () => "c".repeat(64),
        compress: async () => null,
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "network" });
  });
});
