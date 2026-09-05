import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  additiveList,
  appleToken,
  createAppleClient,
  selectGroup,
  verifyDeployment,
  verifyManifest,
} from "./release-staging.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = { privateKey, keyId: "fixture-key", issuerId: "fixture-issuer" };

describe("Staging TestFlight release guards", () => {
  it("signs short-lived Apple JWTs using the required raw ES256 signature", () => {
    const [header, payload, signature] = appleToken(credentials, 1000).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "ES256", kid: "fixture-key", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url"))).toEqual({
      iss: "fixture-issuer",
      iat: 1000,
      exp: 1120,
      aud: "appstoreconnect-v1",
    });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("only appends unique allowlist entries and refuses empty policy", () => {
    expect(additiveList("old, current", "new")).toBe("old,current,new");
    expect(additiveList("old,current", "current")).toBe("old,current");
    expect(() => additiveList(" , ", "new")).toThrow("empty");
  });

  it("never selects an external or ambiguous tester group", () => {
    const internal = { id: "a", attributes: { isInternalGroup: true } };
    const external = { id: "b", attributes: { isInternalGroup: false } };
    expect(selectGroup([internal, external])).toBe(internal);
    expect(() => selectGroup([internal, external], "b")).toThrow();
    expect(() => selectGroup([internal, { ...internal, id: "c" }])).toThrow();
  });

  it("requires Staging archive identity and the exact source", () => {
    const manifest = { flavor: "staging", channel: "staging", buildId: "abc" };
    expect(() => verifyManifest(manifest, "abc")).not.toThrow();
    for (const patch of [{ flavor: "production" }, { channel: "production" }, { buildId: "abc+dirty" }]) {
      expect(() => verifyManifest({ ...manifest, ...patch }, "abc")).toThrow();
    }
  });

  it("requires the matching successful Staging deployment and skipped Production", () => {
    const run = {
      headSha: "abc",
      conclusion: "success",
      jobs: [
        { name: "staging", conclusion: "success" },
        { name: "production", conclusion: "skipped" },
      ],
    };
    expect(() => verifyDeployment(run, "abc")).not.toThrow();
    expect(() => verifyDeployment(run, "other")).toThrow();
    expect(() => verifyDeployment({ ...run, conclusion: "failure" }, "abc")).toThrow();
    expect(() =>
      verifyDeployment(
        {
          ...run,
          jobs: [
            { name: "staging", conclusion: "success" },
            { name: "production", conclusion: "success" },
          ],
        },
        "abc",
      ),
    ).toThrow();
  });

  it("sends build assignment to Apple and rejects credential egress/redirects", async () => {
    const calls = [];
    const apple = createAppleClient(credentials, async (...args) => {
      calls.push(args);
      return new Response(null, { status: 204 });
    });
    const data = { data: [{ type: "builds", id: "fixture-build" }] };
    await apple("/v1/betaGroups/fixture-group/relationships/builds", "POST", data);
    expect(calls[0][0].origin).toBe("https://api.appstoreconnect.apple.com");
    expect(calls[0][1].redirect).toBe("error");
    expect(JSON.parse(calls[0][1].body)).toEqual(data);
    await expect(apple("https://example.com/steal")).rejects.toThrow("another origin");
    expect(calls).toHaveLength(1);
  });
});
