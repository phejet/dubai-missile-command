import { Capacitor } from "@capacitor/core";
import type { CaptureExecutionKind, CaptureRuntimeKind } from "./capture-policy";

export function detectCaptureExecution(
  replaySource: "live" | "last-completed" | "playback" | "none",
): CaptureExecutionKind {
  if (typeof navigator !== "undefined" && navigator.webdriver) return "automation";
  if (typeof window !== "undefined" && window.__DMC_AUTOMATION__ === true) return "automation";
  return replaySource === "playback" ? "replay" : "human";
}

export function detectCaptureRuntime(): CaptureRuntimeKind {
  if (Capacitor.isNativePlatform()) return "native-ios";
  if (typeof window === "undefined" || typeof document === "undefined") return "headless";
  return "local-browser";
}
