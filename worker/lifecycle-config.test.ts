import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capture R2 lifecycle configuration", () => {
  it("keeps diagnostics for 90 days and replays for 400 days", () => {
    const config = JSON.parse(readFileSync(new URL("./lifecycle.json", import.meta.url), "utf8")) as {
      rules: Array<{
        id: string;
        enabled: true;
        conditions: { prefix: string };
        deleteObjectsTransition: { condition: { type: "Age"; maxAge: number } };
      }>;
    };
    expect(
      config.rules.map((rule) => ({
        prefix: rule.conditions.prefix,
        type: rule.deleteObjectsTransition.condition.type,
        maxAge: rule.deleteObjectsTransition.condition.maxAge,
      })),
    ).toEqual([
      { prefix: "diagnostics/", type: "Age", maxAge: 90 * 24 * 60 * 60 },
      { prefix: "replays/", type: "Age", maxAge: 400 * 24 * 60 * 60 },
    ]);
    expect(config.rules.every((rule) => rule.enabled && rule.id.length > 0)).toBe(true);
    expect(config.rules.some((rule) => rule.conditions.prefix === "captures/")).toBe(false);
  });
});
