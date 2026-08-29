import type { AppleAttestEnvironment } from "./app-attest";

export type CaptureAppFlavor = "dev" | "staging" | "production" | "unknown";

export interface CaptureSubmissionProvenance {
  appFlavor: CaptureAppFlavor;
  bundleId: string | null;
  appleEnvironment: AppleAttestEnvironment | null;
}

const FLAVOR_BY_BUNDLE_ID: Readonly<Record<string, Exclude<CaptureAppFlavor, "unknown">>> = {
  "com.phejet.dubaicmd.dev": "dev",
  "com.phejet.dubaicmd.staging": "staging",
  "com.phejet.dubaicmd": "production",
};

export function deriveCaptureProvenance(
  appleAppId: string | null,
  appleTeamId: string,
  appleEnvironment: AppleAttestEnvironment | null,
): CaptureSubmissionProvenance {
  const prefix = `${appleTeamId}.`;
  const bundleId = appleAppId?.startsWith(prefix) ? appleAppId.slice(prefix.length) : null;
  return {
    appFlavor: bundleId ? (FLAVOR_BY_BUNDLE_ID[bundleId] ?? "unknown") : "unknown",
    bundleId,
    appleEnvironment,
  };
}
