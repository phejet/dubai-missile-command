import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capture R2 lifecycle configuration", () => {
  it("keeps diagnostics for 90 days and replays for 400 days", () => {
    const config = JSON.parse(readFileSync(new URL("./lifecycle.json", import.meta.url), "utf8")) as {
      rules: Array<{
        conditions: { prefix: string };
        deleteObjectsTransition: { condition: { maxAge: number } };
      }>;
    };
    expect(
      config.rules.map((rule) => ({
        prefix: rule.conditions.prefix,
        maxAge: rule.deleteObjectsTransition.condition.maxAge,
      })),
    ).toEqual([
      { prefix: "diagnostics/", maxAge: 90 * 24 * 60 * 60 },
      { prefix: "replays/", maxAge: 400 * 24 * 60 * 60 },
    ]);
    expect(config.rules.some((rule) => rule.conditions.prefix === "captures/")).toBe(false);
  });
});
