import { describe, expect, it } from "vitest";
import type { Env } from "./bindings";
import { CaptureAuthorizationError, captureAuthConfig, requireAllowedBuild } from "./capture-auth";

function configEnv(overrides: Partial<Env> = {}): Env {
  return {
    WORKER_BUILD: "staging",
    CAPTURE_AUTH_SECRET: "test-capture-auth-secret-32-bytes-minimum",
    ALLOWED_BUILDS: "build-1",
    APPLE_TEAM_ID: "TESTTEAM1",
    APPLE_BUNDLE_IDS: "com.phejet.dubaicmd.staging,com.phejet.dubaicmd.dev",
    APPLE_BUNDLE_VERSIONS: "1,2",
    APPLE_VALIDATION_CATEGORIES: "2,3",
    APPLE_ATTEST_ENVIRONMENTS: "development,production",
    ENROLLMENT_ENABLED: "true",
    ...overrides,
  } as Env;
}

function expectConfigReason(run: () => unknown, reason: string): void {
  try {
    run();
    throw new Error("Expected capture auth configuration to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CaptureAuthorizationError);
    expect((error as CaptureAuthorizationError).reason).toBe(reason);
  }
}

describe("capture auth bundle identity configuration", () => {
  it("accepts an explicit staging bundle-ID allowlist", () => {
    const config = captureAuthConfig(configEnv());
    expect(config.appleTeamId).toBe("TESTTEAM1");
    expect([...config.appIds]).toEqual(["TESTTEAM1.com.phejet.dubaicmd.staging", "TESTTEAM1.com.phejet.dubaicmd.dev"]);
  });

  it("fails closed for missing or malformed bundle IDs", () => {
    expectConfigReason(() => captureAuthConfig(configEnv({ APPLE_BUNDLE_IDS: "" })), "config:apple-app");
    expectConfigReason(() => captureAuthConfig(configEnv({ APPLE_BUNDLE_IDS: "not a bundle" })), "config:apple-app");
  });

  it("pins production to the production bundle ID only", () => {
    const production = {
      WORKER_BUILD: "production",
      APPLE_BUNDLE_IDS: "com.phejet.dubaicmd",
      APPLE_ATTEST_ENVIRONMENTS: "production",
    } satisfies Partial<Env>;
    expect([...captureAuthConfig(configEnv(production)).appIds]).toEqual(["TESTTEAM1.com.phejet.dubaicmd"]);
    expectConfigReason(
      () =>
        captureAuthConfig(
          configEnv({ ...production, APPLE_BUNDLE_IDS: "com.phejet.dubaicmd,com.phejet.dubaicmd.staging" }),
        ),
      "config:production-apple-bundle-id",
    );
    expectConfigReason(
      () => captureAuthConfig(configEnv({ ...production, APPLE_BUNDLE_IDS: "com.phejet.dubaicmd.prod" })),
      "config:production-apple-bundle-id",
    );
  });
});

describe("capture auth build allowlist", () => {
  it("accepts only listed builds from an exact list", () => {
    const config = captureAuthConfig(configEnv({ ALLOWED_BUILDS: "build-1,build-2" }));
    expect(() => requireAllowedBuild("build-2", config)).not.toThrow();
    expectConfigReason(() => requireAllowedBuild("build-1+dirty", config), "build:not-allowed");
  });

  it("accepts any build on staging when the list is *", () => {
    const config = captureAuthConfig(configEnv({ ALLOWED_BUILDS: "*" }));
    expect(() => requireAllowedBuild("b333183+7e9ef4ad", config)).not.toThrow();
  });

  it("still fails closed for an empty list", () => {
    expectConfigReason(() => captureAuthConfig(configEnv({ ALLOWED_BUILDS: " , " })), "config:allowed-builds");
  });

  it("refuses * in production", () => {
    const production = {
      WORKER_BUILD: "production",
      APPLE_BUNDLE_IDS: "com.phejet.dubaicmd",
      APPLE_ATTEST_ENVIRONMENTS: "production",
    } satisfies Partial<Env>;
    expectConfigReason(
      () => captureAuthConfig(configEnv({ ...production, ALLOWED_BUILDS: "*" })),
      "config:production-allowed-builds",
    );
    expectConfigReason(
      () => captureAuthConfig(configEnv({ ...production, ALLOWED_BUILDS: "build-1,*" })),
      "config:production-allowed-builds",
    );
  });
});
