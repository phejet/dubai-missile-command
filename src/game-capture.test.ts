// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemReport, SessionUpload } from "./capture";
import type { UploadCaptureResult } from "./capture-sink";
import type { GameRenderer } from "./game-renderer";
import { createEmptyGameStats } from "./game-logic";
import type { SessionUploadQueue } from "./capture-upload-queue";
import type { GameState, ReplayData } from "./types";
import type { CreateRunShareResult } from "./share-run";
import { replayFixture } from "../test-fixtures/capture";

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
  showBonusScreen: vi.fn(),
  showRunRecap: vi.fn(),
  readRecentEvents: vi.fn(async () => ({ events: [], unparsed: 0, truncated: false })),
  captured: [] as Array<SessionUpload | ProblemReport>,
  uploadSession: vi.fn(async (capture: SessionUpload): Promise<UploadCaptureResult> => {
    mocks.captured.push(capture);
    return { ok: true, id: capture.meta.runId, encoding: "none" as const };
  }),
  reportProblem: vi.fn(async (capture: ProblemReport) => {
    mocks.captured.push(capture);
    return { ok: true, id: capture.reportId, encoding: "none" as const };
  }),
  enrollCaptureCredential: vi.fn(async () => ({ keyId: "test-key" })),
  createRunShareLink: vi.fn(
    async (): Promise<CreateRunShareResult> => ({
      ok: true as const,
      shareId: "0123456789abcdef",
      shareUrl: "https://capture.example/r/0123456789abcdef",
    }),
  ),
  presentRunShareSheet: vi.fn(async () => undefined),
  submitRunFeedback: vi.fn(async (input: { emoji: string }) => ({ ok: true as const, emoji: input.emoji })),
}));

