import { Capacitor } from "@capacitor/core";
import { CANVAS_H } from "./game-logic";
import { preloadCanvasRenderResources } from "./canvas-render-resources";
import { Game } from "./game";
import { CanvasGameRenderer } from "./game-render";
import type { GameRenderer, GameScreen } from "./game-renderer";
import { PixiRenderer } from "./pixi-render";
import { PerfRecorder } from "./perf-recorder";
import type { PerfReport } from "./perf-recorder";
import { ConsoleSink, HttpSink, type PerfSink } from "./perf-sinks";
import type { ReplayData } from "./types";

export type RendererMode = "canvas2d" | "pixi";

interface BootGameOptions {
  mode?: RendererMode;
  launchUrl?: string;
}

interface PerfBootRequest {
  autoquit: boolean;
  replayUrl: string;
  runId?: string;
  sinkUrl?: string;
}

interface QueuedPerfRequest extends PerfBootRequest {
  requestKey: string;
}

interface PerfCommandPayload {
  autoquit?: boolean;
  commandId: string;
  perfSink?: string;
  replay: string;
  runId?: string;
}

interface PerfStatusBanner {
  set(message: string, state?: "running" | "done" | "error", details?: string): void;
}

export interface BootGameRuntime {
  game: Game;
  handleLaunchUrl(launchUrl: string): Promise<boolean>;
}

interface PerfHarness {
  banner: PerfStatusBanner;
  recorder: PerfRecorder;
}

type RenderModeControls = {
  isGameplayRenderLive(): boolean;
  isTitleRenderLive(): boolean;
  toggleGameplayRenderMode(): void;
  toggleTitleRenderMode(): void;
};

const PHONE_PORTRAIT_LAYOUT_PROFILE = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: true,
  externalGameOver: true,
  crosshairFillRadius: 22,
  crosshairOuterRadius: 16,
  crosshairInnerRadius: 18,
  crosshairGap: 9,
  crosshairArmLength: 24,
  mirvWarningFontSize: 24,
  mirvWarningY: 86,
  purchaseToastFontSize: 28,
  purchaseToastY: CANVAS_H * 0.38,
  lowAmmoFontSize: 34,
  lowAmmoY: CANVAS_H * 0.42,
  waveClearedY: CANVAS_H * 0.5,
  multiKillLabelSize: 28,
  multiKillBonusSize: 20,
  buildingScale: 2,
  burjScale: 2,
  launcherScale: 3,
  enemyScale: 3,
  projectileScale: 2,
  effectScale: 2,
  planeScale: 3,
};
const DEFAULT_PERF_SINK_URL = "/api/save-perf";
const PERF_COMMAND_POLL_MS = 1200;
const PERF_LAST_HANDLED_REQUEST_KEY_STORAGE = "dmc:perf-last-handled-request-key";
const DEFAULT_RENDERER_MODE = parseRendererMode(import.meta.env.VITE_RENDERER_MODE);
const ENABLE_PIXI_SCAFFOLD = isTruthyQueryValue(
  (import.meta.env.VITE_ENABLE_PIXI_SCAFFOLD as string | undefined) ?? null,
);

export function parseRendererMode(value: unknown): RendererMode {
  return value === "pixi" ? "pixi" : "canvas2d";
}

function hasRenderModeControls(renderer: GameRenderer): renderer is GameRenderer & RenderModeControls {
  return (
    typeof (renderer as Partial<RenderModeControls>).isGameplayRenderLive === "function" &&
    typeof (renderer as Partial<RenderModeControls>).isTitleRenderLive === "function" &&
    typeof (renderer as Partial<RenderModeControls>).toggleGameplayRenderMode === "function" &&
    typeof (renderer as Partial<RenderModeControls>).toggleTitleRenderMode === "function"
  );
}

