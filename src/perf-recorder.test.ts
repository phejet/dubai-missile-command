import { describe, expect, it, vi } from "vitest";
import { parsePerfBootRequest, resolveReplayAssetUrl } from "./boot-game.js";
import { PerfRecorder, deriveReplayId, summarizePerfFrames } from "./perf-recorder.js";
import { ConsoleSink, HttpSink } from "./perf-sinks.js";
import type { PerfReport } from "./perf-recorder.js";

describe("PerfRecorder", () => {
  it("records replay gameplay frames and emits a schema-v1 report", async () => {
    const emit = vi.fn<(report: PerfReport) => Promise<void>>().mockResolvedValue(undefined);
    const recorder = new PerfRecorder(
      { width: 900, height: 1600 },
      {
        dpr: 3,
        isCapacitor: false,
        makeRunId: () => "run-fixed",
        screenHeight: 844,
        screenWidth: 390,
        userAgent: "Unit Test Browser",
      },
    );

    recorder.start({
      autoquit: true,
      replayUrl: "/replays/perf-wave1.json",
      sink: { emit },
    });

    recorder.onFrame({
      drones: 0,
      explosions: 1,
      frameMs: 10,
      interceptors: 1,
      missiles: 3,
      particles: 4,
      replayActive: false,
      screen: "playing",
      tick: 0,
    });
    recorder.onFrame({
      drones: 2,
      explosions: 3,
      frameMs: 16.8,
      interceptors: 1,
      missiles: 4,
      particles: 9,
      replayActive: true,
      screen: "playing",
      tick: 120,
    });
    recorder.onFrame({
      drones: 1,
      explosions: 2,
      frameMs: 33.4,
      interceptors: 2,
      missiles: 5,
      particles: 12,
      replayActive: true,
      screen: "playing",
      tick: 121,
    });

    const report = await recorder.onReplayFinish();

    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      autoquit: true,
      buildId: null,
      replayId: "perf-wave1",
      replayUrl: "/replays/perf-wave1.json",
      runId: "run-fixed",
      schemaVersion: 1,
      summary: {
        longFrameCount16: 2,
        longFrameCount33: 1,
        p50: 25.1,
      },
    });
    expect(report?.deviceInfo).toEqual({
      dpr: 3,
      drawingBufferSize: { height: 1600, width: 900 },
      isCapacitor: false,
      screenSize: { height: 844, width: 390 },
      ua: "Unit Test Browser",
    });
    expect(report?.frames).toHaveLength(2);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[0]).toEqual(report);
    await expect(recorder.onReplayFinish()).resolves.toBeNull();
  });
});

describe("perf helpers", () => {
  it("derives a replay id from a replay path", () => {
    expect(deriveReplayId("https://example.com/replays/perf-wave4-upgrades.json")).toBe("perf-wave4-upgrades");
  });

  it("summarizes frame timings with long-frame counts", () => {
    expect(
      summarizePerfFrames([
        { drones: 0, explosions: 0, frameMs: 8, interceptors: 0, missiles: 1, particles: 0, tick: 1 },
        { drones: 1, explosions: 1, frameMs: 20, interceptors: 0, missiles: 1, particles: 2, tick: 2 },
        { drones: 1, explosions: 1, frameMs: 40, interceptors: 1, missiles: 2, particles: 3, tick: 3 },
      ]),
    ).toEqual({
      longFrameCount16: 2,
      longFrameCount33: 1,
      p50: 20,
      p95: 38,
      p99: 39.6,
    });
  });
});

describe("perf sinks", () => {
  const report: PerfReport = {
    autoquit: false,
    buildId: null,
    deviceInfo: {
      dpr: 2,
      drawingBufferSize: { height: 1600, width: 900 },
      isCapacitor: false,
      screenSize: { height: 844, width: 390 },
      ua: "Test UA",
    },
    frames: [],
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

  it("ConsoleSink logs the report with the schema marker", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await new ConsoleSink().emit(report);
      expect(logSpy).toHaveBeenCalledWith("PERF_REPORT_V1", JSON.stringify(report));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("HttpSink posts JSON to the configured endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );

    await new HttpSink("/api/save-perf", fetchMock).emit(report);

    expect(fetchMock).toHaveBeenCalledWith("/api/save-perf", {
      body: JSON.stringify(report),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });
});

describe("parsePerfBootRequest", () => {
  it("returns a perf replay request when the query params are present", () => {
    expect(
      parsePerfBootRequest(
        "http://localhost:5173/dubai-missile-command/?perf=1&replay=/replays/perf-wave1.json&autoquit=1&runId=bench-7",
      ),
    ).toEqual({
      autoquit: true,
      replayUrl: "/replays/perf-wave1.json",
      runId: "bench-7",
      sinkUrl: undefined,
    });
  });

  it("ignores non-perf boots and malformed perf requests", () => {
    expect(parsePerfBootRequest("http://localhost:5173/dubai-missile-command/")).toBeNull();
    expect(parsePerfBootRequest("http://localhost:5173/dubai-missile-command/?perf=1")).toBeNull();
  });
});

describe("resolveReplayAssetUrl", () => {
  it("resolves root-style replay paths against the app base path", () => {
    expect(
      resolveReplayAssetUrl(
        "/replays/perf-wave1.json",
        "http://localhost:5173/dubai-missile-command/?perf=1",
        "/dubai-missile-command/",
      ),
    ).toBe("http://localhost:5173/dubai-missile-command/replays/perf-wave1.json");
  });
});