vi.mock("./diagnostics-log", () => ({
  archiveReplay: mocks.archiveReplay,
  clearDiagnostics: vi.fn(),
  getBootId: () => "test-boot",
  getDiagnosticsBuildId: () => "test-build",
  isDiagnosticsEnabled: () => false,
  readRecentEvents: mocks.readRecentEvents,
  setDiagnosticsEnabled: vi.fn(),
  shareDiagnostics: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./capture-sink", () => ({ uploadSession: mocks.uploadSession, reportProblem: mocks.reportProblem }));
vi.mock("./capture-auth", () => ({ enrollCaptureCredential: mocks.enrollCaptureCredential }));
vi.mock("./run-recap-death-clip", () => ({ mountRunRecapDeathClip: vi.fn(() => vi.fn()) }));
vi.mock("./save-replay", () => ({ saveReplayToFile: vi.fn(async () => ({ ok: true })) }));
vi.mock("./share-run", () => ({
  createRunShareLink: mocks.createRunShareLink,
  presentRunShareSheet: mocks.presentRunShareSheet,
}));
vi.mock("./run-feedback", () => ({ submitRunFeedback: mocks.submitRunFeedback }));
vi.mock("./ui", () => ({
  cacheHudElements: vi.fn(),
  cacheTransientOverlayElements: vi.fn(),
  hideBonusScreen: vi.fn(),
  hideRunRecap: vi.fn(),
  hideShop: vi.fn(),
  hideUpgradeProgression: vi.fn(),
  showBonusScreen: mocks.showBonusScreen,
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

const renderer: GameRenderer = {
  readyPromise: Promise.resolve(),
  destroy: vi.fn(),
  renderGameOver: vi.fn(),
  renderGameplay: vi.fn(),
  renderTitle: vi.fn(),
  resize: vi.fn(),
};

function internals(game: Game): GameInternals {
  return game as unknown as GameInternals;
}

function lastCapturedEnvelope(): SessionUpload | ProblemReport {
  return mocks.captured[mocks.captured.length - 1];
}

function captureQueue(): SessionUploadQueue & {
  enqueue: ReturnType<typeof vi.fn<SessionUploadQueue["enqueue"]>>;
  drain: ReturnType<typeof vi.fn<SessionUploadQueue["drain"]>>;
} {
  return {
    enqueue: vi.fn(async () => ({ accepted: true, count: 1, rawBytes: 100 })),
    inspect: vi.fn(async () => ({ count: 0, rawBytes: 0 })),
    drain: vi.fn(async () => ({
      count: 0,
      rawBytes: 0,
      sentRunIds: [],
      droppedRunIds: [],
      deferred: 0,
    })),
    remove: vi.fn(async () => ({ count: 0, rawBytes: 0 })),
    setFeedbackEmoji: vi.fn(async () => ({ found: false, count: 0, rawBytes: 0 })),
    clear: vi.fn(async () => undefined),
  };
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
    mocks.showBonusScreen.mockReset();
    mocks.showRunRecap.mockReset();
    mocks.captured.length = 0;
    mocks.uploadSession.mockClear();
    mocks.reportProblem.mockClear();
    mocks.enrollCaptureCredential.mockClear();
    mocks.createRunShareLink.mockReset();
    mocks.createRunShareLink.mockResolvedValue({
      ok: true,
      shareId: "0123456789abcdef",
      shareUrl: "https://capture.example/r/0123456789abcdef",
    });
    mocks.presentRunShareSheet.mockClear();
    mocks.submitRunFeedback.mockClear();
    mocks.readRecentEvents.mockClear();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for renderer resources before starting replay playback", async () => {
    let resolveReady!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const delayedRenderer = { ...renderer, readyPromise };
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer: delayedRenderer });
    const load = game.loadReplay({
      ...replayFixture(),
      initialState: {
        metaProgression: { version: 1, completedObjectives: [] },
        forcedUpgradeFamilies: [],
        burjHealth: 7,
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(internals(game).replayActive).toBe(false);

    resolveReady();
    await load;
    expect(internals(game).replayActive).toBe(true);
  });

  it("captures each controller state from the correct replay source", async () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer });
    const runtime = internals(game);

    await runtime.captureNow("manual");
    let captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      kind: "report",
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
      kind: "session",
      meta: {
        appScreen: "gameover",
        replaySource: "last-completed",
        partial: false,
        runId,
        replayComplete: true,
      },
      summary: { outcome: expect.stringMatching(/burj_destroyed|survived/) },
    });
    expect(mocks.readRecentEvents).toHaveBeenCalledTimes(3);

    runtime.setScreen("title");
    await runtime.captureNow("manual");
    captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      kind: "session",
      meta: {
        appScreen: "title",
        trigger: "manual",
        replaySource: "last-completed",
        runId,
        replayComplete: true,
      },
    });
    expect(mocks.readRecentEvents).toHaveBeenCalledTimes(3);

    runtime.replayActive = true;
    runtime.activeReplayData = runtime.lastReplay;
    runtime.setScreen("playing");
    await runtime.captureNow("manual");
    captured = lastCapturedEnvelope();
    expect(captured).toMatchObject({
      kind: "report",
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
    expect(mocks.readRecentEvents).toHaveBeenCalledTimes(4);
  });

  it("enrolls from an explicit staging control and sends only a completed run", async () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: captureQueue(),
    });
    const runtime = internals(game);
    const consentButton = document.getElementById("option-capture-consent") as HTMLButtonElement;
    const sendButton = document.getElementById("option-capture-send") as HTMLButtonElement;
    const indicator = document.getElementById("capture-upload-indicator")!;

    expect(consentButton.hidden).toBe(false);
    expect(sendButton.hidden).toBe(true);
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toBe("Playtest uploads off");
    consentButton.click();
    await vi.waitFor(() => expect(mocks.enrollCaptureCredential).toHaveBeenCalledTimes(1));
    expect(mocks.enrollCaptureCredential).toHaveBeenCalledWith({
      endpoint: "https://capture.example",
      channel: "staging",
      buildId: "test-build",
    });
    expect(document.getElementById("option-capture-consent-meta")!.textContent).toBe("Ready");
    expect(indicator.textContent).toBe("Auto-upload off");
    expect(sendButton.hidden).toBe(false);
    expect(sendButton.disabled).toBe(true);

    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    runtime.setScreen("title");
    expect(sendButton.disabled).toBe(false);
    sendButton.click();
    await vi.waitFor(() => expect(mocks.uploadSession).toHaveBeenCalledTimes(1));
    expect(document.getElementById("option-capture-send-meta")!.textContent).toMatch(/^Sent/);
  });

  it("automatically uploads a completed human run after the explicit toggle", async () => {
    const queue = captureQueue();
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: queue,
    });
    const runtime = internals(game);
    const autoButton = document.getElementById("option-capture-auto") as HTMLButtonElement;
    await vi.waitFor(() => expect(autoButton.disabled).toBe(false));
    autoButton.click();
    await vi.waitFor(() => expect(queue.drain).toHaveBeenCalledTimes(1));

    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(mocks.uploadSession).toHaveBeenCalledTimes(1));

    expect(mocks.uploadSession.mock.calls[0][0].meta).toMatchObject({
      trigger: "gameover",
      replaySource: "last-completed",
      partial: false,
    });
    expect(mocks.reportProblem).not.toHaveBeenCalled();
    expect(document.getElementById("option-capture-auto-meta")!.textContent).toMatch(/^Sent/);
    expect(document.getElementById("capture-upload-indicator")!).toMatchObject({
      textContent: "Last run uploaded",
      dataset: expect.objectContaining({ state: "ready" }),
    });
  });

  it("shares an automatically uploaded recap without uploading the session twice", async () => {
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    localStorage.setItem("dmc.capture.auto-upload-sessions.v1.staging", "true");
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: captureQueue(),
    });
    const runtime = internals(game);
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(mocks.uploadSession).toHaveBeenCalledTimes(1));

    document.getElementById("progression-button")!.click();
    document.getElementById("run-recap-panel")!.innerHTML = "<button data-run-recap-share>Share Run</button>";
    const recapCall = mocks.showRunRecap.mock.calls[mocks.showRunRecap.mock.calls.length - 1];
    const callbacks = recapCall?.[1] as { onShareRun?: () => Promise<void> };
    expect(callbacks.onShareRun).toBeTypeOf("function");
    await callbacks.onShareRun?.();

    expect(mocks.uploadSession).toHaveBeenCalledTimes(1);
    expect(mocks.createRunShareLink).toHaveBeenCalledWith({
      endpoint: "https://capture.example",
      channel: "staging",
      buildId: "test-build",
      runId: expect.any(String),
    });
    expect(mocks.presentRunShareSheet).toHaveBeenCalledWith(
      "https://capture.example/r/0123456789abcdef",
      expect.objectContaining({ score: expect.any(Number), wave: expect.any(Number) }),
    );
  });

  it("uploads once when a share action finds no existing automatic session", async () => {
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    mocks.createRunShareLink.mockResolvedValueOnce({ ok: false, reason: "http", status: 404 }).mockResolvedValueOnce({
      ok: true,
      shareId: "0123456789abcdef",
      shareUrl: "https://capture.example/r/0123456789abcdef",
    });
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: captureQueue(),
    });
    const runtime = internals(game);
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    document.getElementById("progression-button")!.click();
    document.getElementById("run-recap-panel")!.innerHTML = "<button data-run-recap-share>Share Run</button>";
    const recapCall = mocks.showRunRecap.mock.calls[mocks.showRunRecap.mock.calls.length - 1];
    const callbacks = recapCall?.[1] as { onShareRun?: () => Promise<void> };
    await callbacks.onShareRun?.();

    expect(mocks.createRunShareLink).toHaveBeenCalledTimes(2);
    expect(mocks.uploadSession).toHaveBeenCalledTimes(1);
    expect(mocks.presentRunShareSheet).toHaveBeenCalledTimes(1);
  });

  it("embeds recap feedback in the first manual upload instead of submitting twice", async () => {
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: captureQueue(),
    });
    const runtime = internals(game);
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    document.getElementById("progression-button")!.click();
    const callbacks = mocks.showRunRecap.mock.calls[mocks.showRunRecap.mock.calls.length - 1]?.[1] as {
      onFeedback?: (emoji: string) => Promise<{ ok: boolean; message: string }>;
    };
    await expect(callbacks.onFeedback?.("🔥")).resolves.toEqual({ ok: true, message: "Feedback saved" });
    expect(mocks.uploadSession).toHaveBeenCalledOnce();
    expect(mocks.uploadSession.mock.calls[0][0].meta.feedbackEmoji).toBe("🔥");
    expect(mocks.submitRunFeedback).not.toHaveBeenCalled();
  });

  it("mutates an already uploaded recap without uploading the session twice", async () => {
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    localStorage.setItem("dmc.capture.auto-upload-sessions.v1.staging", "true");
    const uploadedQueue = captureQueue();
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: uploadedQueue,
    });
    const runtime = internals(game);
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 1200, wave: 3, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(mocks.uploadSession).toHaveBeenCalledOnce());
    document.getElementById("progression-button")!.click();
    const callbacks = mocks.showRunRecap.mock.calls[mocks.showRunRecap.mock.calls.length - 1]?.[1] as {
      onFeedback?: (emoji: string) => Promise<{ ok: boolean; message: string }>;
    };
    await expect(callbacks.onFeedback?.("👍")).resolves.toEqual({ ok: true, message: "Feedback saved" });
    expect(mocks.submitRunFeedback).toHaveBeenCalledOnce();
    expect(mocks.uploadSession).toHaveBeenCalledOnce();
  });

  it("edits emoji feedback into an offline queue in place", async () => {
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    localStorage.setItem("dmc.capture.auto-upload-sessions.v1.staging", "true");
    const queued = captureQueue();
    queued.setFeedbackEmoji = vi.fn(async () => ({ found: true, count: 1, rawBytes: 100 }));
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const queuedGame = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: queued,
    });
    const queuedRuntime = internals(queuedGame);
    queuedRuntime.initGame();
    queuedRuntime.gameRef.current!.state = "gameover";
    mocks.uploadSession.mockResolvedValueOnce({ ok: false, reason: "network" });
    queuedRuntime.handleSimEvent("gameOver", { score: 900, wave: 2, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(queued.enqueue).toHaveBeenCalledOnce());
    document.getElementById("progression-button")!.click();
    const callbacks = mocks.showRunRecap.mock.calls[mocks.showRunRecap.mock.calls.length - 1]?.[1] as {
      onFeedback?: (emoji: string) => Promise<{ ok: boolean; message: string }>;
    };
    await expect(callbacks.onFeedback?.("😕")).resolves.toEqual({ ok: true, message: "Saved for upload" });
    expect(queued.setFeedbackEmoji).toHaveBeenCalledWith(expect.any(String), "😕");
  });

  it("queues only retryable automatic failures and surfaces terminal auth", async () => {
    const queue = captureQueue();
    localStorage.setItem("dmc.capture.remote-consent.v1.staging", "granted");
    localStorage.setItem("dmc.capture.auto-upload-sessions.v1.staging", "true");
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({
      canvas,
      renderer,
      captureConfig: { channel: "staging", endpoint: "https://capture.example" },
      captureQueue: queue,
    });
    const runtime = internals(game);
    await vi.waitFor(() => expect(queue.drain).toHaveBeenCalledTimes(1));

    mocks.uploadSession.mockResolvedValueOnce({ ok: false, reason: "network" });
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 100, wave: 1, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(queue.enqueue).toHaveBeenCalledTimes(1));
    expect(document.getElementById("option-capture-auto-meta")!.textContent).toBe("Queued • 1");
    expect(document.getElementById("capture-upload-indicator")!).toMatchObject({
      textContent: "1 upload queued",
      dataset: expect.objectContaining({ state: "queued" }),
    });

    vi.advanceTimersByTime(1);
    mocks.uploadSession.mockResolvedValueOnce({ ok: false, reason: "auth", status: 401 });
    runtime.initGame();
    runtime.gameRef.current!.state = "gameover";
    runtime.handleSimEvent("gameOver", { score: 200, wave: 1, stats: createEmptyGameStats() });
    await vi.waitFor(() => expect(mocks.uploadSession).toHaveBeenCalledTimes(2));
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(document.getElementById("option-capture-auto-meta")!.textContent).toBe("Failed • auth");
    expect(document.getElementById("capture-upload-indicator")!).toMatchObject({
      textContent: "Auto-upload needs attention",
      dataset: expect.objectContaining({ state: "error" }),
    });
  });

  it("lets the replay runner open the shop after the bonus UI completes", () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer });
    const runtime = internals(game);
    runtime.initGame();
    runtime.setScreen("playing");
    runtime.replayActive = true;
    const state = runtime.gameRef.current!;
    state.waveComplete = true;
    state._bonusScreenStarted = true;

    runtime.handleSimEvent("waveBonusStart", {
      wave: state.wave,
      buildings: state.buildings.length,
      missileKills: 0,
      droneKills: 0,
      destroyedByType: {},
      multiShots: 0,
      maxCombo: 1,
    });
    const bonusCall = mocks.showBonusScreen.mock.calls[mocks.showBonusScreen.mock.calls.length - 1];
    const onComplete = bonusCall[2] as () => void;
    onComplete();

    expect(state._bonusScreenDone).toBe(true);
    expect(state.shopOpened).not.toBe(true);
    expect(runtime.shopOpen).toBe(false);
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

  it("stamps an install id that outlives the run it was captured in", async () => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    const game = new Game({ canvas, renderer });
    const runtime = internals(game);
    runtime.initGame();
    runtime.setScreen("playing");

    await runtime.captureNow("manual");
    const { installId, runId } = lastCapturedEnvelope().meta;
    expect(installId).toMatch(/^[a-z0-9-]{8,64}$/);

    vi.advanceTimersByTime(1);
    runtime.initGame();
    await runtime.captureNow("manual");
    const next = lastCapturedEnvelope();
    // A new run, so a new runId — but the same install behind both.
    expect(next.meta.runId).not.toBe(runId);
    expect(next.meta.installId).toBe(installId);
  });
});
