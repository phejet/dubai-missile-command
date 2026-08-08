export type CaptureChannel = "off" | "local" | "staging" | "production";
export type CaptureRuntimeKind = "native-ios" | "local-browser" | "headless";
export type CaptureExecutionKind = "human" | "replay" | "automation";
export type RemoteCaptureConsent = "unknown" | "denied" | "granted";

export interface CapturePolicyInput {
  channel: CaptureChannel;
  runtime: CaptureRuntimeKind;
  execution: CaptureExecutionKind;
  remoteConsent: RemoteCaptureConsent;
}

export type CapturePolicyResult =
  | { allowed: false; reason: string }
  | { allowed: true; destination: "local" }
  | { allowed: true; destination: "remote"; environment: "staging" | "production" };

export function decideCapturePolicy(input: CapturePolicyInput): CapturePolicyResult {
  if (input.channel === "off") return { allowed: false, reason: "channel-off" };

  if (input.channel === "local") {
    if (input.runtime === "local-browser") return { allowed: true, destination: "local" };
    return {
      allowed: false,
      reason: input.runtime === "headless" ? "headless-has-no-transport" : "native-has-no-local-sink",
    };
  }

  if (input.runtime !== "native-ios") return { allowed: false, reason: "remote-requires-native-ios" };
  if (input.execution !== "human") return { allowed: false, reason: "remote-requires-human-execution" };
  if (input.remoteConsent !== "granted") return { allowed: false, reason: "remote-consent-not-granted" };
  return { allowed: true, destination: "remote", environment: input.channel };
}
