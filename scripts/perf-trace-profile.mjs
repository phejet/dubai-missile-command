const TRACE_MARK_FIRST_FRAME_END_PREFIX = "perf-trace:first-frame-end:";
const DRAW_PIPELINE_STAGE_NAMES = [
  "StartDrawToSwapStart",
  "BufferAvailableToBufferReady",
  "BufferReadyToLatch",
  "LatchToSwapEnd",
];
const PRESENT_STAGE_NAME = "SwapEndToPresentationCompositorFrame";
const PIPELINE_STAGE_NAMES = [...DRAW_PIPELINE_STAGE_NAMES, PRESENT_STAGE_NAME];

function roundMetric(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function quantile(sortedValues, percentile) {
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

function summarizeMetric(values) {
  const normalized = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  return {
    avg: roundMetric(normalized.reduce((sum, value) => sum + value, 0) / Math.max(1, normalized.length)),
    max: roundMetric(normalized[normalized.length - 1] ?? 0),
    p50: roundMetric(quantile(normalized, 0.5)),
    p95: roundMetric(quantile(normalized, 0.95)),
    p99: roundMetric(quantile(normalized, 0.99)),
    samples: normalized.length,
    total: roundMetric(normalized.reduce((sum, value) => sum + value, 0)),
  };
}

function getTraceLocalId(event) {
  if (event?.id2 && typeof event.id2 === "object" && typeof event.id2.local === "string") return event.id2.local;
  if (typeof event?.id === "string" || typeof event?.id === "number") return String(event.id);
  return "no-id";
}

function buildTraceEventKey(event) {
  return `${String(event.pid)}:${String(event.tid)}:${String(event.name)}:${getTraceLocalId(event)}`;
}

function collectNamedIntervals(traceEvents, names) {
  const wantedNames = new Set(names);
  const intervalsByName = new Map(names.map((name) => [name, []]));
  const beginStacks = new Map();

  for (const event of traceEvents) {
    if (!event || !wantedNames.has(event.name)) continue;
    const startTs = Number(event.ts);
    if (!Number.isFinite(startTs)) continue;

    if (event.ph === "X") {
      const durationUs = Number(event.dur);
      if (!Number.isFinite(durationUs) || durationUs < 0) continue;
      intervalsByName.get(event.name)?.push({
        endTs: startTs + durationUs,
        startTs,
      });
      continue;
    }

    const key = buildTraceEventKey(event);
    if (event.ph === "b") {
      if (!beginStacks.has(key)) beginStacks.set(key, []);
      beginStacks.get(key)?.push(startTs);
      continue;
    }

    if (event.ph !== "e") continue;
    const stack = beginStacks.get(key);
    const beginTs = stack?.pop();
    if (!Number.isFinite(beginTs)) continue;
    intervalsByName.get(event.name)?.push({
      endTs: startTs,
      startTs: beginTs,
    });
  }

  return intervalsByName;
}

function findUserTimingMarkTs(traceEvents, name) {
  for (const event of traceEvents) {
    if (!event || event.name !== name) continue;
    if (!String(event.cat || "").includes("blink.user_timing")) continue;
    if (event.ph !== "I" && event.ph !== "R") continue;
    const ts = Number(event.ts);
    if (Number.isFinite(ts)) return ts;
  }
  return null;
}

function sumOverlapMs(intervals, rangeStartTs, rangeEndTs) {
  let totalUs = 0;
  for (const interval of intervals) {
    const overlapStart = Math.max(rangeStartTs, interval.startTs);
    const overlapEnd = Math.min(rangeEndTs, interval.endTs);
    if (overlapEnd <= overlapStart) continue;
    totalUs += overlapEnd - overlapStart;
  }
  return totalUs / 1000;
}

function buildFrameWindows(frames, firstFrameEndTs) {
  if (frames.length === 0) return [];
  const firstFrameMs = Number(frames[0]?.frameMs) || 0;
  let cursorTs = firstFrameEndTs - firstFrameMs * 1000;
  return frames.map((frame) => {
    const frameMs = Number(frame.frameMs) || 0;
    const startTs = cursorTs;
    const endTs = startTs + frameMs * 1000;
    cursorTs = endTs;
    return {
      endTs,
      startTs,
    };
  });
}

export function applyGpuTraceProfile(report, traceEvents, options = {}) {
  if (!report || typeof report !== "object" || !Array.isArray(report.frames) || report.frames.length === 0) {
    return { applied: false, reason: "Perf report does not contain frame data" };
  }
  if (!Array.isArray(traceEvents) || traceEvents.length === 0) {
    return { applied: false, reason: "Trace payload does not contain events" };
  }
  if (typeof report.runId !== "string" || !report.runId.trim()) {
    return { applied: false, reason: "Perf report is missing runId" };
  }

  const firstFrameEndTs = findUserTimingMarkTs(traceEvents, `${TRACE_MARK_FIRST_FRAME_END_PREFIX}${report.runId}`);
  if (!Number.isFinite(firstFrameEndTs)) {
    return { applied: false, reason: "Trace is missing the first-frame marker required for alignment" };
  }

  const frameWindows = buildFrameWindows(report.frames, firstFrameEndTs);
  const intervalsByName = collectNamedIntervals(traceEvents, PIPELINE_STAGE_NAMES);
  const hasNativeGpuValues = report.frames.some((frame) => Number.isFinite(frame?.gpuMs));

  const gpuValues = [];
  const presentValues = [];
  for (const [index, frame] of report.frames.entries()) {
    const window = frameWindows[index];
    if (!window) continue;

    let gpuMs = 0;
    for (const stageName of DRAW_PIPELINE_STAGE_NAMES) {
      gpuMs += sumOverlapMs(intervalsByName.get(stageName) ?? [], window.startTs, window.endTs);
    }
    const presentMs = sumOverlapMs(intervalsByName.get(PRESENT_STAGE_NAME) ?? [], window.startTs, window.endTs);

    const derivedGpuMs = roundMetric(gpuMs);
    if (!hasNativeGpuValues) {
      frame.gpuMs = derivedGpuMs;
    }
    frame.presentMs = roundMetric(presentMs);
    gpuValues.push(Number.isFinite(frame.gpuMs) ? frame.gpuMs : derivedGpuMs);
    presentValues.push(frame.presentMs);
  }

  report.gpuProfile = {
    captureMode: options.captureMode || "chromium-headless",
    frameCount: report.frames.length,
    gpuSummary: summarizeMetric(gpuValues),
    notes: [
      hasNativeGpuValues
        ? "gpuMs came from the report payload; the Chromium trace path only added presentMs and trace summaries."
        : "gpuMs is derived from Chromium trace pipeline stages from draw start through swap end.",
      "presentMs is swap-end to compositor presentation latency, captured from the same trace window.",
    ],
    presentSummary: summarizeMetric(presentValues),
    source: "chromium-trace",
  };

  return {
    applied: true,
    gpuProfile: report.gpuProfile,
  };
}
