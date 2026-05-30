import { CANVAS_H, CANVAS_W } from "./game-logic.js";
import { PixiRenderer } from "./pixi-render.js";
import { createReplayRunner } from "./replay.js";
import { seekRunnerToTick } from "./replay-seek.js";
import { handleRunRecapReplayEvent } from "./run-recap-replay-events.js";
import type { ReplayData } from "./types.js";

const CLIP_TICKS = 300;
const FRAME_MS = 1000 / 30;
const END_EFFECT_TICKS = 60;
const END_EFFECT_FRAME_MS = FRAME_MS * 2;

type ReplayRunner = ReturnType<typeof createReplayRunner>;

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
  shouldCancel: () => boolean,
  onProgress: (tick: number) => void,
  onRunner: (runner: ReplayRunner | null) => void,
): Promise<ReplayRunner | null> {
  let runner: ReplayRunner;
  runner = createReplayRunner(replay, (type, data) => handleRunRecapReplayEvent(replay, runner, type, data));
  onRunner(runner);
  runner.init();
  const signal = {
    get cancelled() {
      return shouldCancel();
    },
  };
  await seekRunnerToTick(runner, startTick, signal, onProgress);
  if (shouldCancel()) {
    runner.cleanup();
    onRunner(null);
    return null;
  }
  return runner;
}

export function mountRunRecapDeathClip(container: HTMLElement, replay: ReplayData): () => void {
  container.innerHTML = `<span>Preparing final seconds...</span>`;
  container.classList.add("run-recap__death-clip--live");

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.className = "run-recap__death-canvas";

  const finalTick = resolveFinalTick(replay);
  const startTick = Math.max(0, finalTick - CLIP_TICKS);
  let runner: ReplayRunner | null = null;
  let seekingRunner: ReplayRunner | null = null;
  let renderer: PixiRenderer | null = null;
  let rendererReady: Promise<void> | null = null;
  let raf = 0;
  let lastFrameTime = 0;
  let restartTimer = 0;
  let generation = 0;
  let stopped = false;
  const status = document.createElement("span");
  status.className = "run-recap__death-status";

  const restartClip = () => {
    if (stopped) return;
    const currentGeneration = ++generation;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(restartTimer);
    restartTimer = 0;
    runner?.cleanup();
    seekingRunner?.cleanup();
    runner = null;
    seekingRunner = null;
    container.classList.remove("run-recap__death-clip--complete");
    container.classList.remove("run-recap__death-clip--zoom");
    canvas.dataset.clipStatus = "seeking";
    canvas.dataset.clipTick = "";
    canvas.dataset.clipSeekTick = "0";
    status.hidden = false;
    status.textContent = "Preparing final seconds...";
    lastFrameTime = 0;

    const seekPromise = createRunnerAtTick(
      replay,
      startTick,
      () => stopped || generation !== currentGeneration,
      (tick) => {
        canvas.dataset.clipSeekTick = String(tick);
      },
      (nextRunner) => {
        if (generation === currentGeneration) seekingRunner = nextRunner;
      },
    );

    void Promise.all([rendererReady ?? Promise.resolve(), seekPromise]).then(([, nextRunner]) => {
      if (stopped || generation !== currentGeneration || !nextRunner || !renderer) return;
      seekingRunner = null;
      runner = nextRunner;
      status.hidden = true;
      canvas.dataset.clipStatus = "playing";
      const state = runner.getState();
      if (state) renderer.renderGameplay(state, { showShop: false, interpolationAlpha: 1 });
      raf = requestAnimationFrame(render);
    });
  };

  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(restartTimer);
    container.removeEventListener("click", restartClip);
    runner?.cleanup();
    seekingRunner?.cleanup();
    runner = null;
    seekingRunner = null;
    renderer?.destroy();
    renderer = null;
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
      if (state) renderer.renderGameplay(state, { showShop: false, interpolationAlpha: 1 });
      if (!runner.isFinished() && runner.getTick() < finalTick && !runner.isShopPaused() && !runner.isBonusPaused()) {
        runner.step();
      } else {
        canvas.dataset.clipStatus = "complete";
        container.classList.add("run-recap__death-clip--complete");
        if (!restartTimer) {
          restartTimer = window.setTimeout(() => {
            restartTimer = 0;
            restartClip();
          }, 900);
        }
      }
    }
    raf = requestAnimationFrame(render);
  };

  window.setTimeout(() => {
    if (stopped) return;
    container.innerHTML = "";
    container.append(canvas, status);
    container.addEventListener("click", restartClip);
    renderer = new PixiRenderer(canvas, { preserveDrawingBuffer: false });
    rendererReady = renderer.readyPromise.then(() => {
      if (stopped) return;
      container.classList.remove("run-recap__death-clip--complete");
      container.classList.remove("run-recap__death-clip--zoom");
    });
    restartClip();
  }, 0);

  return cleanup;
}
