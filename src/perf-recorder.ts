import type { PerfSink } from "./perf-sinks";

export const PERF_REPORT_SCHEMA_VERSION = 1 as const;
const LONG_FRAME_16_MS = 16.67;
const LONG_FRAME_33_MS = 33;
const TRACE_MARK_FIRST_FRAME_END_PREFIX = "perf-trace:first-frame-end:";
const TRACE_MARK_FINISH_PREFIX = "perf-trace:finish:";

export interface PerfFrame {
  tick: number;
  frameMs: number;
  gpuMs?: number;
  presentMs?: number;
  missiles: number;
  drones: number;
  interceptors: number;
  particles: number;
  explosions: number;
}

export interface PerfMetricSummary {
  avg: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
  total: number;
}

export interface PerfGpuProfile {
  captureMode: string;
  frameCount: number;
  gpuSummary: PerfMetricSummary;
  notes?: string[];
  presentSummary?: PerfMetricSummary;
  source: "chromium-trace";
}

export interface PerfSummary {
  p50: number;
  p95: number;
  p99: number;
  longFrameCount16: number;
  longFrameCount33: number;
}

export interface PerfDeviceInfo {
  ua: string;
  dpr: number;
  drawingBufferSize: {
    width: number;
    height: number;
  };
  screenSize: {
    width: number;
    height: number;
  };
  isCapacitor: boolean;
}

export interface PerfReport {
  schemaVersion: typeof PERF_REPORT_SCHEMA_VERSION;
  runId: string;
  buildId: string | null;
  replayId: string;
  replayUrl: string;
  autoquit: boolean;
  deviceInfo: PerfDeviceInfo;
  frames: PerfFrame[];
  // Populated post-hoc by the smoke script via Chromium trace merge; never set by PerfRecorder itself.
  gpuProfile?: PerfGpuProfile;
  summary: PerfSummary;
}

export interface PerfRecorderStartOptions {
  replayUrl: string;
  autoquit?: boolean;
  sink: PerfSink;
  replayId?: string;
  runId?: string;
  buildId?: string | null;
}

export interface PerfRecorderFrameSample {
  screen: string;
  replayActive: boolean;
  tick: number;
  frameMs: number;
  gpuMs?: number;
  missiles: number;
  drones: number;
  interceptors: number;
  particles: number;
  explosions: number;
}

interface PerfRecorderSession {
  buildId: string | null;
  replayId: string;
  replayUrl: string;
  autoquit: boolean;
  runId: string;
  sink: PerfSink;
  frames: PerfFrame[];
  emitted: boolean;
  firstFrameMarked: boolean;
}

interface PerfRecorderEnvironment {
  dpr: number;
  isCapacitor: boolean;
  makeRunId: () => string;
  screenHeight: number;
  screenWidth: number;
  userAgent: string;
}

function getGlobalCrypto(): Crypto | null {
  if (typeof globalThis === "undefined" || !("crypto" in globalThis)) return null;
  const value = globalThis.crypto;
  return value ?? null;
}

function createRunId(): string {
  const cryptoApi = getGlobalCrypto();
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const suffix = Math.random().toString(36).slice(2, 10);
  return `run-${Date.now().toString(36)}-${suffix}`;
}

function getDefaultEnvironment(): PerfRecorderEnvironment {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const ua = hasNavigator ? navigator.userAgent : "unknown";
  return {
    dpr: hasWindow && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1,
    isCapacitor: /\bCapacitor\b/i.test(ua),
    makeRunId: createRunId,
    screenHeight: hasWindow ? window.screen.height : 0,
    screenWidth: hasWindow ? window.screen.width : 0,
    userAgent: ua,
  };
}

function clampCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeTraceMark(name: string): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch {
    // Trace markers are best-effort only; perf capture should not fail because user-timing is unavailable.
  }
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;
  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex] ?? sortedValues[sortedValues.length - 1] ?? 0;
  const upperValue = sortedValues[upperIndex] ?? lowerValue;
  if (lowerIndex === upperIndex) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex);
}

