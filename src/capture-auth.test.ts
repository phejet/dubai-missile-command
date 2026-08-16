// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAttestClient } from "./app-attest";
import {
  CaptureAuthTimeoutError,
  enrollCaptureCredential,
  resetCaptureAuthCoordinatorForTest,
  withAuthenticatedCaptureUpload,
} from "./capture-auth";
import { captureClientData, enrollmentClientData } from "./capture-auth-protocol";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function digest(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

describe("native capture authentication client", () => {
  afterEach(() => {
    resetCaptureAuthCoordinatorForTest();
    vi.restoreAllMocks();
  });

  it("enrolls with the exact canonical challenge hash and persists only the public key ID", async () => {
    const storage = memoryStorage();
    const attestKey = vi.fn(async () => "attestation-url");
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: async () => "apple-public-key-id",
      attestKey,
      generateAssertion: vi.fn(),
    };
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/challenge")) {
        return Response.json({ ok: true, challengeToken: "exact-token", expiresAt: Date.now() + 60_000 });
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        keyId: "apple-public-key-id",
        attestation: "attestation-url",
        challengeToken: "exact-token",
      });
      return Response.json({ ok: true });
    });

    await expect(
      enrollCaptureCredential(
        { endpoint: "https://capture.example", channel: "staging", buildId: "build" },
        { appAttest, fetch: fetch as typeof globalThis.fetch, storage },
      ),
    ).resolves.toEqual({ keyId: "apple-public-key-id" });
    expect(attestKey).toHaveBeenCalledWith("apple-public-key-id", digest(enrollmentClientData("exact-token")));
    expect(storage.getItem("dmc.app-attest.key-id.v1.staging")).toBe("apple-public-key-id");
    expect(storage.getItem("dmc.app-attest.pending-enrollment.v1.staging")).toBeNull();
  });

  it("persists a generated key before enrollment and reuses it after a network failure", async () => {
    const storage = memoryStorage();
    const generateKey = vi.fn(async () => "reusable-key-id");
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey,
      attestKey: vi.fn(async () => "attestation"),
      generateAssertion: vi.fn(),
    };
    const offlineFetch = vi.fn(async () => {
      throw new TypeError("offline");
    });

    await expect(
      enrollCaptureCredential(
        { endpoint: "https://capture.example", channel: "staging", buildId: "build" },
        { appAttest, fetch: offlineFetch as typeof globalThis.fetch, storage },
      ),
    ).rejects.toThrow("offline");
    expect(storage.getItem("dmc.app-attest.key-id.v1.staging")).toBe("reusable-key-id");

    const successFetch = vi.fn(async (url: URL | RequestInfo) =>
      String(url).endsWith("/api/auth/challenge")
        ? Response.json({ challengeToken: "retry-token", expiresAt: Date.now() + 60_000 })
        : Response.json({ ok: true }),
    );
    await enrollCaptureCredential(
      { endpoint: "https://capture.example", channel: "staging", buildId: "build" },
      { appAttest, fetch: successFetch as typeof globalThis.fetch, storage },
    );
    expect(generateKey).toHaveBeenCalledTimes(1);
  });

  it("retries Apple server unavailability with the exact same key and client-data hash", async () => {
    const storage = memoryStorage();
    const hashes: Uint8Array[] = [];
    const serverUnavailable = Object.assign(new Error("offline"), { code: "APP_ATTEST_SERVER_UNAVAILABLE" });
    const attestKey = vi.fn(async (_keyId: string, hash: Uint8Array) => {
      hashes.push(hash);
      if (hashes.length === 1) throw serverUnavailable;
      return "attestation";
    });
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: vi.fn(async () => "retry-key-id"),
      attestKey,
      generateAssertion: vi.fn(),
    };
    const fetch = vi.fn(async (url: URL | RequestInfo) =>
      String(url).endsWith("/api/auth/challenge")
        ? Response.json({ challengeToken: "stable-token", expiresAt: Date.now() + 60_000 })
        : Response.json({ ok: true }),
    );
    const input = { endpoint: "https://capture.example", channel: "staging" as const, buildId: "build" };

    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).rejects.toBe(serverUnavailable);
    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).resolves.toEqual({ keyId: "retry-key-id" });

    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/api/auth/challenge"))).toHaveLength(1);
    expect(attestKey).toHaveBeenCalledTimes(2);
    expect(hashes).toEqual([
      digest(enrollmentClientData("stable-token")),
      digest(enrollmentClientData("stable-token")),
    ]);
  });

  it("reposts cached attestation proof after an ambiguous enrollment transport failure", async () => {
    const storage = memoryStorage();
    const attestKey = vi.fn(async () => "cached-attestation");
    let enrollmentPosts = 0;
    const fetch = vi.fn(async (url: URL | RequestInfo) => {
      if (String(url).endsWith("/api/auth/challenge")) {
        return Response.json({ challengeToken: "cached-token", expiresAt: Date.now() + 60_000 });
      }
      enrollmentPosts++;
      if (enrollmentPosts === 1) throw new TypeError("connection lost after send");
      return Response.json({ ok: true });
    });
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: vi.fn(async () => "cached-key-id"),
      attestKey,
      generateAssertion: vi.fn(),
    };
    const input = { endpoint: "https://capture.example", channel: "staging" as const, buildId: "build" };

    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).rejects.toThrow("connection lost after send");
    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).resolves.toEqual({ keyId: "cached-key-id" });

    expect(attestKey).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/api/auth/challenge"))).toHaveLength(1);
  });

  it("discards a terminal App Attest key before a later enrollment attempt", async () => {
    const storage = memoryStorage();
    const generateKey = vi.fn(async () => `key-${generateKey.mock.calls.length}`);
    let attestationCalls = 0;
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey,
      attestKey: vi.fn(async () => {
        attestationCalls++;
        if (attestationCalls === 1) throw Object.assign(new Error("invalid key"), { code: "APP_ATTEST_3" });
        return "attestation";
      }),
      generateAssertion: vi.fn(),
    };
    const fetch = vi.fn(async (url: URL | RequestInfo) =>
      String(url).endsWith("/api/auth/challenge")
        ? Response.json({ challengeToken: `token-${fetch.mock.calls.length}`, expiresAt: Date.now() + 60_000 })
        : Response.json({ ok: true }),
    );
    const input = { endpoint: "https://capture.example", channel: "staging" as const, buildId: "build" };

    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).rejects.toThrow("invalid key");
    expect(storage.getItem("dmc.app-attest.key-id.v1.staging")).toBeNull();
    await expect(
      enrollCaptureCredential(input, { appAttest, fetch: fetch as typeof globalThis.fetch, storage }),
    ).resolves.toEqual({ keyId: "key-2" });
    expect(generateKey).toHaveBeenCalledTimes(2);
  });

  it("replaces an expired pending enrollment instead of changing its attestation hash", async () => {
    const storage = memoryStorage();
    storage.setItem("dmc.app-attest.key-id.v1.staging", "expired-key-id");
    storage.setItem(
      "dmc.app-attest.pending-enrollment.v1.staging",
      JSON.stringify({
        version: 1,
        keyId: "expired-key-id",
        endpoint: "https://capture.example",
        buildId: "build",
        challengeToken: "expired-token",
        expiresAt: Date.now() - 1,
      }),
    );
    const attestKey = vi.fn(async () => "attestation");
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: vi.fn(async () => "replacement-key-id"),
      attestKey,
      generateAssertion: vi.fn(),
    };
    const fetch = vi.fn(async (url: URL | RequestInfo) =>
      String(url).endsWith("/api/auth/challenge")
        ? Response.json({ challengeToken: "replacement-token", expiresAt: Date.now() + 60_000 })
        : Response.json({ ok: true }),
    );

    await expect(
      enrollCaptureCredential(
        { endpoint: "https://capture.example", channel: "staging", buildId: "build" },
        { appAttest, fetch: fetch as typeof globalThis.fetch, storage },
      ),
    ).resolves.toEqual({ keyId: "replacement-key-id" });
    expect(attestKey).toHaveBeenCalledWith("replacement-key-id", digest(enrollmentClientData("replacement-token")));
  });

  it("serializes challenge, assertion, and upload as one counter-sensitive critical section", async () => {
    const storage = memoryStorage();
    storage.setItem("dmc.app-attest.key-id.v1.staging", "key-id");
    let challengeCount = 0;
    const fetch = vi.fn(async () => Response.json({ challengeToken: `token-${++challengeCount}` }));
    const hashes: Uint8Array[] = [];
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: vi.fn(),
      attestKey: vi.fn(),
      generateAssertion: async (_keyId, hash) => {
        hashes.push(hash);
        return `assertion-${hashes.length}`;
      },
    };
    let releaseFirst!: () => void;
    const firstUpload = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const input = {
      endpoint: "https://capture.example",
      channel: "staging" as const,
      purpose: "session" as const,
      buildId: "build",
      decodedBodySha256: "ab".repeat(32),
    };
    const first = withAuthenticatedCaptureUpload(input, async () => firstUpload, {
      appAttest,
      fetch: fetch as typeof globalThis.fetch,
      storage,
    });
    const secondSend = vi.fn(async () => undefined);
    const second = withAuthenticatedCaptureUpload(input, secondSend, {
      appAttest,
      fetch: fetch as typeof globalThis.fetch,
      storage,
    });

    await vi.waitFor(() => expect(challengeCount).toBe(1));
    expect(secondSend).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second]);
    expect(challengeCount).toBe(2);
    expect(secondSend).toHaveBeenCalledWith(
      {
        "x-dmc-challenge-token": "token-2",
        "x-dmc-assertion": "assertion-2",
      },
      expect.anything(),
    );
    expect(hashes).toEqual([
      digest(captureClientData("token-1", "ab".repeat(32))),
      digest(captureClientData("token-2", "ab".repeat(32))),
    ]);
  });

  it("times out a stalled turn and releases the next queued upload", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.setItem("dmc.app-attest.key-id.v1.staging", "key-id");
    let assertionCall = 0;
    let firstAssertionStarted!: () => void;
    let resolveFirstAssertion!: (assertion: string) => void;
    const firstAssertion = new Promise<void>((resolve) => {
      firstAssertionStarted = resolve;
    });
    const appAttest: AppAttestClient = {
      isSupported: async () => true,
      generateKey: vi.fn(),
      attestKey: vi.fn(),
      generateAssertion: vi.fn(async () => {
        assertionCall++;
        if (assertionCall === 1) {
          firstAssertionStarted();
          return await new Promise<string>((resolve) => {
            resolveFirstAssertion = resolve;
          });
        }
        return "assertion-2";
      }),
    };
    const challengeSignals: AbortSignal[] = [];
    const fetch = vi.fn(async (...args: [URL | RequestInfo, RequestInit?]) => {
      challengeSignals.push(args[1]?.signal as AbortSignal);
      return Response.json({ challengeToken: `token-${fetch.mock.calls.length}` });
    });
    const input = {
      endpoint: "https://capture.example",
      channel: "staging" as const,
      purpose: "session" as const,
      buildId: "build",
      decodedBodySha256: "ab".repeat(32),
    };
    const firstSend = vi.fn(async () => "late-send");
    const first = withAuthenticatedCaptureUpload(input, firstSend, {
      appAttest,
      fetch: fetch as typeof globalThis.fetch,
      storage,
      timeoutMs: 10,
    });
    const firstOutcome = first.catch((error: unknown) => error);
    await firstAssertion;
    const secondSend = vi.fn(async () => "sent");
    const second = withAuthenticatedCaptureUpload(input, secondSend, {
      appAttest,
      fetch: fetch as typeof globalThis.fetch,
      storage,
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(await firstOutcome).toBeInstanceOf(CaptureAuthTimeoutError);
    expect(challengeSignals[0].aborted).toBe(true);
    await expect(second).resolves.toBe("sent");
    expect(secondSend).toHaveBeenCalledTimes(1);
    resolveFirstAssertion("assertion-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSend).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
