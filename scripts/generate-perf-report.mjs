#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { roundMetric, summarizeFrameMetric } from "./perf-utils.mjs";

function usage() {
  console.error("Usage: node scripts/generate-perf-report.mjs <report.json> [more reports...]");
  process.exitCode = 1;
}

function formatMs(value) {
  return `${Number(value)
    .toFixed(3)
    .replace(/\.?0+$/, "")} ms`;
}

function formatSeconds(valueMs) {
  return `${(Number(valueMs) / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
}

function formatInt(value) {
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function roundUp(value, step) {
  return Math.ceil(value / step) * step;
}

function toSafeId(value) {
  const safe = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "perf-report";
}

function stringifyForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("-->", "--\\>");
}

function buildTimelineDetail(report) {
  const allFrames = Array.isArray(report.frames) ? report.frames : [];
  const skippedFrames = 5;
  const frames = allFrames.slice(skippedFrames);
  const gpuSummary = summarizeFrameMetric(frames, "gpuMs") ?? report.gpuProfile?.gpuSummary;
  const presentSummary = summarizeFrameMetric(frames, "presentMs") ?? report.gpuProfile?.presentSummary;
  if (frames.length === 0) {
    return `<p class="detail-copy">No frame data captured for this report.</p>`;
  }

  const reportId = toSafeId(report.replayId);
  const width = 760;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 34, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const bottom = padding.top + plotHeight;
  const maxFrameMs = Math.max(...frames.map((frame) => Number(frame.frameMs) || 0), 0);
  const yMax = Math.max(70, maxFrameMs > 70 ? roundUp(maxFrameMs * 1.05, 10) : 70);
  const totalElapsedMs = frames.reduce((sum, frame) => sum + (Number(frame.frameMs) || 0), 0);
  const averageFrameMs = totalElapsedMs / frames.length;
  const peakFrameMs = maxFrameMs;
  const xGuides = [0, totalElapsedMs / 2, totalElapsedMs];
  const yGuides = [0, 16, 33, 70].filter((value) => value <= yMax);

  let elapsedMs = 0;
  const bars = [];
  const hoverFrames = [];

  frames.forEach((frame, index) => {
    const frameMs = Number(frame.frameMs) || 0;
    const startMs = elapsedMs;
    elapsedMs += frameMs;
    const endMs = elapsedMs;

    const rawX = padding.left + (totalElapsedMs > 0 ? (startMs / totalElapsedMs) * plotWidth : 0);
    const rawEndX = padding.left + (totalElapsedMs > 0 ? (endMs / totalElapsedMs) * plotWidth : plotWidth);
    const visualWidth = Math.max(rawEndX - rawX, 0.9);
    const visualX = Math.min(rawX, padding.left + plotWidth - visualWidth);
    const clampedHeight = Math.min(frameMs, yMax);
    const barY = padding.top + plotHeight - (clampedHeight / yMax) * plotHeight;
    const barHeight = Math.max(bottom - barY, 1);
    const barClass = frameMs > 33 ? " danger" : frameMs > 16 ? " warning" : "";

    bars.push(
      `<rect class="timeline-bar${barClass}" x="${visualX.toFixed(2)}" y="${barY.toFixed(2)}" width="${visualWidth.toFixed(
        2,
      )}" height="${barHeight.toFixed(2)}" rx="0.8"></rect>`,
    );

    hoverFrames.push({
      barHeight: roundMetric(barHeight),
      barWidth: roundMetric(visualWidth),
      barX: roundMetric(visualX),
      barY: roundMetric(barY),
      drones: frame.drones,
      endMs: roundMetric(endMs),
      explosions: frame.explosions,
      frameIndex: index + 1,
      frameMs: roundMetric(frameMs),
      gpuMs: Number.isFinite(frame.gpuMs) ? roundMetric(frame.gpuMs) : null,
      interceptors: frame.interceptors,
      missiles: frame.missiles,
      particles: frame.particles,
      presentMs: Number.isFinite(frame.presentMs) ? roundMetric(frame.presentMs) : null,
      startMs: roundMetric(startMs),
      tick: frame.tick,
    });
  });

  const timelineData = stringifyForScript({ frames: hoverFrames, replayId: report.replayId });

  return `
    <div class="detail-grid">
      <section class="detail-metric">
        <span class="label">Duration</span>
        <strong>${formatSeconds(totalElapsedMs)}</strong>
      </section>
      <section class="detail-metric">
        <span class="label">Avg Frame</span>
        <strong>${formatMs(averageFrameMs)}</strong>
      </section>
      <section class="detail-metric">
        <span class="label">Peak Frame</span>
        <strong>${formatMs(peakFrameMs)}</strong>
      </section>
      ${
        gpuSummary
          ? `<section class="detail-metric">
        <span class="label">GPU p95</span>
        <strong>${formatMs(gpuSummary.p95)}</strong>
      </section>`
          : ""
      }
      ${
        presentSummary
          ? `<section class="detail-metric">
        <span class="label">Present p95</span>
        <strong>${formatMs(presentSummary.p95)}</strong>
      </section>`
          : ""
      }
    </div>

    <p class="detail-copy">X axis is elapsed time. Y axis is frame time in milliseconds rising from the bottom. Hover a bar to inspect the frame in gruesome detail. The first ${skippedFrames} frames are ignored here to keep startup noise from fouling the view.</p>

    <div class="timeline-shell" data-report-id="${escapeHtml(reportId)}">
      <script type="application/json" class="timeline-data">${timelineData}</script>
      <div class="timeline-tooltip" hidden></div>
      <svg
        class="timeline-chart"
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label="Frame time bar chart for ${escapeHtml(report.replayId)}"
        data-plot-left="${padding.left}"
        data-plot-width="${plotWidth}"
        data-plot-top="${padding.top}"
        data-plot-height="${plotHeight}"
        data-plot-bottom="${bottom}"
        data-total-elapsed="${roundMetric(totalElapsedMs)}"
      >
        ${yGuides
          .map((value) => {
            const y = padding.top + plotHeight - (value / yMax) * plotHeight;
            const thresholdClass = value >= 33 ? " danger" : value >= 16 ? " warning" : "";
            return `
              <line class="timeline-guide${thresholdClass}" x1="${padding.left}" y1="${y.toFixed(2)}" x2="${padding.left + plotWidth}" y2="${y.toFixed(2)}"></line>
              <text class="timeline-label timeline-label-y" x="${padding.left - 8}" y="${(y + 4).toFixed(2)}">${value} ms</text>
            `;
          })
          .join("")}

        ${xGuides
          .map((value) => {
            const x = padding.left + (totalElapsedMs > 0 ? (value / totalElapsedMs) * plotWidth : 0);
            return `
              <line class="timeline-axis-tick" x1="${x.toFixed(2)}" y1="${bottom}" x2="${x.toFixed(2)}" y2="${(bottom + 6).toFixed(2)}"></line>
              <text class="timeline-label timeline-label-x" x="${x.toFixed(2)}" y="${(bottom + 22).toFixed(2)}">${escapeHtml(
                formatSeconds(value),
              )}</text>
            `;
          })
          .join("")}

        <line class="timeline-axis" x1="${padding.left}" y1="${bottom}" x2="${padding.left + plotWidth}" y2="${bottom}"></line>
        <line class="timeline-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${bottom}"></line>
        <g class="timeline-bars">${bars.join("")}</g>
        <rect class="timeline-hover" x="${padding.left}" y="${bottom - 1}" width="1" height="1" visibility="hidden"></rect>
      </svg>
    </div>
  `;
}

