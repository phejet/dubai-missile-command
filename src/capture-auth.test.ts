// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAttestClient } from "./app-attest";
import {
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
        return Response.json({ ok: true, challengeToken: "exact-token" });
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
    expect(secondSend).toHaveBeenCalledWith({
      "x-dmc-challenge-token": "token-2",
      "x-dmc-assertion": "assertion-2",
    });
    expect(hashes).toEqual([
      digest(captureClientData("token-1", "ab".repeat(32))),
      digest(captureClientData("token-2", "ab".repeat(32))),
    ]);
  });
});
