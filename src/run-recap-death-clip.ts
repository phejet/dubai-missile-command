import { clientLog, clientLogEnabled } from "./client-log";
import { CANVAS_H, CANVAS_W } from "./game-logic";
import { PixiRenderer } from "./pixi-render";
import { createReplayStateAnchor } from "./replay-anchor";
import { createReplayRunner, createReplayRunnerFromAnchor } from "./replay";
import { seekRunnerToTick } from "./replay-seek";
import { handleRunRecapReplayEvent } from "./run-recap-replay-events";
import type { ReplayData, ReplayStateAnchor } from "./types";

const CLIP_TICKS = 300;
const FRAME_MS = 1000 / 30;
const END_EFFECT_TICKS = 60;
const END_EFFECT_FRAME_MS = FRAME_MS * 2;
const SEEK_TIMEOUT_MS = 1500;

type ReplayRunner = ReturnType<typeof createReplayRunner>;

export interface RunRecapDeathClipOptions {
  anchor?: ReplayStateAnchor | null;
}

interface RunnerAtTickResult {
  finalTick: number;
  reached: boolean;
  runner: ReplayRunner | null;
  timedOut: boolean;
}

function resolveFinalTick(replay: ReplayData): number {
  if (typeof replay.finalTick === "number") return replay.finalTick;
  const lastActionTick = replay.actions.reduce((max, action) => Math.max(max, action.tick), 0);
  return lastActionTick + CLIP_TICKS;
}

function resumeIfPaused(runner: ReplayRunner): void {
  if (runner.isBonusPaused()) {
    const state = runner.getState();
    if (state) state._bonusScreenDone = true;
    runner.resumeFromBonusScreen();
  }
  if (runner.isShopPaused()) runner.resumeFromShop();
}

async function createRunnerAtTick(
  replay: ReplayData,
  startTick: number,
  anchor: ReplayStateAnchor | null,
  shouldStopSeek: () => boolean,
  shouldDiscardRunner: () => boolean,
  didTimeout: () => boolean,
  onProgress: (tick: number) => void,
  onRunner: (runner: ReplayRunner | null) => void,
): Promise<RunnerAtTickResult> {
  let runner: ReplayRunner;
  runner = anchor
    ? createReplayRunnerFromAnchor(replay, anchor, (type, data) =>
        handleRunRecapReplayEvent(replay, runner, type, data),
      )
    : createReplayRunner(replay, (type, data) => handleRunRecapReplayEvent(replay, runner, type, data));
  onRunner(runner);
  runner.init();
  const signal = {
    get cancelled() {
      return shouldStopSeek();
    },
  };
  const result = await seekRunnerToTick(runner, startTick, signal, onProgress);
  if (shouldDiscardRunner()) {
    runner.cleanup();
    onRunner(null);
    return { finalTick: result.finalTick, reached: result.reached, runner: null, timedOut: didTimeout() };
  }
  return { finalTick: result.finalTick, reached: result.reached, runner, timedOut: didTimeout() };
}

