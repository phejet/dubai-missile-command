// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureEnvelope } from "./capture";
import type { GameRenderer } from "./game-renderer";
import { createEmptyGameStats } from "./game-logic";
import type { GameState, ReplayData } from "./types";

interface GameInternals {
  initGame(): void;
  handleSimEvent(type: string, data: unknown): void;
  setScreen(screen: "title" | "playing" | "gameover"): void;
  gameRef: { current: GameState | null };
  lastReplay: ReplayData | null;
  shopOpen: boolean;
  replayActive: boolean;
  activeReplayData: ReplayData | null;
  runId: string | null;
  captureNow(trigger: "gameover" | "manual" | "agent", note?: string): Promise<unknown>;
}

const mocks = vi.hoisted(() => ({
  archiveReplay: vi.fn(),
  uploadCapture: vi.fn(async (capture: CaptureEnvelope) => {
    void capture;
    return { ok: true, captureId: "capture", encoding: "none" };
  }),
}));

vi.mock("./diagnostics-log", () => ({
  archiveReplay: mocks.archiveReplay,
  clearDiagnostics: vi.fn(),
  getBootId: () => "test-boot",
  getDiagnosticsBuildId: () => "test-build",
  isDiagnosticsEnabled: () => false,
  readRecentEvents: vi.fn(async () => ({ events: [], unparsed: 0, truncated: false })),
  setDiagnosticsEnabled: vi.fn(),
  shareDiagnostics: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./capture-sink", () => ({ uploadCapture: mocks.uploadCapture }));
vi.mock("./run-recap-death-clip", () => ({ mountRunRecapDeathClip: vi.fn(() => vi.fn()) }));
vi.mock("./save-replay", () => ({ saveReplayToFile: vi.fn(async () => ({ ok: true })) }));
vi.mock("./ui", () => ({
  cacheHudElements: vi.fn(),
  cacheTransientOverlayElements: vi.fn(),
  hideBonusScreen: vi.fn(),
  hideRunRecap: vi.fn(),
  hideShop: vi.fn(),
  hideUpgradeProgression: vi.fn(),
  showBonusScreen: vi.fn(),
  showGameOver: vi.fn(),
  showRunRecap: vi.fn(),
  showShop: vi.fn(),
  showUpgradeProgression: vi.fn(),
  updateHud: vi.fn(),
  updateTransientOverlays: vi.fn(),
}));
vi.mock("./sound", () => ({
  default: {
    burjHit: vi.fn(),
    buyUpgrade: vi.fn(),
    chainExplosion: vi.fn(),
    empBlast: vi.fn(),
    emptyClick: vi.fn(),
    explosion: vi.fn(),
    fire: vi.fn(),
    gameOver: vi.fn(),
    gameStart: vi.fn(),
    getResourceStats: () => ({}),
    hornetBuzz: vi.fn(),
    hornetFizzle: vi.fn(),
    init: vi.fn(async () => {}),
    isMuted: () => false,
    laserBeam: vi.fn(() => ({ stop: vi.fn() })),
    launcherDestroyed: vi.fn(),
    mirvIncoming: vi.fn(),
    mirvSplit: vi.fn(),
    multiKill: vi.fn(),
    mute: vi.fn(),
    patriotLaunch: vi.fn(),
    planeIncoming: vi.fn(),
    planePass: vi.fn(),
    playTitleTheme: vi.fn(async () => {}),
    prewarm: vi.fn(),
    stopTitleTheme: vi.fn(),
    waveCleared: vi.fn(),
  },
}));

import { Game } from "./game";

const renderer: GameRenderer = {
  destroy: vi.fn(),
  renderGameOver: vi.fn(),
  renderGameplay: vi.fn(),
  renderTitle: vi.fn(),
  resize: vi.fn(),
};

function internals(game: Game): GameInternals {
  return game as unknown as GameInternals;
}

function lastCapturedEnvelope(): CaptureEnvelope {
  const calls = mocks.uploadCapture.mock.calls;
  return calls[calls.length - 1][0];
}

describe("Game capture orchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.open();
    document.write(readFileSync(join(process.cwd(), "index.html"), "utf8"));
    document.close();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
    mocks.archiveReplay.mockReset();
    mocks.uploadCapture.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("captures each controller state from the correct replay source", async () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer });
    const runtime = internals(game);

    await runtime.captureNow("manual");
    let captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      meta: { appScreen: "title", replaySource: "none", partial: false, runId: null, replayComplete: false },
      replay: null,
      summary: null,
    });

    runtime.initGame();
    runtime.setScreen("playing");
    const runId = runtime.runId;
    await runtime.captureNow("manual", "  mid-run note  ");
    captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      meta: {
        appScreen: "playing",
        replaySource: "live",
        partial: true,
        runId,
        note: "mid-run note",
        replayComplete: false,
      },
      summary: { outcome: "in_progress" },
      replay: { finalTick: 0 },
    });

    runtime.shopOpen = true;
    await runtime.captureNow("agent");
    captured = lastCapturedEnvelope();
    expect(captured.meta).toMatchObject({
      appScreen: "shop",
      replaySource: "live",
      partial: true,
      runId,
      replayComplete: false,
    });

    runtime.shopOpen = false;
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    await runtime.captureNow("gameover");
    captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      meta: {
        appScreen: "gameover",
        replaySource: "last-completed",
        partial: false,
        runId,
        replayComplete: true,
      },
      summary: { outcome: expect.stringMatching(/burj_destroyed|survived/) },
    });

    runtime.setScreen("title");
    await runtime.captureNow("manual");
    captured = lastCapturedEnvelope();
    expect(captured.meta).toMatchObject({
      appScreen: "title",
      replaySource: "last-completed",
      runId,
      replayComplete: true,
    });

    runtime.replayActive = true;
    runtime.activeReplayData = runtime.lastReplay;
    runtime.setScreen("playing");
    await runtime.captureNow("manual");
    captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      meta: {
        appScreen: "playing",
        replaySource: "playback",
        partial: false,
        runId: null,
        replayComplete: false,
      },
      summary: null,
      replay: { seed: expect.any(Number) },
    });
  });

  it("keeps a run id stable within a run and changes it on initialization", async () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer });
    const runtime = internals(game);
    runtime.initGame();
    runtime.setScreen("playing");

    await runtime.captureNow("manual");
    const first = lastCapturedEnvelope().meta.runId;
    await runtime.captureNow("manual");
    const second = lastCapturedEnvelope().meta.runId;
    expect(second).toBe(first);

    vi.advanceTimersByTime(1);
    runtime.initGame();
    await runtime.captureNow("manual");
    const third = lastCapturedEnvelope().meta.runId;
    expect(third).not.toBe(first);
  });
});
