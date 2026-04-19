import { CANVAS_H } from "./game-logic";
import { preloadCanvasRenderResources } from "./canvas-render-resources";
import { Game } from "./game";
import { CanvasGameRenderer } from "./game-render";
import type { GameScreen } from "./game-renderer";
import { PerfRecorder } from "./perf-recorder";
import { ConsoleSink, HttpSink, type PerfSink } from "./perf-sinks";
import type { ReplayData } from "./types";

export type RendererMode = "canvas2d";

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

interface PerfStatusBanner {
  set(message: string, state?: "running" | "done" | "error"): void;
}

export interface BootGameRuntime {
  game: Game;
  handleLaunchUrl(launchUrl: string): Promise<boolean>;
}

interface PerfHarness {
  banner: PerfStatusBanner;
  recorder: PerfRecorder;
}

const PHONE_PORTRAIT_LAYOUT_PROFILE = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: false,
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
  banner.id = "perf-status-banner";
  Object.assign(banner.style, {
    background: "rgba(12, 18, 28, 0.88)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "999px",
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.28)",
    color: "#f4efe2",
    font: "600 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: "0.06em",
    padding: "10px 16px",
    position: "fixed",
    right: "20px",
    textTransform: "uppercase",
    top: "20px",
    zIndex: "1000",
  });
  document.body.appendChild(banner);

  return {
    set(message, state = "running") {
      banner.textContent = message;
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

export function bootGame({ mode = "canvas2d", launchUrl }: BootGameOptions = {}): BootGameRuntime {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
  const titleRenderModeButton = document.getElementById("title-render-mode-button") as HTMLButtonElement | null;
  const gameplayRenderModeButton = document.getElementById("option-render") as HTMLButtonElement | null;
  const gameplayRenderModeMeta = document.getElementById("option-render-meta") as HTMLElement | null;

  if (!canvas || !titleRenderModeButton || !gameplayRenderModeButton || !gameplayRenderModeMeta) {
    throw new Error("Missing runtime DOM nodes required to boot the game");
  }

  preloadCanvasRenderResources();
  let perfHarness: PerfHarness | null = null;

  const renderer = (() => {
    switch (mode) {
      case "canvas2d":
      default:
        return new CanvasGameRenderer({ canvas, layoutProfile: PHONE_PORTRAIT_LAYOUT_PROFILE });
    }
  })();

  let screen: GameScreen = "title";

  const syncRenderModeUi = () => {
    const titleLive = renderer.isTitleRenderLive();
    const gameplayLive = renderer.isGameplayRenderLive();

    titleRenderModeButton.hidden = screen !== "title";
    titleRenderModeButton.textContent = `Render: ${titleLive ? "Live" : "Baked"}`;
    titleRenderModeButton.ariaPressed = titleLive ? "true" : "false";
    titleRenderModeButton.title = titleLive
      ? "Switch title rendering back to baked mode"
      : "Switch title rendering to live mode";

    gameplayRenderModeButton.hidden = screen !== "playing";
    gameplayRenderModeButton.classList.toggle("battlefield-option--active", gameplayLive);
    gameplayRenderModeButton.setAttribute("aria-pressed", gameplayLive ? "true" : "false");
    gameplayRenderModeButton.title = gameplayLive
      ? "Switch gameplay rendering back to baked sharp mode"
      : "Switch gameplay rendering to live mode";
    gameplayRenderModeMeta.textContent = gameplayLive ? "Live" : "Baked Sharp";
  };

  titleRenderModeButton.addEventListener("click", () => {
    renderer.toggleTitleRenderMode();
    syncRenderModeUi();
  });
  gameplayRenderModeButton.addEventListener("click", () => {
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
          banner.set(`DONE ${report.replayId} p95 ${report.summary.p95.toFixed(1)}ms wave ${sample.wave}`, "done");
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          banner.set(`PERF ERROR ${message}`, "error");
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

  async function runPerfRequest(perfRequest: PerfBootRequest): Promise<void> {
    const { banner, recorder } = ensurePerfHarness();
    try {
      banner.set(`PERF LOADING ${perfRequest.replayUrl}`);
      const replayData = await fetchReplayData(perfRequest.replayUrl);
      const run = recorder.start({
        autoquit: perfRequest.autoquit,
        replayId: getReplayIdFromData(replayData),
        replayUrl: perfRequest.replayUrl,
        runId: perfRequest.runId,
        sink: resolvePerfSink(perfRequest),
      });
      banner.set(`PERF RUNNING ${run.replayId} ${run.runId.slice(0, 8)}`);
      await game.loadReplay(replayData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      banner.set(`PERF ERROR ${message}`, "error");
    }
  }

  syncRenderModeUi();
  const initialPerfRequest = parsePerfBootRequest(launchUrl ?? window.location.href);
  if (initialPerfRequest) {
    void runPerfRequest(initialPerfRequest);
  }
  return {
    game,
    async handleLaunchUrl(nextLaunchUrl: string): Promise<boolean> {
      const perfRequest = parsePerfBootRequest(nextLaunchUrl);
      if (!perfRequest) return false;
      await runPerfRequest(perfRequest);
      return true;
    },
  };
}
