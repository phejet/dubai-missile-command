import { describe, expect, it } from "vitest";
import { authorized, constantTimeEqual } from "../src/auth";

describe("capture retrieval auth", () => {
  it("compares bearer values without early length or byte exits", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
    expect(constantTimeEqual("secret", "secrex")).toBe(false);
    expect(constantTimeEqual("short", "much-longer")).toBe(false);
  });

  it("fails closed when the secret or bearer header is absent", () => {
    expect(authorized(new Request("https://worker.test"), undefined)).toBe(false);
    expect(authorized(new Request("https://worker.test"), "secret")).toBe(false);
    expect(
      authorized(new Request("https://worker.test", { headers: { Authorization: "Bearer secret" } }), "secret"),
    ).toBe(true);
  });
});
