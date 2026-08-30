// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRunShareLink } from "./share-run";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("run sharing client", () => {
  it("signs the exact share body and accepts only a same-origin Worker link", async () => {
    const authenticatedUpload = vi.fn(async (input, send) => {
      expect(input).toMatchObject({
        endpoint: "https://capture.example",
        channel: "staging",
        purpose: "share",
        buildId: "build-1",
      });
      return send({ "x-dmc-challenge-token": "token", "x-dmc-assertion": "assertion" });
    });
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ runId: "run-1", buildId: "build-1" });
      expect(new Headers(init?.headers).get("x-dmc-sha256")).toBe(sha256(body));
      return Response.json({
        ok: true,
        shareId: "0123456789abcdef",
        shareUrl: "https://capture.example/r/0123456789abcdef",
      });
    });

    await expect(
      createRunShareLink(
        { endpoint: "https://capture.example", channel: "staging", buildId: "build-1", runId: "run-1" },
        {
          runtime: "native-ios",
          execution: "human",
          remoteConsent: "granted",
          fetch: fetch as typeof globalThis.fetch,
          authenticatedUpload,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      shareId: "0123456789abcdef",
      shareUrl: "https://capture.example/r/0123456789abcdef",
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://capture.example/api/share"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed for automation, missing consent, and an injected response origin", async () => {
    const authenticatedUpload = vi.fn();
    for (const [execution, remoteConsent] of [
      ["automation", "granted"],
      ["human", "unknown"],
      ["replay", "granted"],
    ] as const) {
      const result = await createRunShareLink(
        { endpoint: "https://capture.example", channel: "staging", buildId: "build-1", runId: "run-1" },
        { runtime: "native-ios", execution, remoteConsent, authenticatedUpload },
      );
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("policy:") });
    }
    expect(authenticatedUpload).not.toHaveBeenCalled();

    const poisonedUpload = async <T>(): Promise<T> =>
      Response.json({
        shareId: "0123456789abcdef",
        shareUrl: "https://evil.example/r/0123456789abcdef",
      }) as unknown as T;
    const poisoned = await createRunShareLink(
      { endpoint: "https://capture.example", channel: "staging", buildId: "build-1", runId: "run-1" },
      {
        runtime: "native-ios",
        execution: "human",
        remoteConsent: "granted",
        authenticatedUpload: poisonedUpload,
      },
    );
    expect(poisoned).toEqual({ ok: false, reason: "invalid-response" });
  });
});
