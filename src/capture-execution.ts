import { Capacitor } from "@capacitor/core";
import type { CaptureExecutionKind, CaptureRuntimeKind } from "./capture-policy";

let currentExecution: "human" | "replay" = "human";

export function markCaptureExecution(execution: "human" | "replay"): void {
  currentExecution = execution;
}

export function getCaptureExecution(): CaptureExecutionKind {
  if (typeof navigator !== "undefined" && navigator.webdriver) return "automation";
  if (typeof window !== "undefined" && window.__DMC_AUTOMATION__ === true) return "automation";
  return currentExecution;
}

export function detectCaptureRuntime(): CaptureRuntimeKind {
  if (Capacitor.isNativePlatform()) return "native-ios";
  if (typeof window === "undefined" || typeof document === "undefined") return "headless";
  return "local-browser";
}

export function resetCaptureExecutionForTest(): void {
  currentExecution = "human";
}