export function mountRunRecapDeathClip(
  container: HTMLElement,
  replay: ReplayData,
  { anchor = null }: RunRecapDeathClipOptions = {},
): () => void {
  container.innerHTML = `<span>Preparing final seconds...</span>`;
  container.classList.add("run-recap__death-clip--live");

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.className = "run-recap__death-canvas";
  canvas.style.visibility = "hidden";

  const finalTick = resolveFinalTick(replay);
  const startTick = Math.max(0, finalTick - CLIP_TICKS);
  let runner: ReplayRunner | null = null;
  let seekingRunner: ReplayRunner | null = null;
  let renderer: PixiRenderer | null = null;
  let rendererReady: Promise<void> | null = null;
  let raf = 0;
  let lastFrameTime = 0;
  let seekTimeoutTimer = 0;
  let generation = 0;
  let stopped = false;
  let clipStartAnchor: ReplayStateAnchor | null = null;
  let completionLogged = false;
  let renderedFrame = false;

  // Diagnostics: the seek re-simulates the whole run from tick 0 each loop, which is
  // cheap on desktop but can grind on slower devices. These timings expose the cost.
  const mountedAt = performance.now();
  let rendererCreatedAt = 0;
  let seekStartedAt = 0;
  let playStartedAt = 0;
  let loopCount = 0;
  let lastProgressAt = 0;
  let lastProgressTick = 0;
  const onWindowError = (e: ErrorEvent) =>
    clientLog("death-clip", "window-error", { message: e.message, source: e.filename, line: e.lineno });
  const onRejection = (e: PromiseRejectionEvent) =>
    clientLog("death-clip", "unhandled-rejection", { reason: String((e as PromiseRejectionEvent).reason) });

  clientLog("death-clip", "mount", {
    finalTick,
    startTick,
    clipTicks: CLIP_TICKS,
    actions: replay.actions.length,
    anchorTick: anchor?.tick ?? null,
    anchorWave: anchor?.wave ?? null,
    isHuman: !!replay.isHuman,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "-",
  });
  const status = document.createElement("span");
  status.className = "run-recap__death-status";

  const restartClip = () => {
    if (stopped) return;
    const currentGeneration = ++generation;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(seekTimeoutTimer);
    seekTimeoutTimer = 0;
    runner?.cleanup();
    seekingRunner?.cleanup();
    runner = null;
    seekingRunner = null;
    completionLogged = false;
    container.classList.remove("run-recap__death-clip--complete");
    container.classList.remove("run-recap__death-clip--zoom");
    canvas.dataset.clipStatus = "seeking";
    canvas.dataset.clipTick = "";
    canvas.dataset.clipSeekTick = "0";
    status.hidden = false;
    status.textContent = "Preparing final seconds...";
    lastFrameTime = 0;

    loopCount += 1;
    seekStartedAt = performance.now();
    lastProgressAt = seekStartedAt;
    const seekAnchor = clipStartAnchor ?? anchor;
    lastProgressTick = seekAnchor?.tick ?? 0;
    let seekTimedOut = false;
    let seekDone = false;
    clientLog("death-clip", "seek-start", {
      anchorTick: seekAnchor?.tick ?? null,
      anchorWave: seekAnchor?.wave ?? null,
      cachedClipStart: !!clipStartAnchor,
      generation: currentGeneration,
      loop: loopCount,
      startTick,
    });
    seekTimeoutTimer = window.setTimeout(() => {
      if (stopped || generation !== currentGeneration || runner || seekDone) return;
      seekTimedOut = true;
      clientLog("death-clip", "seek-timeout", {
        anchorTick: anchor?.tick ?? null,
        generation: currentGeneration,
        loop: loopCount,
        reachedTick: seekingRunner?.getTick() ?? null,
        targetTick: startTick,
        timeoutMs: SEEK_TIMEOUT_MS,
      });
    }, SEEK_TIMEOUT_MS);

    const seekPromise = createRunnerAtTick(
      replay,
      startTick,
      seekAnchor,
      () => stopped || generation !== currentGeneration || seekTimedOut,
      () => stopped || generation !== currentGeneration,
      () => seekTimedOut,
      (tick) => {
        canvas.dataset.clipSeekTick = String(tick);
        if (!clientLogEnabled()) return;
        const now = performance.now();
        if (now - lastProgressAt >= 600) {
          const ticksPerSec = Math.round(((tick - lastProgressTick) / (now - lastProgressAt)) * 1000);
          clientLog("death-clip", "seek-progress", {
            tick,
            target: startTick,
            sinceStartMs: Math.round(now - seekStartedAt),
            ticksPerSec,
          });
          lastProgressAt = now;
          lastProgressTick = tick;
        }
      },
      (nextRunner) => {
        if (generation === currentGeneration) seekingRunner = nextRunner;
      },
    ).then((result) => {
      seekDone = true;
      return result;
    });

    void Promise.all([rendererReady ?? Promise.resolve(), seekPromise])
      .then(([, seekResult]) => {
        clearTimeout(seekTimeoutTimer);
        seekTimeoutTimer = 0;
        const nextRunner = seekResult.runner;
        if (stopped || generation !== currentGeneration || !nextRunner || !renderer) {
          clientLog("death-clip", "seek-abandoned", {
            generation: currentGeneration,
            loop: loopCount,
            durationMs: Math.round(performance.now() - seekStartedAt),
            reason: stopped
              ? "stopped"
              : generation !== currentGeneration
                ? "superseded"
                : !nextRunner
                  ? "cancelled"
                  : "no-renderer",
            reachedTick: nextRunner?.getTick() ?? null,
          });
          return;
        }
        if (seekResult.timedOut && !seekResult.reached) {
          clientLog("death-clip", "static-fallback", {
            durationMs: Math.round(performance.now() - seekStartedAt),
            reachedTick: seekResult.finalTick,
            targetTick: startTick,
          });
          seekingRunner = null;
          runner = nextRunner;
          status.hidden = true;
          canvas.dataset.clipStatus = "complete";
          canvas.dataset.clipTick = String(runner.getTick());
          const state = runner.getState();
          if (state) {
            renderer.renderGameplay(state, { showShop: false, interpolationAlpha: 1 });
            canvas.style.visibility = "";
            renderedFrame = true;
          }
          container.classList.add("run-recap__death-clip--complete");
          return;
        }
        clientLog("death-clip", "seek-end", {
          generation: currentGeneration,
          loop: loopCount,
          durationMs: Math.round(performance.now() - seekStartedAt),
          reachedTick: nextRunner.getTick(),
        });
        seekingRunner = null;
        runner = nextRunner;
        status.hidden = true;
        canvas.dataset.clipStatus = "playing";
        playStartedAt = performance.now();
        const state = runner.getState();
        if (seekResult.reached && !clipStartAnchor && state) {
          clipStartAnchor = createReplayStateAnchor(state, "deathClipStart");
        }
        if (state) {
          renderer.renderGameplay(state, { showShop: false, interpolationAlpha: 1 });
          canvas.style.visibility = "";
          renderedFrame = true;
        }
        raf = requestAnimationFrame(render);
      })
      .catch((error: unknown) => {
        clearTimeout(seekTimeoutTimer);
        seekTimeoutTimer = 0;
        if (stopped || generation !== currentGeneration) return;
        const message = error instanceof Error ? error.message : String(error);
        clientLog("death-clip", "seek-error", {
          anchorTick: anchor?.tick ?? null,
          generation: currentGeneration,
          loop: loopCount,
          message,
          targetTick: startTick,
        });
        seekingRunner?.cleanup();
        seekingRunner = null;
        runner = null;
        status.hidden = false;
        status.textContent = "Death replay unavailable";
        canvas.dataset.clipStatus = "error";
        canvas.dataset.clipError = message.slice(0, 160);
      });
  };

  const cleanup = () => {
    clientLog("death-clip", "cleanup", { loop: loopCount, sinceMountMs: Math.round(performance.now() - mountedAt) });
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(seekTimeoutTimer);
    container.removeEventListener("click", restartClip);
    if (typeof window !== "undefined") {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onRejection);
    }
    runner?.cleanup();
    seekingRunner?.cleanup();
    runner = null;
    seekingRunner = null;
    renderer?.destroy();
    renderer = null;
    canvas.style.visibility = "hidden";
    renderedFrame = false;
    canvas.remove();
    container.classList.remove("run-recap__death-clip--live");
    container.classList.remove("run-recap__death-clip--complete");
    container.classList.remove("run-recap__death-clip--zoom");
  };

  const render = (time: number) => {
    if (stopped || !runner || !renderer) return;
    const endEffectActive = runner.getTick() >= finalTick - END_EFFECT_TICKS;
    const frameMs = endEffectActive ? END_EFFECT_FRAME_MS : FRAME_MS;
    if (time - lastFrameTime >= frameMs) {
      lastFrameTime = time;
      resumeIfPaused(runner);
      const state = runner.getState();
      if (endEffectActive) container.classList.add("run-recap__death-clip--zoom");
      canvas.dataset.clipTick = String(runner.getTick());
      if (state) {
        renderer.renderGameplay(state, { showShop: false, interpolationAlpha: 1 });
        if (!renderedFrame) {
          canvas.style.visibility = "";
          renderedFrame = true;
        }
      }
      if (!runner.isFinished() && runner.getTick() < finalTick && !runner.isShopPaused() && !runner.isBonusPaused()) {
        runner.step();
      } else {
        canvas.dataset.clipStatus = "complete";
        container.classList.add("run-recap__death-clip--complete");
        if (!completionLogged) {
          completionLogged = true;
          clientLog("death-clip", "play-complete", {
            loop: loopCount,
            durationMs: Math.round(performance.now() - playStartedAt),
            lastTick: runner.getTick(),
            finalTick,
          });
        }
        raf = 0;
        return;
      }
    }
    raf = requestAnimationFrame(render);
  };

  window.setTimeout(() => {
    if (stopped) return;
    container.innerHTML = "";
    container.append(canvas, status);
    container.addEventListener("click", restartClip);
    if (clientLogEnabled() && typeof window !== "undefined") {
      window.addEventListener("error", onWindowError);
      window.addEventListener("unhandledrejection", onRejection);
    }
    rendererCreatedAt = performance.now();
    clientLog("death-clip", "renderer-create", { sinceMountMs: Math.round(rendererCreatedAt - mountedAt) });
    renderer = new PixiRenderer(canvas, { preserveDrawingBuffer: false, renderInitialFrame: false });
    rendererReady = renderer.readyPromise.then(() => {
      if (clientLogEnabled()) {
        clientLog("death-clip", "renderer-ready", {
          sinceCreateMs: Math.round(performance.now() - rendererCreatedAt),
          renderPaused: renderer?.isRenderPaused?.() ?? null,
        });
      }
      if (stopped) return;
      container.classList.remove("run-recap__death-clip--complete");
      container.classList.remove("run-recap__death-clip--zoom");
    });
    restartClip();
  }, 0);

  return cleanup;
}
