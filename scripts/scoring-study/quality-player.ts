import { buildReplayCheckpoint } from "../../src/replay-debug";
import { PixiRenderer } from "../../src/pixi-render";
import { preloadCanvasRenderResources } from "../../src/canvas-render-resources";
import { createReplayRunner, createReplayRunnerFromAnchor } from "../../src/replay";
import { createReplayStateAnchor } from "../../src/replay-anchor";
import { seekRunnerToTick } from "../../src/replay-seek";
import { availableCharges } from "./observer.mjs";
import type { ReplayData, ReplayStateAnchor } from "../../src/types";
type Clip = { id: string; label: string; start: number; end: number; focusTick: number };
const $ = (id: string) => document.getElementById(id)!;
const base = new URL(import.meta.env.BASE_URL + "operator-results/scoring-study-20260915/", window.location.origin);
const clips: Clip[] = await fetch(new URL("quality/clips.json", base)).then((r) => r.json());
const canvas = $("battlefield") as HTMLCanvasElement;
preloadCanvasRenderResources();
const renderer = new PixiRenderer(canvas, { gameplayOnly: true, renderInitialFrame: false });
await renderer.readyPromise;
const overlay = $("taps") as HTMLCanvasElement;
const ctx = overlay.getContext("2d")!;
const select = $("clip") as HTMLSelectElement;
const scrub = $("scrub") as HTMLInputElement;
const cache = new Map<string, { replay: ReplayData; anchor: ReplayStateAnchor }>();
let runner: ReturnType<typeof createReplayRunner> | null = null;
let clip = clips[0];
let replay: ReplayData;
let paused = true;
let loading = false;
let generation = 0;
let signal = { cancelled: false };
let last = 0;
let budget = 0;
let verified = 0;
for (const c of clips) {
  const option = document.createElement("option");
  option.value = c.id;
  option.textContent = c.id.replace("clip-", "Clip ");
  select.append(option);
}
function divergence(type: string) {
  if (type === "replay_divergence") throw Error("Replay checkpoint divergence");
}
function render() {
  if (!runner) return;
  const g = runner.getState()!;
  const tick = runner.getTick();
  renderer.renderGameplay(
    { ...g, score: 0, combo: 1, comboToast: null, multiKillToast: null },
    { interpolationAlpha: 1 },
  );
  ctx.clearRect(0, 0, 900, 1600);
  for (const a of replay.actions) {
    if (a.type !== "fire" || a.tick > tick || tick - a.tick >= 18) continue;
    ctx.strokeStyle = "#71fff0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 14 + (tick - a.tick) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  $("time").textContent =
    ((tick - clip.start) / 60).toFixed(1) + " / " + ((clip.end - clip.start) / 60).toFixed(1) + " s";
  scrub.value = String(tick - clip.start);
  $("capacity").textContent =
    "Charges " +
    availableCharges(g, tick) +
    " · Burj " +
    g.burjHealth +
    " HP · Launchers " +
    g.launcherHP.filter((h) => h > 0).length;
  $("active").textContent = g.upgrades.emp
    ? "EMP " + (g.empReadyThisWave ? "ready" : "spent")
    : g.upgrades.f15
      ? "F-15 " + (g.f15ReadyThisWave ? "ready" : "spent")
      : "No active equipped";
  $("phase").textContent = g.waveComplete ? "Wave ending" : !g.burjAlive ? "Burj destroyed" : "";
  $("play").textContent = paused ? "Play" : "Pause";
  document.documentElement.dataset.tick = String(tick);
  document.documentElement.dataset.ready = "true";
}
async function load(id: string, offset = 0) {
  const gen = ++generation;
  signal.cancelled = true;
  signal = { cancelled: false };
  const localSignal = signal;
  paused = true;
  loading = true;
  document.documentElement.dataset.ready = "false";
  $("status").textContent = "Loading replay…";
  runner?.cleanup();
  clip = clips.find((c) => c.id === id)!;
  select.value = id;
  const target = clip.start + offset;
  try {
    let saved = cache.get(id);
    if (!saved) {
      replay = await fetch(new URL(clip.label + "-replay.json", base)).then((r) => r.json());
      if (gen !== generation) return;
      runner = createReplayRunner(replay, null, divergence);
      runner.init();
      await seekRunnerToTick(runner, clip.start, localSignal);
      if (gen !== generation) return;
      const anchor = createReplayStateAnchor(runner.getState()!)!;
      saved = { replay, anchor };
      cache.set(id, saved);
    } else {
      replay = saved.replay;
      runner = createReplayRunnerFromAnchor(replay, saved.anchor, null, divergence);
      runner.init();
    }
    if (offset > 0) await seekRunnerToTick(runner!, target, localSignal);
    if (gen !== generation) return;
    scrub.max = String(clip.end - clip.start);
    $("status").textContent = "Score hidden · turquoise rings mark recorded taps · focus near 2.0 s";
    loading = false;
    budget = 0;
    verified++;
    render();
    restoreLabel();
  } catch (error) {
    loading = false;
    $("status").textContent = "Playback error: " + String(error);
    throw error;
  }
}
function step() {
  if (!runner) return;
  if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
  if (runner.isShopPaused()) runner.resumeFromShop();
  runner.step();
}
function frame(now: number) {
  const dt = last ? Math.min(100, now - last) : 0;
  last = now;
  if (!paused && !loading && runner) {
    budget += (dt * 60) / 1000;
    while (budget >= 1 && runner.getTick() < clip.end) {
      step();
      budget--;
    }
    if (runner.getTick() >= clip.end) paused = true;
    render();
  }
  requestAnimationFrame(frame);
}
$("play").addEventListener("click", () => {
  if (loading) return;
  if (runner!.getTick() >= clip.end) {
    void load(clip.id).then(() => {
      paused = false;
      render();
    });
  } else {
    paused = !paused;
    budget = 0;
    render();
  }
});
$("restart").addEventListener("click", () => void load(clip.id));
select.addEventListener("change", () => void load(select.value));
scrub.addEventListener("change", () => void load(clip.id, Number(scrub.value)));
const storageKey = "dmc-shooting-quality-labels-v1";
function labels() {
  return JSON.parse(localStorage.getItem(storageKey) || "{}");
}
function restoreLabel() {
  const record = labels()[clip.id];
  ($("judgment") as HTMLSelectElement).value = record?.judgment || "";
  ($("reason") as HTMLTextAreaElement).value = record?.reason || "";
  $("saved").textContent = record ? "Saved on this browser." : "";
}
$("save").addEventListener("click", () => {
  const judgment = ($("judgment") as HTMLSelectElement).value;
  if (!judgment) {
    $("saved").textContent = "Choose a label first.";
    return;
  }
  const all = labels();
  all[clip.id] = { judgment, reason: ($("reason") as HTMLTextAreaElement).value, at: new Date().toISOString() };
  localStorage.setItem(storageKey, JSON.stringify(all));
  $("saved").textContent = "Saved on this browser. Copy labels to share them.";
});
$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(labels(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("saved").textContent = "Labels copied. Paste them into the conversation.";
  } catch {
    ($("export") as HTMLTextAreaElement).hidden = false;
    ($("export") as HTMLTextAreaElement).value = text;
  }
});
// Local browser verification surface. No writes to replays or simulation state.
Object.assign(window, {
  qualityReview: {
    load,
    clips,
    getState: () => runner?.getState(),
    getCheckpoint: () => buildReplayCheckpoint(runner!.getState()!, runner!.getTick()).hash,
    getTick: () => runner?.getTick(),
    get verified() {
      return verified;
    },
    get paused() {
      return paused;
    },
  },
});
await load(clips[0].id);
requestAnimationFrame(frame);
