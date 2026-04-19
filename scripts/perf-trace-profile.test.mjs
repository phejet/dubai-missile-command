import { describe, expect, it } from "vitest";

import { applyGpuTraceProfile } from "./perf-trace-profile.mjs";

function makeFrame(frameMs, tick) {
  return {
    drones: 0,
    explosions: 0,
    frameMs,
    interceptors: 0,
    missiles: 0,
    particles: 0,
    tick,
  };
}

describe("applyGpuTraceProfile", () => {
  it("maps chromium pipeline stages onto perf report frames", () => {
    const report = {
      autoquit: true,
      buildId: null,
      deviceInfo: {
        dpr: 2,
        drawingBufferSize: { height: 1600, width: 900 },
        isCapacitor: false,
        screenSize: { height: 844, width: 390 },
        ua: "Unit Test Browser",
      },
      frames: [makeFrame(10, 1), makeFrame(20, 2)],
      replayId: "perf-wave1",
      replayUrl: "/replays/perf-wave1.json",
      runId: "run-123",
      schemaVersion: 1,
      summary: {
        longFrameCount16: 0,
        longFrameCount33: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      },
    };

    const traceEvents = [
      {
        cat: "blink.user_timing",
        name: "perf-trace:first-frame-end:run-123",
        ph: "I",
        ts: 10000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "StartDrawToSwapStart",
        ph: "X",
        ts: 1000,
        dur: 2000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "BufferAvailableToBufferReady",
        ph: "X",
        ts: 3000,
        dur: 1000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "BufferReadyToLatch",
        ph: "X",
        ts: 4000,
        dur: 2000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "LatchToSwapEnd",
        ph: "X",
        ts: 6000,
        dur: 1000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "SwapEndToPresentationCompositorFrame",
        ph: "X",
        ts: 7000,
        dur: 2000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "StartDrawToSwapStart",
        ph: "X",
        ts: 12000,
        dur: 3000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "BufferAvailableToBufferReady",
        ph: "X",
        ts: 15000,
        dur: 1000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "BufferReadyToLatch",
        ph: "X",
        ts: 16000,
        dur: 1000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "LatchToSwapEnd",
        ph: "X",
        ts: 17000,
        dur: 2000,
      },
      {
        cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame",
        name: "SwapEndToPresentationCompositorFrame",
        ph: "X",
        ts: 19000,
        dur: 3000,
      },
    ];

    const result = applyGpuTraceProfile(report, traceEvents);

    expect(result.applied).toBe(true);
    expect(report.frames[0]?.gpuMs).toBe(6);
    expect(report.frames[0]?.presentMs).toBe(2);
    expect(report.frames[1]?.gpuMs).toBe(7);
    expect(report.frames[1]?.presentMs).toBe(3);
    expect(report.gpuProfile).toMatchObject({
      captureMode: "chromium-headless",
      frameCount: 2,
      source: "chromium-trace",
      gpuSummary: {
        max: 7,
        p50: 6.5,
      },
      presentSummary: {
        max: 3,
        p50: 2.5,
      },
    });
  });

  it("refuses to apply when the alignment mark is missing", () => {
    const report = {
      frames: [makeFrame(16.7, 1)],
      runId: "run-404",
    };

    expect(applyGpuTraceProfile(report, [])).toEqual({
      applied: false,
      reason: "Trace payload does not contain events",
    });
  });
});
