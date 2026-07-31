// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveReplayResult } from "./diagnostics-log";
import type { GameRenderer } from "./game-renderer";
import { createEmptyGameStats } from "./game-logic";
import type { ReplayData } from "./types";

interface RunRecapCallbacks {
  onWatchFullReplay(): void;
  onWatchFromWave(startTick: number): void;
  onSaveReplay(): Promise<void>;
}

interface GameInternals {
  initGame(): void;
  handleSimEvent(type: string, data: unknown): void;
  openRunRecap(): void;
  setScreen(screen: "title" | "playing" | "gameover"): void;
  startReplay: ReturnType<typeof vi.fn>;
  lastReplay: ReplayData | null;
}

const mocks = vi.hoisted(() => ({
  archiveReplay: vi.fn(),
  mountDeathClip: vi.fn(() => vi.fn()),
  recapCallbacks: null as unknown,
  saveReplayToFile: vi.fn(async () => ({ ok: true })),
  showRunRecap: vi.fn((_data: unknown, callbacks: unknown) => {
    mocks.recapCallbacks = callbacks;
  }),
}));

vi.mock("./diagnostics-log", () => ({
  archiveReplay: mocks.archiveReplay,
  clearDiagnostics: vi.fn(),
  getDiagnosticsBuildId: () => "test-build",
  isDiagnosticsEnabled: () => false,
  setDiagnosticsEnabled: vi.fn(),
  shareDiagnostics: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./run-recap-death-clip", () => ({ mountRunRecapDeathClip: mocks.mountDeathClip }));
vi.mock("./save-replay", () => ({ saveReplayToFile: mocks.saveReplayToFile }));
vi.mock("./ui", () => ({
  cacheHudElements: vi.fn(),
  cacheTransientOverlayElements: vi.fn(),
  hideBonusScreen: vi.fn(),
  hideRunRecap: vi.fn(),
  hideShop: vi.fn(),
  hideUpgradeProgression: vi.fn(),
  showBonusScreen: vi.fn(),
  showGameOver: vi.fn(),
  showRunRecap: mocks.showRunRecap,
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
import { REPLAY_ARCHIVE_GATE_TIMEOUT_MS, REPLAY_ARCHIVE_PREPARING_DELAY_MS } from "./replay-archive-gate";

const renderer: GameRenderer = {
  destroy: vi.fn(),
  renderGameOver: vi.fn(),
  renderGameplay: vi.fn(),
  renderTitle: vi.fn(),
  resize: vi.fn(),
};

function deferredArchive() {
  let resolve!: (result: ArchiveReplayResult) => void;
  const promise = new Promise<ArchiveReplayResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function callbacks(): RunRecapCallbacks {
  return mocks.recapCallbacks as RunRecapCallbacks;
}

function internals(game: Game): GameInternals {
  return game as unknown as GameInternals;
}

function createGameWithArchive(archive: Promise<ArchiveReplayResult> | null) {
  mocks.archiveReplay.mockReturnValue(archive);
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const game = new Game({ canvas, renderer });
  const runtime = internals(game);
  runtime.initGame();
  runtime.handleSimEvent("gameOver", {
    score: 1200,
    wave: 3,
    stats: createEmptyGameStats(),
  });
  return { game, runtime, replay: runtime.lastReplay! };
}

async function drainPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Game replay archive wiring", () => {
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
    mocks.mountDeathClip.mockClear();
    mocks.saveReplayToFile.mockClear();
    mocks.showRunRecap.mockClear();
    mocks.recapCallbacks = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("withholds the death clip, shows delayed honest copy, then mounts after persistence", async () => {
    const archive = deferredArchive();
    createGameWithArchive(archive.promise);
    const stage = document.querySelector<HTMLElement>("[data-gameover-death-clip-stage]")!;

    expect(mocks.mountDeathClip).not.toHaveBeenCalled();
    expect(stage.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(REPLAY_ARCHIVE_PREPARING_DELAY_MS - 1);
    expect(stage.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(stage.textContent).toMatch(/preparing saved replay/i);

    archive.resolve({ ok: true, archiveId: "archive" });
    await drainPromises();
    expect(mocks.mountDeathClip).toHaveBeenCalledOnce();
  });

  it("a fast archive never flashes preparing copy", async () => {
    const archive = deferredArchive();
    createGameWithArchive(archive.promise);
    const stage = document.querySelector<HTMLElement>("[data-gameover-death-clip-stage]")!;
    archive.resolve({ ok: true, archiveId: "archive" });
    await drainPromises();

    expect(mocks.mountDeathClip).toHaveBeenCalledOnce();
    expect(stage.textContent).not.toMatch(/preparing saved replay/i);
  });

  it.each([
    ["success", { ok: true, archiveId: "archive" } satisfies ArchiveReplayResult],
    [
      "failure",
      { ok: false, archiveId: "archive", stage: "flush", error: new Error("disk") } satisfies ArchiveReplayResult,
    ],
  ])("mounts the death clip after archive %s", async (_name, result) => {
    const archive = deferredArchive();
    createGameWithArchive(archive.promise);
    archive.resolve(result);
    await drainPromises();
    expect(mocks.mountDeathClip).toHaveBeenCalledOnce();
  });

  it("mounts after the bounded timeout while persistence remains pending", async () => {
    createGameWithArchive(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(REPLAY_ARCHIVE_GATE_TIMEOUT_MS);
    expect(mocks.mountDeathClip).toHaveBeenCalledOnce();
  });

  it("does not mount a stale death clip after leaving game over", async () => {
    const archive = deferredArchive();
    const { runtime } = createGameWithArchive(archive.promise);
    runtime.setScreen("title");
    archive.resolve({ ok: true, archiveId: "archive" });
    await drainPromises();
    expect(mocks.mountDeathClip).not.toHaveBeenCalled();
  });

  it.each(["full", "wave"] as const)("withholds %s recap playback until archive success", async (path) => {
    const archive = deferredArchive();
    const { runtime, replay } = createGameWithArchive(archive.promise);
    runtime.startReplay = vi.fn();
    runtime.openRunRecap();

    if (path === "full") callbacks().onWatchFullReplay();
    else callbacks().onWatchFromWave(240);
    expect(runtime.startReplay).not.toHaveBeenCalled();

    archive.resolve({ ok: true, archiveId: "archive" });
    await drainPromises();
    expect(runtime.startReplay).toHaveBeenCalledWith(
      replay,
      path === "full" ? { returnToRecap: true } : { seekToTick: 240, returnToRecap: true },
    );
  });

  it.each(["full", "wave"] as const)("allows %s recap playback after archive failure", async (path) => {
    const archive = deferredArchive();
    const { runtime } = createGameWithArchive(archive.promise);
    runtime.startReplay = vi.fn();
    runtime.openRunRecap();
    if (path === "full") callbacks().onWatchFullReplay();
    else callbacks().onWatchFromWave(240);

    archive.resolve({ ok: false, archiveId: "archive", stage: "flush", error: new Error("disk") });
    await drainPromises();
    expect(runtime.startReplay).toHaveBeenCalledOnce();
  });

  it.each(["full", "wave"] as const)("allows %s recap playback after the bounded timeout", async (path) => {
    const { runtime } = createGameWithArchive(new Promise(() => {}));
    runtime.startReplay = vi.fn();
    runtime.openRunRecap();
    if (path === "full") callbacks().onWatchFullReplay();
    else callbacks().onWatchFromWave(240);

    await vi.advanceTimersByTimeAsync(REPLAY_ARCHIVE_GATE_TIMEOUT_MS);
    expect(runtime.startReplay).toHaveBeenCalledOnce();
  });

  it.each(["full", "wave"] as const)("prevents stale %s playback after navigation", async (path) => {
    const archive = deferredArchive();
    const { runtime } = createGameWithArchive(archive.promise);
    runtime.startReplay = vi.fn();
    runtime.openRunRecap();
    if (path === "full") callbacks().onWatchFullReplay();
    else callbacks().onWatchFromWave(240);
    runtime.setScreen("title");

    archive.resolve({ ok: true, archiveId: "archive" });
    await drainPromises();
    expect(runtime.startReplay).not.toHaveBeenCalled();
  });

  it("manual Save Replay remains available while persistence is pending", async () => {
    const { runtime, replay } = createGameWithArchive(new Promise(() => {}));
    runtime.openRunRecap();
    await callbacks().onSaveReplay();
    expect(mocks.saveReplayToFile).toHaveBeenCalledWith(replay);
  });

  it("keeps death-clip and recap playback synchronous when diagnostics is disabled", () => {
    const { runtime } = createGameWithArchive(null);
    expect(mocks.mountDeathClip).toHaveBeenCalledOnce();

    runtime.startReplay = vi.fn();
    runtime.openRunRecap();
    callbacks().onWatchFullReplay();
    expect(runtime.startReplay).toHaveBeenCalledOnce();
  });
});
