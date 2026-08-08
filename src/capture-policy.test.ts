import { describe, expect, it } from "vitest";
import {
  decideCapturePolicy,
  type CaptureChannel,
  type CaptureExecutionKind,
  type CaptureRuntimeKind,
  type RemoteCaptureConsent,
} from "./capture-policy";

function decide(
  channel: CaptureChannel,
  runtime: CaptureRuntimeKind,
  execution: CaptureExecutionKind = "human",
  remoteConsent: RemoteCaptureConsent = "unknown",
) {
  return decideCapturePolicy({ channel, runtime, execution, remoteConsent });
}

describe("capture eligibility policy", () => {
  it("denies every off-channel combination", () => {
    for (const runtime of ["native-ios", "local-browser", "headless"] as const) {
      for (const execution of ["human", "replay", "automation"] as const) {
        for (const remoteConsent of ["unknown", "denied", "granted"] as const) {
          expect(decide("off", runtime, execution, remoteConsent)).toEqual({
            allowed: false,
            reason: "channel-off",
          });
        }
      }
    }
  });

  it("allows the local middleware only from a browser", () => {
    for (const execution of ["human", "replay", "automation"] as const) {
      expect(decide("local", "local-browser", execution)).toEqual({ allowed: true, destination: "local" });
    }
    expect(decide("local", "native-ios")).toEqual({ allowed: false, reason: "native-has-no-local-sink" });
    expect(decide("local", "headless")).toEqual({ allowed: false, reason: "headless-has-no-transport" });
  });

  it("allows remote capture only for consented human play on native iOS", () => {
    for (const channel of ["staging", "production"] as const) {
      expect(decide(channel, "native-ios", "human", "granted")).toEqual({
        allowed: true,
        destination: "remote",
        environment: channel,
      });
      for (const runtime of ["local-browser", "headless"] as const) {
        expect(decide(channel, runtime, "human", "granted")).toMatchObject({ allowed: false });
      }
      for (const execution of ["replay", "automation"] as const) {
        expect(decide(channel, "native-ios", execution, "granted")).toEqual({
          allowed: false,
          reason: "remote-requires-human-execution",
        });
      }
      for (const consent of ["unknown", "denied"] as const) {
        expect(decide(channel, "native-ios", "human", consent)).toEqual({
          allowed: false,
          reason: "remote-consent-not-granted",
        });
      }
    }
  });
});
