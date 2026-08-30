import { describe, expect, it, vi } from "vitest";
import { fetchSharedReplay, parseSharedReplayRequest } from "./shared-replay";

const id = "0123456789abcdef";
const bases = { staging: "https://staging.example", production: "https://production.example" };

describe("shared replay boot contract", () => {
  it("maps only a valid environment to its reviewed endpoint", () => {
    expect(parseSharedReplayRequest(`https://game.example/?r=${id}&share=staging`, bases)).toEqual({
      endpoint: "https://staging.example",
      environment: "staging",
      shareId: id,
    });
    expect(parseSharedReplayRequest(`https://game.example/?r=${id}&share=https://evil.example`, bases)).toBeNull();
    expect(parseSharedReplayRequest("https://game.example/?r=../secret&share=staging", bases)).toBeNull();
    expect(
      parseSharedReplayRequest(`https://game.example/?r=${id}&share=staging`, {
        ...bases,
        staging: "https://staging.example/poisoned",
      }),
    ).toBeNull();
  });

  it("fetches and validates the public replay envelope", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        shareId: id,
        summary: { build: "build-1", outcome: "burj_destroyed", score: 1234, wave: 4 },
        replay: { seed: 7, actions: [] },
      }),
    );
    await expect(
      fetchSharedReplay(
        { endpoint: "https://staging.example", environment: "staging", shareId: id },
        fetch as typeof globalThis.fetch,
      ),
    ).resolves.toMatchObject({ shareId: id, summary: { score: 1234, wave: 4 }, replay: { seed: 7, actions: [] } });
    expect(fetch).toHaveBeenCalledWith(new URL(`https://staging.example/api/shared/${id}`), {
      headers: { accept: "application/json" },
    });
  });

  it("rejects mismatched IDs and malformed replay data", async () => {
    for (const body of [
      { ok: true, shareId: "ffffffffffffffff", summary: {}, replay: {} },
      {
        ok: true,
        shareId: id,
        summary: { build: "build", outcome: "lost", score: 1, wave: 1 },
        replay: { seed: 1, actions: "not-actions" },
      },
    ]) {
      await expect(
        fetchSharedReplay({ endpoint: "https://staging.example", environment: "staging", shareId: id }, async () =>
          Response.json(body),
        ),
      ).rejects.toThrow("invalid");
    }
  });
});