function buildCard(report) {
  const { replayId, buildId, summary, frames, deviceInfo } = report;
  const long16Ratio = frames.length > 0 ? (summary.longFrameCount16 / frames.length) * 100 : 0;
  const long33Ratio = frames.length > 0 ? (summary.longFrameCount33 / frames.length) * 100 : 0;
  const gpuSummary = summarizeFrameMetric(frames, "gpuMs") ?? report.gpuProfile?.gpuSummary;
  const presentSummary = summarizeFrameMetric(frames, "presentMs") ?? report.gpuProfile?.presentSummary;
  const gpuNotes = Array.isArray(report.gpuProfile?.notes) ? report.gpuProfile.notes.filter(Boolean) : [];

  return `
    <article class="card">
      <div class="card-header">
        <div>
          <p class="eyebrow">Replay</p>
          <h2>${escapeHtml(replayId)}</h2>
        </div>
        <div class="pill">${escapeHtml(buildId || "unknown build")}</div>
      </div>

      <div class="metrics-grid">
        <section class="metric">
          <span class="label">p50</span>
          <strong>${formatMs(summary.p50)}</strong>
        </section>
        <section class="metric">
          <span class="label">p95</span>
          <strong>${formatMs(summary.p95)}</strong>
        </section>
        <section class="metric">
          <span class="label">p99</span>
          <strong>${formatMs(summary.p99)}</strong>
        </section>
        <section class="metric">
          <span class="label">Frames</span>
          <strong>${formatInt(frames.length)}</strong>
        </section>
        ${
          gpuSummary
            ? `<section class="metric">
          <span class="label">GPU p95</span>
          <strong>${formatMs(gpuSummary.p95)}</strong>
        </section>`
            : ""
        }
        ${
          presentSummary
            ? `<section class="metric">
          <span class="label">Present p95</span>
          <strong>${formatMs(presentSummary.p95)}</strong>
        </section>`
            : ""
        }
      </div>

      <div class="bars">
        <div class="bar-row">
          <div class="bar-copy">
            <span>Long frames &gt; 16.67ms</span>
            <strong>${formatInt(summary.longFrameCount16)} (${long16Ratio.toFixed(1)}%)</strong>
          </div>
          <div class="bar-track"><div class="bar-fill amber" style="width:${Math.min(100, long16Ratio)}%"></div></div>
        </div>
        <div class="bar-row">
          <div class="bar-copy">
            <span>Long frames &gt; 33ms</span>
            <strong>${formatInt(summary.longFrameCount33)} (${long33Ratio.toFixed(1)}%)</strong>
          </div>
          <div class="bar-track"><div class="bar-fill red" style="width:${Math.min(100, long33Ratio)}%"></div></div>
        </div>
      </div>

      ${
        gpuSummary
          ? `<div class="gpu-note">
        <strong>GPU trace</strong>
        <span>${escapeHtml(
          gpuNotes[0] ||
            "Derived from Chromium trace pipeline stages. Treat it as compositor and GPU pipeline time, not a hardware timer-query readout.",
        )}</span>
      </div>`
          : ""
      }

      <dl class="meta">
        <div>
          <dt>Canvas</dt>
          <dd>${formatInt(deviceInfo.drawingBufferSize.width)} × ${formatInt(deviceInfo.drawingBufferSize.height)}</dd>
        </div>
        <div>
          <dt>Screen</dt>
          <dd>${formatInt(deviceInfo.screenSize.width)} × ${formatInt(deviceInfo.screenSize.height)}</dd>
        </div>
        <div>
          <dt>DPR</dt>
          <dd>${escapeHtml(deviceInfo.dpr)}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>${deviceInfo.isCapacitor ? "Capacitor" : "Browser"}</dd>
        </div>
      </dl>

      <details class="detail-panel">
        <summary>Detailed view</summary>
        ${buildTimelineDetail(report)}
      </details>

      <details class="detail-panel">
        <summary>User agent</summary>
        <pre>${escapeHtml(deviceInfo.ua)}</pre>
      </details>
    </article>
  `;
}