export function deriveReplayId(replayUrl: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.href : "https://perf.invalid/";
    const url = new URL(replayUrl, base);
    const parts = url.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] ?? replayUrl;
    return lastPart.replace(/\.json$/i, "") || replayUrl;
  } catch {
    return replayUrl;
  }
}

export function summarizePerfFrames(frames: PerfFrame[]): PerfSummary {
  const frameValues = frames
    .map((frame) => frame.frameMs)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  return {
    p50: roundMetric(quantile(frameValues, 0.5)),
    p95: roundMetric(quantile(frameValues, 0.95)),
    p99: roundMetric(quantile(frameValues, 0.99)),
    longFrameCount16: frameValues.filter((value) => value > LONG_FRAME_16_MS).length,
    longFrameCount33: frameValues.filter((value) => value > LONG_FRAME_33_MS).length,
  };
}

export class PerfRecorder {
  private readonly canvas: Pick<HTMLCanvasElement, "width" | "height">;
  private readonly env: PerfRecorderEnvironment;
  private session: PerfRecorderSession | null = null;

  constructor(canvas: Pick<HTMLCanvasElement, "width" | "height">, env: Partial<PerfRecorderEnvironment> = {}) {
    this.canvas = canvas;
    this.env = {
      ...getDefaultEnvironment(),
      ...env,
    };
  }

  start(options: PerfRecorderStartOptions): { runId: string; replayId: string } {
    const replayId = options.replayId?.trim() || deriveReplayId(options.replayUrl);
    const runId = options.runId?.trim() || this.env.makeRunId();
    this.session = {
      autoquit: options.autoquit === true,
      buildId: options.buildId ?? null,
      emitted: false,
      frames: [],
      firstFrameMarked: false,
      replayId,
      replayUrl: options.replayUrl,
      runId,
      sink: options.sink,
    };
    return { runId, replayId };
  }

  onFrame(sample: PerfRecorderFrameSample): void {
    const session = this.session;
    if (!session || session.emitted) return;
    if (!sample.replayActive || sample.screen !== "playing") return;
    if (!Number.isFinite(sample.frameMs) || sample.frameMs < 0) return;
    if (!session.firstFrameMarked) {
      safeTraceMark(`${TRACE_MARK_FIRST_FRAME_END_PREFIX}${session.runId}`);
      session.firstFrameMarked = true;
    }

    const frame: PerfFrame = {
      drones: clampCount(sample.drones),
      explosions: clampCount(sample.explosions),
      frameMs: roundMetric(sample.frameMs),
      interceptors: clampCount(sample.interceptors),
      missiles: clampCount(sample.missiles),
      particles: clampCount(sample.particles),
      tick: clampCount(sample.tick),
    };

    if (Number.isFinite(sample.gpuMs) && sample.gpuMs !== undefined) {
      frame.gpuMs = roundMetric(sample.gpuMs);
    }

    session.frames.push(frame);
  }

  async onReplayFinish(): Promise<PerfReport | null> {
    const session = this.session;
    if (!session || session.emitted) return null;
    safeTraceMark(`${TRACE_MARK_FINISH_PREFIX}${session.runId}`);

    const report: PerfReport = {
      autoquit: session.autoquit,
      buildId: session.buildId,
      deviceInfo: this.getDeviceInfo(),
      frames: session.frames.map((frame) => ({ ...frame })),
      replayId: session.replayId,
      replayUrl: session.replayUrl,
      runId: session.runId,
      schemaVersion: PERF_REPORT_SCHEMA_VERSION,
      summary: summarizePerfFrames(session.frames),
    };

    await session.sink.emit(report);
    session.emitted = true;
    return report;
  }

  private getDeviceInfo(): PerfDeviceInfo {
    return {
      dpr: roundMetric(this.env.dpr),
      drawingBufferSize: {
        height: clampCount(this.canvas.height),
        width: clampCount(this.canvas.width),
      },
      isCapacitor: this.env.isCapacitor,
      screenSize: {
        height: clampCount(this.env.screenHeight),
        width: clampCount(this.env.screenWidth),
      },
      ua: this.env.userAgent,
    };
  }
}
