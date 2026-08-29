import { describe, expect, it } from "vitest";
import { deriveCaptureProvenance } from "./capture-provenance";

describe("capture submission provenance", () => {
  it.each([
    ["TEAM.com.phejet.dubaicmd.dev", "dev", "com.phejet.dubaicmd.dev"],
    ["TEAM.com.phejet.dubaicmd.staging", "staging", "com.phejet.dubaicmd.staging"],
    ["TEAM.com.phejet.dubaicmd", "production", "com.phejet.dubaicmd"],
  ] as const)("derives %s from the attested Apple app ID", (appId, appFlavor, bundleId) => {
    expect(deriveCaptureProvenance(appId, "TEAM", "development")).toEqual({
      appFlavor,
      bundleId,
      appleEnvironment: "development",
    });
  });

  it("keeps legacy and non-product identities explicitly unknown", () => {
    expect(deriveCaptureProvenance(null, "TEAM", "production")).toEqual({
      appFlavor: "unknown",
      bundleId: null,
      appleEnvironment: "production",
    });
    expect(deriveCaptureProvenance("OTHER.com.phejet.dubaicmd.dev", "TEAM", "development")).toEqual({
      appFlavor: "unknown",
      bundleId: null,
      appleEnvironment: "development",
    });
    expect(deriveCaptureProvenance("TEAM.com.example.internal", "TEAM", "development")).toEqual({
      appFlavor: "unknown",
      bundleId: "com.example.internal",
      appleEnvironment: "development",
    });
  });
});
