// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportFixture, sessionFixture } from "../test-fixtures/capture";
import { CaptureAuthError, CaptureAuthTimeoutError } from "./capture-auth";
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

  it("evaluates eligibility before an injected endpoint or any transport work", async () => {
    const fetch = vi.fn();
    const compress = vi.fn(async () => new Uint8Array([1]));
    const digest = vi.fn(async () => "a".repeat(64));

    await expect(
      uploadSession(sessionFixture(), {
        endpoint: "https://dmc-captures.example/api/session",
        channel: "off",
        runtime: "native-ios",
        execution: "human",
        remoteConsent: "granted",
        compress,
        digest,
        fetch,
      }),
    ).resolves.toEqual({ ok: false, reason: "policy:channel-off" });
    expect(fetch).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  });

  it.each(["replay", "automation"] as const)("blocks native %s execution before remote auth", async (execution) => {
    const fetch = vi.fn();
    await expect(
      reportProblem(reportFixture(), {
        endpoint: "https://dmc-captures-staging.example",
        channel: "staging",
        runtime: "native-ios",
        execution,
        remoteConsent: "granted",
        fetch,
      }),
    ).resolves.toEqual({ ok: false, reason: "policy:remote-requires-human-execution" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives execution from the artifact instead of prior replay playback state", async () => {
    const authenticatedUpload = vi.fn(async (_input, send) =>
      send({ "x-dmc-challenge-token": "token", "x-dmc-assertion": "assertion" }),
    );
    const fetch = vi.fn(async () => Response.json({ ok: true, id: "run", encoding: "none" }));
    const humanSession = sessionFixture();
    humanSession.meta.replaySource = "last-completed";

    await expect(
      uploadSession(humanSession, {
        channel: "staging",
        runtime: "native-ios",
        remoteConsent: "granted",
        remoteEndpoint: "https://capture.example",
        authenticatedUpload,
        compress: async () => null,
        digest: async () => "a".repeat(64),
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: true });

    const playbackReport = reportFixture();
    playbackReport.meta.replaySource = "playback";
    await expect(
      reportProblem(playbackReport, {
        channel: "staging",
        runtime: "native-ios",
        remoteConsent: "granted",
        remoteEndpoint: "https://capture.example",
        authenticatedUpload,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({ ok: false, reason: "policy:remote-requires-human-execution" });
    expect(authenticatedUpload).toHaveBeenCalledTimes(1);
  });

  it("keeps automation as an overriding deny for human artifacts", async () => {
    window.__DMC_AUTOMATION__ = true;
    const authenticatedUpload = vi.fn();
    await expect(
      uploadSession(sessionFixture(), {
        channel: "staging",
        runtime: "native-ios",
        remoteConsent: "granted",
        remoteEndpoint: "https://capture.example",
        authenticatedUpload,
      }),
    ).resolves.toEqual({ ok: false, reason: "policy:remote-requires-human-execution" });
    expect(authenticatedUpload).not.toHaveBeenCalled();
    delete window.__DMC_AUTOMATION__;
  });

  it("uses the persisted channel-scoped consent for an eligible native upload", async () => {
    const values = new Map([["dmc.capture.remote-consent.v1.staging", "granted"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    const authenticatedUpload = vi.fn(async (_input, send) => send({}));
    const fetch = vi.fn(async () => Response.json({ ok: true, id: "run", encoding: "none" }));

    await expect(
      uploadSession(sessionFixture(), {
        channel: "staging",
        runtime: "native-ios",
        execution: "human",
        remoteEndpoint: "https://capture.example",
        authenticatedUpload,
        compress: async () => null,
        digest: async () => "a".repeat(64),
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(authenticatedUpload).toHaveBeenCalledTimes(1);
  });

  it("distinguishes terminal auth failures, timeouts, and offline transport", async () => {
    const deps = {
      channel: "staging" as const,
      runtime: "native-ios" as const,
      execution: "human" as const,
      remoteConsent: "granted" as const,
      remoteEndpoint: "https://capture.example",
      compress: async () => null,
      digest: async () => "a".repeat(64),
    };
    await expect(
      uploadSession(sessionFixture(), {
        ...deps,
        authenticatedUpload: vi.fn(async () => {
          throw new CaptureAuthError("revoked", 401);
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "auth", status: 401 });
    await expect(
      uploadSession(sessionFixture(), {
        ...deps,
        authenticatedUpload: vi.fn(async () => {
          throw new CaptureAuthTimeoutError();
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "timeout" });
    await expect(
      uploadSession(sessionFixture(), {
        ...deps,
        authenticatedUpload: vi.fn(async () => {
          throw new TypeError("offline");
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "network" });
    await expect(
      uploadSession(sessionFixture(), {
        ...deps,
        authenticatedUpload: vi.fn(async (_input, send) => send({})),
        fetch: vi.fn(async () => new Response(null, { status: 401 })) as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "auth", status: 401 });
  });

  it("wraps an eligible remote upload in fresh native authorization headers", async () => {
    const authenticatedUpload = vi.fn(async (_input, send) =>
      send({ "x-dmc-challenge-token": "token", "x-dmc-assertion": "assertion" }),
    );
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "x-dmc-challenge-token": "token",
        "x-dmc-assertion": "assertion",
      });
      return Response.json({ ok: true, id: "run", encoding: "none" });
    });
    await expect(
      uploadSession(sessionFixture(), {
        channel: "staging",
        runtime: "native-ios",
        execution: "human",
        remoteConsent: "granted",
        remoteEndpoint: "https://capture.example",
        authenticatedUpload,
        compress: async () => null,
        digest: async () => "a".repeat(64),
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(authenticatedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "staging", purpose: "session", decodedBodySha256: "a".repeat(64) }),
      expect.any(Function),
      undefined,
    );
  });
});