function ensurePixiScaffoldCanvas(): HTMLCanvasElement | null {
  const existingCanvas = document.getElementById("game-canvas-pixi");
  if (existingCanvas instanceof HTMLCanvasElement) return existingCanvas;

  const stage = document.querySelector(".battlefield-stage");
  if (!(stage instanceof HTMLElement)) return null;

  const scaffoldCanvas = document.createElement("canvas");
  scaffoldCanvas.id = "game-canvas-pixi";
  scaffoldCanvas.className = "game-canvas game-canvas--pixi-scaffold";
  scaffoldCanvas.width = 900;
  scaffoldCanvas.height = 1600;
  scaffoldCanvas.setAttribute("aria-hidden", "true");
  scaffoldCanvas.hidden = true;
  stage.insertBefore(scaffoldCanvas, stage.children[1] ?? null);
  return scaffoldCanvas;
}

function isTruthyQueryValue(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function isPerfDeepLink(url: URL): boolean {
  if (url.protocol !== "dubaimissile:") return false;
  const route = `${url.host}${url.pathname}`.replace(/^\/+|\/+$/g, "");
  return route === "perf";
}

function normalizePerfReplayUrl(replayUrl: string): string {
  const trimmed = replayUrl.trim();
  if (!trimmed) return trimmed;

  try {
    return new URL(trimmed).toString();
  } catch {
    if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
      return trimmed;
    }
    if (trimmed.includes("/")) {
      return `/${trimmed.replace(/^\/+/, "")}`;
    }
    return `/replays/${trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`}`;
  }
}

function readLastHandledPerfRequestKey(): string | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  try {
    return window.localStorage.getItem(PERF_LAST_HANDLED_REQUEST_KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeLastHandledPerfRequestKey(requestKey: string): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(PERF_LAST_HANDLED_REQUEST_KEY_STORAGE, requestKey);
  } catch {
    // Ignore storage failures; perf command handling should still work for the current session.
  }
}

function buildPerfRequestKey(perfRequest: PerfBootRequest, fallback: string): string {
  const runId = perfRequest.runId?.trim();
  if (runId) return runId;
  return fallback;
}

export function parsePerfBootRequest(locationHref: string): PerfBootRequest | null {
  let url: URL;
  try {
    url = new URL(locationHref);
  } catch {
    return null;
  }

  if (!isPerfDeepLink(url) && !isTruthyQueryValue(url.searchParams.get("perf"))) return null;
  const replayUrl = normalizePerfReplayUrl(url.searchParams.get("replay")?.trim() || "");
  if (!replayUrl) return null;

  return {
    autoquit: isTruthyQueryValue(url.searchParams.get("autoquit")),
    replayUrl,
    runId: url.searchParams.get("runId")?.trim() || undefined,
    sinkUrl: url.searchParams.get("perfSink")?.trim() || undefined,
  };
}

export function parsePerfCommandPayload(payload: unknown): (PerfBootRequest & { commandId: string }) | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Partial<Record<keyof PerfCommandPayload, unknown>>;
  if (typeof record.commandId !== "string" || !record.commandId.trim()) return null;
  if (typeof record.replay !== "string" || !record.replay.trim()) return null;

  const autoquit =
    typeof record.autoquit === "boolean"
      ? record.autoquit
      : typeof record.autoquit === "string"
        ? isTruthyQueryValue(record.autoquit)
        : false;
  const replayUrl = normalizePerfReplayUrl(record.replay);
  if (!replayUrl) return null;

  return {
    autoquit,
    commandId: record.commandId.trim(),
    replayUrl,
    runId: typeof record.runId === "string" && record.runId.trim() ? record.runId.trim() : undefined,
    sinkUrl: typeof record.perfSink === "string" && record.perfSink.trim() ? record.perfSink.trim() : undefined,
  };
}

export function resolveReplayAssetUrl(
  replayUrl: string,
  locationHref: string,
  basePath: string = import.meta.env.BASE_URL,
): string {
  const trimmed = normalizePerfReplayUrl(replayUrl);
  if (!trimmed) return trimmed;
  try {
    return new URL(trimmed).toString();
  } catch {
    const appBase = new URL(basePath, locationHref);
    if (trimmed.startsWith("/")) {
      return new URL(trimmed.slice(1), appBase).toString();
    }
    return new URL(trimmed, appBase).toString();
  }
}

function createPerfStatusBanner(): PerfStatusBanner {
  const banner = document.createElement("div");
  const headline = document.createElement("div");
  const details = document.createElement("div");
  banner.id = "perf-status-banner";
  Object.assign(banner.style, {
    background: "rgba(12, 18, 28, 0.88)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "18px",
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.28)",
    color: "#f4efe2",
    font: "600 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: "0.06em",
    maxWidth: "min(78vw, 360px)",
    padding: "12px 16px",
    position: "fixed",
    right: "20px",
    top: "20px",
    zIndex: "1000",
  });
  Object.assign(headline.style, {
    textTransform: "uppercase",
  });
  Object.assign(details.style, {
    fontSize: "11px",
    letterSpacing: "0.03em",
    lineHeight: "1.45",
    marginTop: "6px",
    opacity: "0.88",
    textTransform: "none",
    whiteSpace: "pre-wrap",
  });
  details.hidden = true;
  banner.append(headline, details);
  document.body.appendChild(banner);

  return {
    set(message, state = "running", detailText = "") {
      headline.textContent = message;
      details.textContent = detailText;
      details.hidden = !detailText;
      banner.style.background =
        state === "done"
          ? "rgba(26, 94, 52, 0.92)"
          : state === "error"
            ? "rgba(138, 33, 25, 0.94)"
            : "rgba(12, 18, 28, 0.88)";
      banner.style.borderColor =
        state === "done"
          ? "rgba(112, 221, 148, 0.4)"
          : state === "error"
            ? "rgba(255, 152, 136, 0.45)"
            : "rgba(255, 255, 255, 0.18)";
    },
  };
}

function getReplayIdFromData(replayData: ReplayData): string | undefined {
  const maybeReplayId = (replayData as ReplayData & { replayId?: unknown }).replayId;
  if (typeof maybeReplayId !== "string") return undefined;
  const replayId = maybeReplayId.trim();
  return replayId || undefined;
}

function formatPerfReportSummary(report: PerfReport): string {
  return [
    `run ${report.runId}`,
    `p50 ${report.summary.p50.toFixed(1)}ms  p95 ${report.summary.p95.toFixed(1)}ms  p99 ${report.summary.p99.toFixed(1)}ms`,
    `long >16ms ${report.summary.longFrameCount16}  >33ms ${report.summary.longFrameCount33}`,
  ].join("\n");
}

function resolvePerfSink(request: PerfBootRequest): PerfSink {
  if (!request.sinkUrl) return new HttpSink(DEFAULT_PERF_SINK_URL);
  if (request.sinkUrl.toLowerCase() === "console") return new ConsoleSink();
  return new HttpSink(request.sinkUrl);
}

async function fetchReplayData(replayUrl: string): Promise<ReplayData> {
  const response = await fetch(resolveReplayAssetUrl(replayUrl, window.location.href));
  if (!response.ok) {
    throw new Error(`Replay fetch failed: ${response.status} ${response.statusText}`);
  }

  const replayData = (await response.json()) as ReplayData;
  if (typeof replayData.seed !== "number" || !Array.isArray(replayData.actions)) {
    throw new Error("Replay payload is not valid ReplayData");
  }

  return replayData;
}

export function bootGame({ mode = DEFAULT_RENDERER_MODE, launchUrl }: BootGameOptions = {}): BootGameRuntime {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
  const pixiScaffoldCanvas = ENABLE_PIXI_SCAFFOLD ? ensurePixiScaffoldCanvas() : null;
  const titleRenderModeButton = document.getElementById("title-render-mode-button") as HTMLButtonElement | null;
  const gameplayRenderModeButton = document.getElementById("option-render") as HTMLButtonElement | null;
  const gameplayRenderModeMeta = document.getElementById("option-render-meta") as HTMLElement | null;

  if (!canvas || !titleRenderModeButton || !gameplayRenderModeButton || !gameplayRenderModeMeta) {
    throw new Error("Missing runtime DOM nodes required to boot the game");
  }

  preloadCanvasRenderResources();
  let perfHarness: PerfHarness | null = null;
  let activePerfRequest: QueuedPerfRequest | null = null;
  let queuedPerfRequest: QueuedPerfRequest | null = null;
  let lastHandledPerfRequestKey = readLastHandledPerfRequestKey();

  if (pixiScaffoldCanvas) {
    pixiScaffoldCanvas.hidden = true;
  }

  const renderer: GameRenderer = (() => {
    switch (mode) {
      case "pixi":
        return new PixiRenderer(canvas);
      case "canvas2d":
      default:
        return new CanvasGameRenderer({ canvas, layoutProfile: PHONE_PORTRAIT_LAYOUT_PROFILE });
    }
  })();

  let screen: GameScreen = "title";

  const syncRenderModeUi = () => {
    if (!hasRenderModeControls(renderer)) {
      titleRenderModeButton.hidden = true;
      gameplayRenderModeButton.hidden = true;
      gameplayRenderModeMeta.textContent = "Pixi";
      return;
    }

    const titleLive = renderer.isTitleRenderLive();
    const gameplayLive = renderer.isGameplayRenderLive();

    titleRenderModeButton.hidden = screen !== "title";
    titleRenderModeButton.textContent = titleLive ? "R:L" : "R:B";
    titleRenderModeButton.ariaPressed = titleLive ? "true" : "false";
    titleRenderModeButton.title = titleLive
      ? "Switch title rendering back to baked mode"
      : "Switch title rendering to live mode";
    titleRenderModeButton.setAttribute("aria-label", titleRenderModeButton.title);

    gameplayRenderModeButton.hidden = screen !== "playing";
    gameplayRenderModeButton.classList.toggle("battlefield-option--active", gameplayLive);
    gameplayRenderModeButton.setAttribute("aria-pressed", gameplayLive ? "true" : "false");
    gameplayRenderModeButton.title = gameplayLive
      ? "Switch gameplay rendering back to baked sharp mode"
      : "Switch gameplay rendering to live mode";
    gameplayRenderModeMeta.textContent = gameplayLive ? "Live" : "Baked Sharp";
  };

  titleRenderModeButton.addEventListener("click", () => {
    if (!hasRenderModeControls(renderer)) return;
    renderer.toggleTitleRenderMode();
    syncRenderModeUi();
  });
  gameplayRenderModeButton.addEventListener("click", () => {
    if (!hasRenderModeControls(renderer)) return;
    renderer.toggleGameplayRenderMode();
    syncRenderModeUi();
  });

  const game = new Game({
    canvas,
    renderer,
    onFrameSample(sample) {
      perfHarness?.recorder.onFrame(sample);
    },
    onReplayFinished(sample) {
      if (!perfHarness) return;
      const { banner, recorder } = perfHarness;
      void recorder
        .onReplayFinish()
        .then((report) => {
          if (!report) return;
          console.log("[perf-debug] replay finished", report.runId, report.summary.p95);
          banner.set(`DONE ${report.replayId} wave ${sample.wave}`, "done", formatPerfReportSummary(report));
          activePerfRequest = null;
          const nextPerfRequest = queuedPerfRequest;
          queuedPerfRequest = null;
          if (nextPerfRequest) {
            void runPerfRequest(nextPerfRequest);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[perf-debug] replay finish failed", message);
          banner.set(`PERF ERROR ${message}`, "error");
          activePerfRequest = null;
          const nextPerfRequest = queuedPerfRequest;
          queuedPerfRequest = null;
          if (nextPerfRequest) {
            void runPerfRequest(nextPerfRequest);
          }
        });
    },
    onScreenChange(nextScreen) {
      screen = nextScreen;
      syncRenderModeUi();
    },
  });

  function ensurePerfHarness(): PerfHarness {
    if (perfHarness) return perfHarness;
    perfHarness = {
      banner: createPerfStatusBanner(),
      recorder: new PerfRecorder(canvas!),
    };
    return perfHarness;
  }

  async function runPerfRequest(perfRequest: QueuedPerfRequest): Promise<void> {
    const { banner, recorder } = ensurePerfHarness();
    activePerfRequest = perfRequest;
    queuedPerfRequest = queuedPerfRequest?.requestKey === perfRequest.requestKey ? null : queuedPerfRequest;
    lastHandledPerfRequestKey = perfRequest.requestKey;
    writeLastHandledPerfRequestKey(perfRequest.requestKey);
    try {
      console.log(
        "[perf-debug] perf request",
        perfRequest.runId,
        perfRequest.replayUrl,
        perfRequest.sinkUrl ?? DEFAULT_PERF_SINK_URL,
      );
      banner.set(`PERF LOADING ${perfRequest.replayUrl}`);
      const replayData = await fetchReplayData(perfRequest.replayUrl);
      console.log(
        "[perf-debug] replay fetched",
        perfRequest.runId,
        getReplayIdFromData(replayData) ?? perfRequest.replayUrl,
      );
      const run = recorder.start({
        autoquit: perfRequest.autoquit,
        replayId: getReplayIdFromData(replayData),
        replayUrl: perfRequest.replayUrl,
        runId: perfRequest.runId,
        sink: resolvePerfSink(perfRequest),
      });
      banner.set(`PERF RUNNING ${run.replayId} ${run.runId.slice(0, 8)}`);
      await game.loadReplay(replayData);
      console.log("[perf-debug] replay started", run.runId, run.replayId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[perf-debug] perf request failed", message);
      banner.set(`PERF ERROR ${message}`, "error");
      activePerfRequest = null;
      const nextPerfRequest = queuedPerfRequest;
      queuedPerfRequest = null;
      if (nextPerfRequest) {
        void runPerfRequest(nextPerfRequest);
      }
    }
  }

  function enqueuePerfRequest(perfRequest: PerfBootRequest, requestKey: string): boolean {
    if (activePerfRequest?.requestKey === requestKey || queuedPerfRequest?.requestKey === requestKey) return false;
    if (lastHandledPerfRequestKey === requestKey) return false;

    const nextRequest: QueuedPerfRequest = { ...perfRequest, requestKey };
    if (activePerfRequest) {
      queuedPerfRequest = nextRequest;
      ensurePerfHarness().banner.set(`PERF QUEUED ${nextRequest.replayUrl}`);
      return true;
    }

    void runPerfRequest(nextRequest);
    return true;
  }

  function startPerfCommandPolling(): void {
    if (typeof window === "undefined") return;
    if (!Capacitor.isNativePlatform()) return;
    if (!/^https?:$/.test(window.location.protocol)) return;

    let pollInFlight = false;
    const poll = async () => {
      if (pollInFlight) {
        window.setTimeout(poll, PERF_COMMAND_POLL_MS);
        return;
      }

      pollInFlight = true;
      try {
        const response = await fetch("/api/perf-command", { cache: "no-store" });
        if (response.status === 204) return;
        if (!response.ok) return;

        const payload = parsePerfCommandPayload((await response.json()) as unknown);
        if (!payload) return;
        enqueuePerfRequest(payload, `command:${payload.commandId}`);
      } catch {
        // Ignore polling failures; the command endpoint is best-effort during local perf runs.
      } finally {
        pollInFlight = false;
        window.setTimeout(poll, PERF_COMMAND_POLL_MS);
      }
    };

    window.setTimeout(poll, 250);
  }

  syncRenderModeUi();
  const initialPerfRequest = parsePerfBootRequest(launchUrl ?? window.location.href);
  if (initialPerfRequest) {
    enqueuePerfRequest(
      initialPerfRequest,
      buildPerfRequestKey(initialPerfRequest, `launch:${launchUrl ?? window.location.href}`),
    );
  }
  startPerfCommandPolling();
  return {
    game,
    async handleLaunchUrl(nextLaunchUrl: string): Promise<boolean> {
      const perfRequest = parsePerfBootRequest(nextLaunchUrl);
      if (!perfRequest) return false;
      return enqueuePerfRequest(perfRequest, buildPerfRequestKey(perfRequest, `launch:${nextLaunchUrl}`));
    },
  };
}