function buildRuntimeScript() {
  return `
    <script>
      (() => {
        const numberFormatter = new Intl.NumberFormat("en-US");

        function formatMs(value) {
          return Number.isFinite(value) ? \`\${Number(value).toFixed(3).replace(/\\.?0+$/, "")} ms\` : "n/a";
        }

        function formatSeconds(valueMs) {
          return Number.isFinite(valueMs) ? \`\${(Number(valueMs) / 1000).toFixed(2).replace(/\\.?0+$/, "")} s\` : "n/a";
        }

        function formatInt(value) {
          return Number.isFinite(value) ? numberFormatter.format(value) : "n/a";
        }

        function findFrameByElapsed(frames, elapsedMs) {
          let low = 0;
          let high = frames.length - 1;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const frame = frames[mid];
            if (elapsedMs < frame.startMs) {
              high = mid - 1;
            } else if (elapsedMs > frame.endMs) {
              low = mid + 1;
            } else {
              return frame;
            }
          }
          const fallbackIndex = Math.max(0, Math.min(frames.length - 1, low));
          return frames[fallbackIndex] || null;
        }

        function buildTooltipHtml(frame) {
          const presentRow = Number.isFinite(frame.presentMs)
            ? \`<div><span>Present</span><strong>\${formatMs(frame.presentMs)}</strong></div>\`
            : "";
          return [
            \`<div class="timeline-tooltip-title">Frame \${formatInt(frame.frameIndex)}</div>\`,
            '<div class="timeline-tooltip-grid">',
            \`<div><span>Tick</span><strong>\${formatInt(frame.tick)}</strong></div>\`,
            \`<div><span>Frame</span><strong>\${formatMs(frame.frameMs)}</strong></div>\`,
            \`<div><span>GPU</span><strong>\${formatMs(frame.gpuMs)}</strong></div>\`,
            presentRow,
            \`<div><span>Elapsed</span><strong>\${formatSeconds(frame.startMs)} → \${formatSeconds(frame.endMs)}</strong></div>\`,
            \`<div><span>Missiles</span><strong>\${formatInt(frame.missiles)}</strong></div>\`,
            \`<div><span>Drones</span><strong>\${formatInt(frame.drones)}</strong></div>\`,
            \`<div><span>Interceptors</span><strong>\${formatInt(frame.interceptors)}</strong></div>\`,
            \`<div><span>Particles</span><strong>\${formatInt(frame.particles)}</strong></div>\`,
            \`<div><span>Explosions</span><strong>\${formatInt(frame.explosions)}</strong></div>\`,
            '</div>',
          ].join("");
        }

        function positionTooltip(tooltip, clientX, clientY) {
          const margin = 16;
          const rect = tooltip.getBoundingClientRect();
          let left = clientX + margin;
          let top = clientY + margin;

          if (left + rect.width > window.innerWidth - margin) {
            left = clientX - rect.width - margin;
          }
          if (top + rect.height > window.innerHeight - margin) {
            top = clientY - rect.height - margin;
          }

          tooltip.style.left = \`\${Math.max(margin, left)}px\`;
          tooltip.style.top = \`\${Math.max(margin, top)}px\`;
        }

        document.querySelectorAll(".timeline-shell").forEach((shell) => {
          const svg = shell.querySelector(".timeline-chart");
          const tooltip = shell.querySelector(".timeline-tooltip");
          const hoverBar = shell.querySelector(".timeline-hover");
          const dataNode = shell.querySelector(".timeline-data");
          const detailPanel = shell.closest(".detail-panel");
          if (!svg || !tooltip || !hoverBar || !dataNode) return;
          if (tooltip.parentElement !== document.body) {
            document.body.appendChild(tooltip);
          }

          const payload = JSON.parse(dataNode.textContent || "{}");
          const frames = Array.isArray(payload.frames) ? payload.frames : [];
          if (frames.length === 0) return;

          const plotLeft = Number(svg.dataset.plotLeft || 0);
          const plotWidth = Number(svg.dataset.plotWidth || 1);
          const totalElapsed = Number(svg.dataset.totalElapsed || 0);
          const viewBoxWidth = svg.viewBox.baseVal.width || 760;

          function hideTooltip() {
            tooltip.hidden = true;
            hoverBar.setAttribute("visibility", "hidden");
          }

          function updateHover(clientX, clientY) {
            const rect = svg.getBoundingClientRect();
            const svgX = ((clientX - rect.left) / rect.width) * viewBoxWidth;
            const clampedX = Math.max(plotLeft, Math.min(plotLeft + plotWidth, svgX));
            const ratio = plotWidth > 0 ? (clampedX - plotLeft) / plotWidth : 0;
            const elapsedMs = Math.max(0, Math.min(totalElapsed, ratio * totalElapsed));
            const frame = findFrameByElapsed(frames, elapsedMs);
            if (!frame) {
              hideTooltip();
              return;
            }

            hoverBar.setAttribute("x", String(frame.barX));
            hoverBar.setAttribute("y", String(frame.barY));
            hoverBar.setAttribute("width", String(frame.barWidth));
            hoverBar.setAttribute("height", String(frame.barHeight));
            hoverBar.setAttribute("visibility", "visible");

            tooltip.innerHTML = buildTooltipHtml(frame);
            tooltip.hidden = false;
            positionTooltip(tooltip, clientX, clientY);
          }

          svg.addEventListener("pointermove", (event) => {
            updateHover(event.clientX, event.clientY);
          });
          svg.addEventListener("pointerenter", (event) => {
            updateHover(event.clientX, event.clientY);
          });
          svg.addEventListener("pointerleave", hideTooltip);
          detailPanel?.addEventListener("toggle", () => {
            if (!detailPanel.open) hideTooltip();
          });
          window.addEventListener("scroll", hideTooltip, { passive: true });
        });
      })();
    </script>
  `;
}

