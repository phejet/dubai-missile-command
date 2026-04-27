#!/usr/bin/env node
// Generates a self-contained HTML dashboard from one or more perf reports.
// Usage:
//   node scripts/perf-dashboard.mjs <report.json> [<report.json> ...] [--out path.html] [--label name=path ...]
// If --label name=path is given the matching report uses that label; otherwise label = buildId/replayId.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let outPath = "perf-results/dashboard.html";
const labelOverrides = new Map();
const inputs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out") {
    outPath = args[++i];
  } else if (a === "--label") {
    const [name, path] = (args[++i] ?? "").split("=");
    if (!name || !path) {
      console.error("--label expects name=path");
      process.exit(1);
    }
    labelOverrides.set(resolve(path), name);
  } else if (a.startsWith("--")) {
    console.error(`unknown flag: ${a}`);
    process.exit(1);
  } else {
    inputs.push(a);
  }
}

if (inputs.length === 0) {
  console.error("usage: perf-dashboard.mjs <report.json> [...] [--out file.html] [--label name=path]");
  process.exit(1);
}

const series = inputs.map((path) => {
  const abs = resolve(path);
  const raw = JSON.parse(readFileSync(abs, "utf8"));
  const label = labelOverrides.get(abs) ?? `${raw.replayId ?? "?"} · ${raw.buildId ?? "?"}`;
  return {
    label,
    path,
    buildId: raw.buildId,
    replayId: raw.replayId,
    runId: raw.runId,
    summary: raw.summary,
    deviceInfo: raw.deviceInfo,
    savedAt: raw._savedAt,
    frames: raw.frames.map((f) => ({
      tick: f.tick,
      frameMs: f.frameMs,
      missiles: f.missiles,
      drones: f.drones,
      interceptors: f.interceptors,
      particles: f.particles,
      explosions: f.explosions,
    })),
  };
});

