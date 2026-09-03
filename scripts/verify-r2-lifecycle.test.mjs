import { describe, expect, it } from "vitest";
import {
  assertLifecycleRules,
  normalizeLifecycleRules,
  parseLifecycleArgs,
  verifyLifecycle,
} from "./verify-r2-lifecycle.mjs";

const rules = [
  {
    id: "expire-replays-after-270-days",
    enabled: true,
    conditions: { prefix: "replays/" },
    deleteObjectsTransition: { condition: { type: "Age", maxAge: 23_328_000 } },
  },
  {
    id: "expire-diagnostics-after-90-days",
    enabled: true,
    conditions: { prefix: "diagnostics/" },
    deleteObjectsTransition: { condition: { type: "Age", maxAge: 7_776_000 } },
  },
];

describe("R2 lifecycle verification", () => {
  it("accepts only exact environment/bucket pairs", () => {
    expect(parseLifecycleArgs(["--env=staging", "--bucket=dmc-captures-staging"])).toEqual({
      environment: "staging",
      bucket: "dmc-captures-staging",
    });
    expect(() => parseLifecycleArgs(["--env=staging", "--bucket=dmc-captures"])).toThrow("requires bucket");
  });

  it("normalizes ordering but rejects any policy drift", () => {
    expect(assertLifecycleRules([...rules].reverse(), rules)).toEqual(normalizeLifecycleRules(rules));
    const drifted = structuredClone(rules);
    drifted[0].deleteObjectsTransition.condition.maxAge = 400;
    expect(() => assertLifecycleRules(drifted, rules)).toThrow("does not match");
  });

  it("requires credentials and validates Cloudflare success", async () => {
    await expect(
      verifyLifecycle({ environment: "staging", bucket: "dmc-captures-staging" }, {}, () => {
        throw new Error("must not fetch");
      }),
    ).rejects.toThrow("required");
    await expect(
      verifyLifecycle(
        { environment: "staging", bucket: "dmc-captures-staging" },
        { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "token" },
        async () => new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    ).rejects.toThrow("not successful");
  });
});
