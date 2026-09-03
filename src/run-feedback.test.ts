import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { submitRunFeedback } from "./run-feedback";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("run feedback client", () => {
  it("authenticates the exact emoji-only body", async () => {
    const authenticatedUpload = vi.fn(async (input, send) => {
      expect(input).toMatchObject({ purpose: "feedback", buildId: "build-1" });
      return send({ "x-dmc-challenge-token": "token", "x-dmc-assertion": "assertion" });
    });
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const bytes = new Uint8Array(init?.body as ArrayBuffer);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
        runId: "run-1",
        buildId: "build-1",
        emoji: "🔥",
      });
      expect(new Headers(init?.headers).get("x-dmc-sha256")).toBe(sha256(bytes));
      return Response.json({ ok: true, emoji: "🔥" });
    });
    await expect(
      submitRunFeedback(
        {
          endpoint: "https://capture.example",
          channel: "staging",
          buildId: "build-1",
          runId: "run-1",
          emoji: "🔥",
        },
        {
          runtime: "native-ios",
          execution: "human",
          remoteConsent: "granted",
          fetch: fetch as typeof globalThis.fetch,
          authenticatedUpload,
        },
      ),
    ).resolves.toEqual({ ok: true, emoji: "🔥" });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://capture.example/api/feedback"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed without consent", async () => {
    const authenticatedUpload = vi.fn();
    await expect(
      submitRunFeedback(
        {
          endpoint: "https://capture.example",
          channel: "staging",
          buildId: "build-1",
          runId: "run-1",
          emoji: "👍",
        },
        { runtime: "native-ios", execution: "human", remoteConsent: "denied", authenticatedUpload },
      ),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("policy:") });
    expect(authenticatedUpload).not.toHaveBeenCalled();
  });
});