const palette = ["#4ea1ff", "#ff8a3d", "#7ddc7d", "#e36ad9", "#ffd24e", "#9ae8d6"];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Dubai Missile Command — Perf Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #0f1620; color: #e6e9ef; }
  h1 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0.04em; text-transform: uppercase; }
  h2 { margin: 32px 0 8px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: #9aa6b8; }
  .meta { color: #9aa6b8; font-size: 12px; margin-bottom: 16px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); margin-bottom: 16px; }
  .card { background: #1a2230; border: 1px solid #2a3344; border-radius: 12px; padding: 16px; }
  .card .label { font-weight: 600; margin-bottom: 8px; }
  .card .row { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; padding: 2px 0; color: #c8cdd6; }
  .card .row .k { color: #8995a8; }
  .chart-wrap { background: #1a2230; border: 1px solid #2a3344; border-radius: 12px; padding: 12px; margin-bottom: 16px; }
  .chart-wrap canvas { width: 100% !important; height: 320px !important; }
  .controls { margin: 8px 0 16px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; color: #c8cdd6; font-size: 13px; }
  .controls label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  code { background: #0f1620; padding: 1px 6px; border-radius: 4px; color: #ffd9a0; }
</style>
</head>
<body>
<h1>Perf Dashboard</h1>
<div class="meta">${series.length} report${series.length === 1 ? "" : "s"} · generated ${new Date().toISOString()}</div>

<h2>Summary</h2>
<div class="grid">
${series
  .map((s, i) => {
    const c = palette[i % palette.length];
    const long16 = s.summary?.longFrameCount16 ?? 0;
    const long33 = s.summary?.longFrameCount33 ?? 0;
    return `<div class="card" style="border-left: 4px solid ${c};">
  <div class="label">${escapeHtml(s.label)}</div>
  <div class="row"><span class="k">replay</span><span>${escapeHtml(s.replayId ?? "")}</span></div>
  <div class="row"><span class="k">build</span><span>${escapeHtml(s.buildId ?? "")}</span></div>
  <div class="row"><span class="k">frames</span><span>${s.frames.length}</span></div>
  <div class="row"><span class="k">p50 / p95 / p99</span><span>${fmtMs(s.summary?.p50)} / ${fmtMs(s.summary?.p95)} / ${fmtMs(s.summary?.p99)}</span></div>
  <div class="row"><span class="k">long &gt;16ms / &gt;33ms</span><span>${long16} / ${long33}</span></div>
  <div class="row"><span class="k">device</span><span>${escapeHtml(shortUa(s.deviceInfo?.ua))}</span></div>
</div>`;
  })
  .join("\n")}
</div>

<h2>Frame time over replay</h2>
<div class="controls">
  <label><input type="checkbox" id="smooth" checked /> Smooth (rolling mean window)</label>
  <label>window <input type="number" id="window" value="15" min="1" max="120" style="width:60px;background:#0f1620;color:#e6e9ef;border:1px solid #2a3344;border-radius:4px;padding:2px 6px;" /></label>
  <label><input type="checkbox" id="logy" /> Log Y axis</label>
</div>
<div class="chart-wrap"><canvas id="frameChart"></canvas></div>

<h2>Entity load over replay</h2>
<div class="chart-wrap"><canvas id="entityChart"></canvas></div>

<script>
const SERIES = ${JSON.stringify(series)};
const PALETTE = ${JSON.stringify(palette)};

function rollingMean(values, window) {
  if (window <= 1) return values.slice();
  const out = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

const frameCtx = document.getElementById("frameChart").getContext("2d");
const entityCtx = document.getElementById("entityChart").getContext("2d");

function buildFrameDatasets(window) {
  return SERIES.map((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const ms = s.frames.map((f) => f.frameMs);
    const smoothed = rollingMean(ms, window);
    return {
      label: s.label,
      data: s.frames.map((f, idx) => ({ x: f.tick, y: smoothed[idx] })),
      borderColor: color,
      backgroundColor: color + "33",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
    };
  });
}

const frameChart = new Chart(frameCtx, {
  type: "line",
  data: { datasets: buildFrameDatasets(15) },
  options: {
    animation: false,
    parsing: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    scales: {
      x: { type: "linear", title: { display: true, text: "tick", color: "#9aa6b8" }, ticks: { color: "#9aa6b8" }, grid: { color: "#2a3344" } },
      y: { title: { display: true, text: "frame ms", color: "#9aa6b8" }, ticks: { color: "#9aa6b8" }, grid: { color: "#2a3344" } },
    },
    plugins: {
      legend: { labels: { color: "#e6e9ef" } },
      tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + ctx.parsed.y.toFixed(2) + "ms" } },
    },
  },
});

// 16.67ms (60Hz) and 33.33ms (30Hz) annotation lines via custom plugin
const refLines = {
  id: "refLines",
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    [
      { y: 16.67, color: "#7ddc7d", label: "60Hz" },
      { y: 33.33, color: "#ff8a3d", label: "30Hz" },
    ].forEach(({ y, color, label }) => {
      const yPx = scales.y.getPixelForValue(y);
      if (yPx < chartArea.top || yPx > chartArea.bottom) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPx);
      ctx.lineTo(chartArea.right, yPx);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      ctx.fillText(label, chartArea.right - 30, yPx - 3);
      ctx.restore();
    });
  },
};
Chart.register(refLines);
frameChart.update();

const ENTITY_KEYS = ["missiles", "drones", "interceptors", "particles", "explosions"];
const ENTITY_COLORS = { missiles: "#ff8a3d", drones: "#e36ad9", interceptors: "#4ea1ff", particles: "#9aa6b8", explosions: "#ffd24e" };

function buildEntityDatasets() {
  // Use first series only for entity counts (replay is deterministic — counts match across runs)
  const s = SERIES[0];
  return ENTITY_KEYS.map((key) => ({
    label: key,
    data: s.frames.map((f) => ({ x: f.tick, y: f[key] })),
    borderColor: ENTITY_COLORS[key],
    backgroundColor: ENTITY_COLORS[key] + "33",
    borderWidth: 1,
    pointRadius: 0,
    tension: 0,
  }));
}

new Chart(entityCtx, {
  type: "line",
  data: { datasets: buildEntityDatasets() },
  options: {
    animation: false,
    parsing: false,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { type: "linear", title: { display: true, text: "tick", color: "#9aa6b8" }, ticks: { color: "#9aa6b8" }, grid: { color: "#2a3344" } },
      y: { title: { display: true, text: "count (" + SERIES[0].label + ")", color: "#9aa6b8" }, ticks: { color: "#9aa6b8" }, grid: { color: "#2a3344" } },
    },
    plugins: { legend: { labels: { color: "#e6e9ef" } } },
  },
});

document.getElementById("smooth").addEventListener("change", refresh);
document.getElementById("window").addEventListener("input", refresh);
document.getElementById("logy").addEventListener("change", () => {
  frameChart.options.scales.y.type = document.getElementById("logy").checked ? "logarithmic" : "linear";
  frameChart.update();
});
function refresh() {
  const w = document.getElementById("smooth").checked ? Math.max(1, parseInt(document.getElementById("window").value, 10) || 1) : 1;
  frameChart.data.datasets = buildFrameDatasets(w);
  frameChart.update();
}
</script>
</body>
</html>`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${series.length} series, ${series.reduce((n, s) => n + s.frames.length, 0)} frames)`);

function fmtMs(v) {
  return typeof v === "number" ? v.toFixed(2) + "ms" : "—";
}
function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
function shortUa(ua) {
  if (!ua) return "";
  const m = ua.match(/iPhone|iPad|Mac OS X|Chrome\/[\d.]+|Safari\/[\d.]+/g);
  return m ? m.slice(0, 2).join(" · ") : ua.slice(0, 60);
}