function buildHtml(reports, generatedAt, sourceFiles) {
  const buildIds = [...new Set(reports.map((report) => report.buildId).filter(Boolean))];
  const avgP95 =
    reports.length > 0 ? reports.reduce((sum, report) => sum + Number(report.summary.p95 || 0), 0) / reports.length : 0;
  const totalFrames = reports.reduce((sum, report) => sum + report.frames.length, 0);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Perf Report</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0f14;
        --panel: rgba(16, 25, 34, 0.84);
        --panel-border: rgba(133, 173, 201, 0.18);
        --text: #eef5fb;
        --muted: #8ea6b8;
        --cyan: #7fd7ff;
        --amber: #f5b65b;
        --red: #ef7a72;
        --green: #7ee7a8;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(49, 98, 135, 0.28), transparent 38%),
          linear-gradient(180deg, #0e1821 0%, var(--bg) 58%);
        color: var(--text);
        min-height: 100vh;
      }

      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 40px 0 56px;
      }

      .hero, .card {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        backdrop-filter: blur(12px);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.24);
      }

      .hero {
        border-radius: 28px;
        padding: 28px;
        margin-bottom: 24px;
      }

      .eyebrow {
        margin: 0 0 8px;
        color: var(--cyan);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      h1, h2, p {
        margin: 0;
      }

      h1 {
        font-size: clamp(32px, 6vw, 56px);
        line-height: 0.95;
        margin-bottom: 14px;
      }

      .lede {
        color: var(--muted);
        max-width: 70ch;
        line-height: 1.5;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin-top: 24px;
      }

      .summary-box, .metric {
        border-radius: 18px;
        padding: 16px 18px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .summary-box strong,
      .metric strong {
        display: block;
        font-size: 28px;
        margin-top: 8px;
      }

      .label {
        color: var(--muted);
        font-size: 13px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .report-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 18px;
      }

      .card {
        border-radius: 24px;
        padding: 22px;
      }

      .card-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }

      .card-header h2 {
        font-size: 28px;
        line-height: 1.05;
      }

      .pill {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 8px 12px;
        background: rgba(126, 231, 168, 0.1);
        border: 1px solid rgba(126, 231, 168, 0.22);
        color: var(--green);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }

      .bars {
        display: grid;
        gap: 14px;
        margin-bottom: 18px;
      }

      .gpu-note {
        display: grid;
        gap: 6px;
        margin: 0 0 18px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(127, 215, 255, 0.06);
        border: 1px solid rgba(127, 215, 255, 0.14);
      }

      .gpu-note strong {
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cyan);
      }

      .gpu-note span {
        color: var(--muted);
        line-height: 1.45;
      }

      .bar-row {
        display: grid;
        gap: 8px;
      }

      .bar-copy {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 14px;
      }

      .bar-copy strong {
        color: var(--text);
        font-size: 14px;
      }

      .bar-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        border-radius: inherit;
      }

      .bar-fill.amber {
        background: linear-gradient(90deg, rgba(245, 182, 91, 0.6), var(--amber));
      }

      .bar-fill.red {
        background: linear-gradient(90deg, rgba(239, 122, 114, 0.6), var(--red));
      }

      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px 18px;
        margin: 0 0 18px;
      }

      .meta div {
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .meta dt {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .meta dd {
        margin: 0;
        font-size: 15px;
      }

      .detail-panel {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 12px;
      }

      .detail-panel + .detail-panel {
        margin-top: 12px;
      }

      summary {
        cursor: pointer;
        color: var(--cyan);
        font-weight: 600;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-top: 14px;
      }

      .detail-metric {
        border-radius: 16px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .detail-metric strong {
        display: block;
        font-size: 20px;
        margin-top: 8px;
      }

      .detail-copy {
        margin-top: 14px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }

      .timeline-shell {
        position: relative;
        margin-top: 14px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow-x: auto;
      }

      .timeline-chart {
        display: block;
        width: 100%;
        min-width: 640px;
        height: auto;
        touch-action: none;
      }

      .timeline-axis,
      .timeline-axis-tick {
        stroke: rgba(238, 245, 251, 0.24);
        stroke-width: 1;
      }

      .timeline-guide {
        stroke: rgba(238, 245, 251, 0.08);
        stroke-width: 1;
        stroke-dasharray: 4 6;
      }

      .timeline-guide.warning {
        stroke: rgba(245, 182, 91, 0.4);
      }

      .timeline-guide.danger {
        stroke: rgba(239, 122, 114, 0.38);
      }

      .timeline-bar {
        fill: rgba(127, 215, 255, 0.62);
      }

      .timeline-bar.warning {
        fill: rgba(245, 182, 91, 0.82);
      }

      .timeline-bar.danger {
        fill: rgba(239, 122, 114, 0.86);
      }

      .timeline-hover {
        fill: rgba(255, 255, 255, 0.18);
        stroke: rgba(255, 255, 255, 0.95);
        stroke-width: 1;
        pointer-events: none;
      }

      .timeline-label {
        fill: var(--muted);
        font-family: "SFMono-Regular", Menlo, monospace;
        font-size: 11px;
      }

      .timeline-label-y {
        text-anchor: end;
      }

      .timeline-label-x {
        text-anchor: middle;
      }

      .timeline-tooltip {
        position: fixed;
        z-index: 999;
        width: min(248px, calc(100vw - 24px));
        padding: 10px 11px;
        border-radius: 12px;
        background: rgba(8, 14, 20, 0.96);
        border: 1px solid rgba(127, 215, 255, 0.24);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
        pointer-events: none;
      }

      .timeline-tooltip-title {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      .timeline-tooltip-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 8px;
      }

      .timeline-tooltip-grid div {
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .timeline-tooltip-grid span {
        display: block;
        color: var(--muted);
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 2px;
      }

      .timeline-tooltip-grid strong {
        display: block;
        font-size: 11px;
        line-height: 1.3;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--muted);
        margin: 12px 0 0;
        font-size: 13px;
        line-height: 1.5;
      }

      .footer {
        margin-top: 24px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      @media (max-width: 720px) {
        main {
          width: min(100vw - 20px, 1120px);
          padding-top: 20px;
        }

        .hero, .card {
          border-radius: 20px;
        }

        .metrics-grid,
        .meta,
        .timeline-tooltip-grid {
          grid-template-columns: 1fr;
        }

        .bar-copy {
          display: block;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Dubai Missile Command</p>
        <h1>Perf Report</h1>
        <p class="lede">
          Static summary generated from the latest single-wave benchmark runs. Mercifully short, unlike the old multi-wave replays.
        </p>

        <div class="summary-grid">
          <section class="summary-box">
            <span class="label">Reports</span>
            <strong>${formatInt(reports.length)}</strong>
          </section>
          <section class="summary-box">
            <span class="label">Avg p95</span>
            <strong>${formatMs(avgP95)}</strong>
          </section>
          <section class="summary-box">
            <span class="label">Total Frames</span>
            <strong>${formatInt(totalFrames)}</strong>
          </section>
          <section class="summary-box">
            <span class="label">Builds</span>
            <strong>${escapeHtml(buildIds.join(", ") || "unknown")}</strong>
          </section>
        </div>
      </section>

      <section class="report-grid">
        ${reports.map((report) => buildCard(report)).join("\n")}
      </section>

      <p class="footer">
        Generated ${escapeHtml(generatedAt)} from:
        ${sourceFiles.map((file) => `<code>${escapeHtml(file)}</code>`).join(", ")}
      </p>
    </main>
    ${buildRuntimeScript()}
  </body>
</html>
`;
}

async function main() {
  const reportFiles = process.argv.slice(2);
  if (reportFiles.length === 0) return usage();

  const reports = [];
  for (const file of reportFiles) {
    const absolute = path.resolve(process.cwd(), file);
    const raw = await readFile(absolute, "utf8");
    reports.push(JSON.parse(raw));
  }

  const publicDir = path.resolve(process.cwd(), "public");
  await mkdir(publicDir, { recursive: true });
  const outFile = path.join(publicDir, "perf-report.html");
  const html = buildHtml(reports, new Date().toISOString(), reportFiles);
  await writeFile(outFile, html, "utf8");
  console.log(path.relative(process.cwd(), outFile));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
