// Game controller — owns canvas, game loop, input, screen state
// Replaces App.tsx (no React)

import SFX from "./sound";
import {
  CANVAS_H,
  CANVAS_W,
  GROUND_Y,
  fireInterceptor,
  getAmmoCapacity,
  getLauncherBurstChargeCap,
  getLauncherReloadTicks,
  setRng,
} from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameScreen } from "./game-renderer";
import { DEBUG_START_PRESETS, applyDebugStartPreset, getDebugStartPreset, type DebugStartPreset } from "./debug-starts";
import { mulberry32 } from "./headless/rng";
import {
  bufferPlayerFire,
  consumeBufferedPlayerFire,
  createPlayerFireLimiterState,
  getBufferedPlayerFire,
  getPlayerBurstChargeCount,
  resetPlayerFireLimiter,
  spendPlayerBurstCharge,
  syncPlayerFireLimiter,
} from "./player-fire-limiter";
import { buildReplayCheckpoint } from "./replay-debug";
import {
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  buyDraftUpgrade as simBuyDraftUpgrade,
  closeShop as simCloseShop,
  fireEmp as simFireEmp,
  snapshotPositions,
} from "./game-sim";
import { buildShopEntries } from "./game-sim-shop";
import {
  applyRunSummaryToProgression,
  getPurchaseDisplayName,
  loadUpgradeProgression,
  saveUpgradeProgression,
} from "./game-sim-upgrades";
import { createReplayRunner } from "./replay";
import type { GameState, ReplayData } from "./types";
import {
  showShop as uiShowShop,
  hideShop as uiHideShop,
  showBonusScreen,
  hideBonusScreen,
  showGameOver as uiShowGameOver,
  showUpgradeProgression as uiShowUpgradeProgression,
  hideUpgradeProgression as uiHideUpgradeProgression,
  updateHud,
  cacheHudElements,
  updateTransientOverlays,
  cacheTransientOverlayElements,
} from "./ui";
import type { HudSnapshot, ShopData, TransientOverlaySnapshot, UpgradeProgressionViewData } from "./ui";

// ─── Window globals for bot/replay tooling ──────────────────────────

declare global {
  interface Window {
    __gameRef?: { current: GameState | null };
    __loadReplay?: (replayData: ReplayData) => void;
    __lastReplay?: ReplayData | null;
    __createReplayRunner?: typeof createReplayRunner;
    __openShopPreview?: () => boolean;
  }
}

// ─── Constants ──────────────────────────────────────────────────────

const REPLAY_CHECKPOINT_INTERVAL = 60;
const HUD_REFRESH_MS = 120;

// ─── Helpers ────────────────────────────────────────────────────────

function maybeRecordReplayCheckpoint(
  game: GameState,
  opts: { force?: boolean; reason?: string | null; tickOverride?: number | null } = {},
) {
  if (!game || !game._replayCheckpoints) return;
  const tick = opts.tickOverride ?? game._replayTick ?? 0;
  if (!opts.force && tick - (game._replayCheckpointLastTick ?? -Infinity) < REPLAY_CHECKPOINT_INTERVAL) return;
  const checkpoint = buildReplayCheckpoint(game, tick, opts.reason ?? null);
  if (!opts.force && checkpoint.hash === game._replayCheckpointLastHash) return;
  game._replayCheckpoints.push(checkpoint);
  game._replayCheckpointLastTick = tick;
  game._replayCheckpointLastHash = checkpoint.hash;
}

function buildHudSnapshot(game: GameState | null): HudSnapshot {
  if (!game) {
    return {
      score: 0,
      combo: 1,
      wave: 1,
      waveProgress: 0,
      burjHealth: 5,
      burjAlive: true,
      fps: 0,
      rafFps: 0,
      rafFrameMs: 0,
      ammo: [0, 0, 0],
      ammoMax: 0,
      launcherHP: [0, 0, 0],
      empCharge: 0,
      empChargeMax: 0,
      empReady: false,
    };
  }
  const ammoMax = getAmmoCapacity(game.wave, game.upgrades.launcherKit);
  const waveSpawnTotal = game.schedule?.length ?? 0;
  const waveSpawned = waveSpawnTotal > 0 ? Math.min(game.scheduleIdx, waveSpawnTotal) : 0;
  const waveProgress = waveSpawnTotal > 0 ? Math.round((waveSpawned / waveSpawnTotal) * 100) : 0;
  return {
    score: game.score,
    combo: game.combo,
    wave: game.wave,
    waveProgress,
    burjHealth: game.burjHealth,
    burjAlive: game.burjAlive,
    fps: game._fpsDisplay || 0,
    rafFps: game._rafFps || 0,
    rafFrameMs: game._rafDeltaMs || 0,
    ammo: [...game.ammo],
    ammoMax,
    launcherHP: [...game.launcherHP],
    empCharge: game.empCharge,
    empChargeMax: game.empChargeMax,
    empReady: game.empReady,
  };
}

function emptyTransientOverlaySnapshot(titleCopyVisible = false): TransientOverlaySnapshot {
  return {
    titleCopyVisible,
    mirvWarning: { visible: false, alpha: 0 },
    purchaseToast: { visible: false, text: "", alpha: 0 },
    lowAmmoWarning: { visible: false, text: "LOW AMMO", alpha: 0 },
    waveClearedBanner: { visible: false, text: "", alpha: 0 },
    multiKillToast: {
      visible: false,
      label: "",
      bonus: 0,
      x: CANVAS_W / 2,
      y: 200,
      alpha: 0,
      scale: 1,
      tier: "normal",
    },
    comboToast: {
      visible: false,
      text: "",
      x: CANVAS_W / 2,
      y: 200,
      alpha: 0,
      scale: 1,
      tier: "warm",
    },
  };
}

function formatPurchaseToast(game: GameState): string {
  const toast = game._purchaseToast;
  if (!toast || toast.timer <= 0) return "";
  const counts: Record<string, number> = {};
  for (const item of toast.items.map((key) => getPurchaseDisplayName(key))) {
    counts[item] = (counts[item] || 0) + 1;
  }
  const label = Object.entries(counts)
    .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
    .join(", ");
  const who = game._replayIsHuman ? "PLAYER" : "BOT";
  return `${who} BOUGHT: ${label}`;
}

function buildTransientOverlaySnapshot(game: GameState | null, screen: GameScreen): TransientOverlaySnapshot {
  const snapshot = emptyTransientOverlaySnapshot(screen === "title");
  if (!game || screen !== "playing") return snapshot;

  const activeMirvs = game.missiles.some((missile) => missile.alive && missile.type === "mirv");
  if (activeMirvs) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.15);
    snapshot.mirvWarning = { visible: true, alpha: 0.6 + pulse * 0.4 };
  }

  const purchaseText = formatPurchaseToast(game);
  if (purchaseText && game._purchaseToast) {
    snapshot.purchaseToast = {
      visible: true,
      text: purchaseText,
      alpha: Math.min(1, game._purchaseToast.timer / 30),
    };
  }

  if ((game._lowAmmoTimer ?? 0) > 0) {
    snapshot.lowAmmoWarning = {
      visible: true,
      text: "LOW AMMO",
      alpha: Math.min(1, (game._lowAmmoTimer ?? 0) / 20),
    };
  }

  if (game.waveComplete && (game.waveClearedTimer ?? 0) > 0) {
    snapshot.waveClearedBanner = {
      visible: true,
      text: `WAVE ${game.wave} CLEARED`,
      alpha: Math.min(1, (game.waveClearedTimer ?? 0) / 20),
    };
  }

  if (game.multiKillToast && game.multiKillToast.timer > 0) {
    const toast = game.multiKillToast;
    const rise = (90 - toast.timer) * 0.5;
    const label = toast.label ?? "";
    snapshot.multiKillToast = {
      visible: true,
      label,
      bonus: toast.bonus,
      x: toast.x ?? CANVAS_W / 2,
      y: (toast.y ?? 200) - 36 - rise,
      alpha: Math.min(1, toast.timer / 20),
      scale: 1 + (toast.pulse ?? 0) * 0.18,
      tier: label === "MEGA KILL" ? "mega" : label === "TRIPLE KILL" ? "triple" : "normal",
    };
  }

  if (game.comboToast && game.comboToast.timer > 0) {
    const toast = game.comboToast;
    const rise = (70 - toast.timer) * 0.38;
    const isMax = toast.multiplier >= 10;
    snapshot.comboToast = {
      visible: true,
      text: isMax ? "10\u00d7 COMBO!" : `${toast.multiplier}\u00d7`,
      x: toast.x,
      y: toast.y - rise,
      alpha: Math.min(1, toast.timer / 15),
      scale: 1 + toast.pulse * 0.24,
      tier: toast.multiplier >= 8 ? "critical" : toast.multiplier >= 5 ? "hot" : "warm",
    };
  }

  return snapshot;
}

function buildShopDataFromGame(game: GameState): ShopData {
  return {
    score: game.score,
    wave: game.wave,
    entries: buildShopEntries(game),
    burjHealth: game.burjHealth,
    draftMode: game._draftMode,
  };
}

interface GameOptions {
  canvas: HTMLCanvasElement;
  renderer: GameRenderer;
  onScreenChange?: (screen: GameScreen) => void;
  onFrameSample?: (sample: GameFrameSample) => void;
  onReplayFinished?: (sample: GameReplayFinishedSample) => void;
}

export interface GameFrameSample {
  screen: GameScreen;
  replayActive: boolean;
  tick: number;
  frameMs: number;
  gpuMs?: number;
  missiles: number;
  drones: number;
  interceptors: number;
  particles: number;
  explosions: number;
}

export interface GameReplayFinishedSample {
  score: number;
  tick: number;
  wave: number;
}

// ─── Game Controller ────────────────────────────────────────────────

export class Game {
  // DOM elements
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;
  private onScreenChange?: (screen: GameScreen) => void;
  private onFrameSample?: (sample: GameFrameSample) => void;
  private onReplayFinished?: (sample: GameReplayFinishedSample) => void;
  private shell: HTMLElement;
  private battlefieldCard: HTMLElement;
  private hudEl: HTMLElement;
  private titleOverlay: HTMLElement;
  private titleProgressionButton: HTMLElement;
  private titleStartButton: HTMLButtonElement;
  private gameoverPanel: HTMLElement;
  private progressionPanel: HTMLElement;
  private progressionButton: HTMLElement;
  private titleMenuButton: HTMLElement;
  private replayButton: HTMLElement;
  private retryButton: HTMLElement;
  private empButton: HTMLButtonElement;
  private optionsButton: HTMLElement;
  private titleOptionsButton: HTMLElement;
  private optionsMenu: HTMLElement;
  private debugStartsEl: HTMLElement;
  private perfOverlay: HTMLElement;

  // Game state
  private gameRef: { current: GameState | null } = { current: null };
  private screen: GameScreen = "title";
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private replayRunner: ReturnType<typeof createReplayRunner> | null = null;
  private shopBought: string[] = [];
  private pointerId: number | null = null;
  private hudRefreshTime = 0;
  private draftMode = true;
  private playerFireState = createPlayerFireLimiterState();

  // UI state
  private muted = false;
  private showColliders = false;
  private showPerfOverlay = false;
  private showOptionsMenu = false;
  private shopOpen = false;
  private replayActive = false;
  private bonusActive = false;
  private progressionOpen = false;

  // Final stats for game over
  private finalScore = 0;
  private finalWave = 1;
  private finalStats = { missileKills: 0, droneKills: 0, shotsFired: 0 };
  private lastReplay: ReplayData | null = null;

  constructor({ canvas, renderer, onScreenChange, onFrameSample, onReplayFinished }: GameOptions) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onScreenChange = onScreenChange;
    this.onFrameSample = onFrameSample;
    this.onReplayFinished = onReplayFinished;
    this.shell = document.getElementById("game-shell")!;
    this.battlefieldCard = document.getElementById("battlefield-card")!;
    this.hudEl = document.getElementById("battlefield-hud")!;
    this.titleOverlay = document.getElementById("title-overlay")!;
    this.titleProgressionButton = document.getElementById("title-progression-button")!;
    this.titleStartButton = document.getElementById("title-start-button") as HTMLButtonElement;
    this.gameoverPanel = document.getElementById("gameover-panel")!;
    this.progressionPanel = document.getElementById("progression-panel")!;
    this.progressionButton = document.getElementById("progression-button")!;
    this.titleMenuButton = document.getElementById("title-menu-button")!;
    this.replayButton = document.getElementById("replay-button")!;
    this.retryButton = document.getElementById("retry-button")!;
    this.empButton = document.getElementById("emp-button") as HTMLButtonElement;
    this.optionsButton = document.getElementById("options-button")!;
    this.titleOptionsButton = document.getElementById("title-options-button")!;
    this.optionsMenu = document.getElementById("options-menu")!;
    this.debugStartsEl = document.getElementById("debug-starts")!;
    this.perfOverlay = document.getElementById("perf-overlay")!;

    cacheHudElements();
    cacheTransientOverlayElements();
    this.renderDebugStartOptions();
    this.bindEvents();
    this.setupWindowGlobals();
    this.setScreen("title");
    this.startRenderLoop();
  }

  // ─── Events ─────────────────────────────────────────────────────

  private bindEvents(): void {
    // Canvas events — canvas pointerdown handles title-screen start + in-game firing
    this.canvas.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.handlePointerUp(e));

    // Keyboard
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));

    // Drag-and-drop replay files
    this.battlefieldCard.addEventListener("dragover", (e) => e.preventDefault());
    this.battlefieldCard.addEventListener("drop", (e) => this.handleDrop(e));

    // Buttons
    this.titleStartButton.addEventListener("click", (event) => {
      event.preventDefault();
      void this.startGame();
    });
    this.retryButton.addEventListener("click", () => void this.startGame());
    this.titleMenuButton.addEventListener("click", () => this.returnToTitle());
    this.progressionButton.addEventListener("click", () => this.openProgression());
    this.replayButton.addEventListener("click", () => {
      if (this.lastReplay) {
        this.replayActive = false;
        void this.startReplay(this.lastReplay);
      }
    });
    this.empButton.addEventListener("click", () => this.fireEmp());
    this.optionsButton.addEventListener("click", () => this.toggleOptionsMenu());
    this.titleOptionsButton.addEventListener("click", () => this.toggleOptionsMenu());
    document.getElementById("option-sound")!.addEventListener("click", () => void this.toggleMute());
    document.getElementById("option-debug")!.addEventListener("click", () => this.toggleDebug());
    document.getElementById("option-perf")!.addEventListener("click", () => this.togglePerf());
    this.debugStartsEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-debug-start-id]");
      if (!button) return;
      event.preventDefault();
      void this.startDebugStart(button.dataset.debugStartId ?? "");
    });

    // Resize
    window.addEventListener("resize", () => this.updateCompactClass());
    window.addEventListener("orientationchange", () => this.updateCompactClass());
    this.updateCompactClass();
  }

  private setupWindowGlobals(): void {
    window.__gameRef = this.gameRef;
    window.__createReplayRunner = createReplayRunner;
    window.__loadReplay = (data) => void this.startReplay(data);
    window.__lastReplay = this.lastReplay;
    window.__openShopPreview = () => {
      const game = this.gameRef.current;
      if (!game) return false;
      game.state = "shop";
      this.openShop(game);
      return true;
    };
  }

  private updateCompactClass(): void {
    const compact = window.innerHeight <= 760;
    this.shell.classList.toggle("game-shell--compactPortrait", compact);
    this.renderer.resize();
  }

  private clearPointerCapture(): void {
    if (this.pointerId === null) return;
    try {
      this.canvas.releasePointerCapture(this.pointerId);
    } catch {
      // Pointer may already be released or no longer active.
    }
    this.pointerId = null;
  }

  private resetPlayerFireState(): void {
    resetPlayerFireLimiter(this.playerFireState);
  }

  // ─── Screen Management ──────────────────────────────────────────

  private setScreen(s: GameScreen): void {
    this.screen = s;
    this.shell.dataset.screen = s;

    // Toggle visibility of screen-specific elements
    this.hudEl.hidden = s !== "playing";
    this.titleOverlay.hidden = s !== "title";
    this.titleOverlay.setAttribute("aria-hidden", s === "title" ? "false" : "true");
    this.titleProgressionButton.hidden = true;
    this.gameoverPanel.hidden = s !== "gameover" || this.progressionOpen;
    this.progressionPanel.hidden = !this.progressionOpen || s !== "gameover";
    this.battlefieldCard.classList.toggle("battlefield-card--portraitSky", s === "playing");
    if (s === "title") {
      void SFX.playTitleTheme();
    } else {
      SFX.stopTitleTheme();
    }

    if (s !== "gameover") {
      this.progressionOpen = false;
      uiHideUpgradeProgression();
      this.progressionPanel.hidden = true;
    }

    if (s === "gameover") {
      uiShowGameOver(this.finalScore, this.finalWave, this.finalStats);
      this.replayButton.hidden = !this.lastReplay;
    }
    this.syncTransientOverlays();
    this.onScreenChange?.(s);
  }

  // ─── Game Lifecycle ─────────────────────────────────────────────

  private renderDebugStartOptions(): void {
    this.debugStartsEl.replaceChildren(
      ...DEBUG_START_PRESETS.map((preset) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "battlefield-debug-starts__button";
        button.dataset.debugStartId = preset.id;
        button.textContent = `W${preset.wave}`;
        button.setAttribute("aria-label", `Start ${preset.label}`);
        return button;
      }),
    );
  }

  private initGame(debugStart?: DebugStartPreset): void {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    setRng(mulberry32(seed));
    this.gameRef.current = simInitGame();
    const game = this.gameRef.current;
    game.metaProgression = loadUpgradeProgression();
    simBuyUpgrade(game, "wildHornets");
    simBuyUpgrade(game, "emp");
    game._gameSeed = seed;
    game._draftMode = this.draftMode;
    game._actionLog = [];
    game._replayTick = 0;
    game._replayCheckpoints = [];
    game._replayCheckpointLastTick = -Infinity;
    game._replayCheckpointLastHash = null;
    if (debugStart) {
      applyDebugStartPreset(game, debugStart);
    }
    maybeRecordReplayCheckpoint(game, { force: true, reason: debugStart ? `debugStart:${debugStart.id}` : "start" });
    this.shopBought = [];
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    this.optionsMenu.hidden = true;
    this.syncOptionsButtons();
    this.perfOverlay.hidden = true;
    window.__gameRef = this.gameRef;
  }

  private async startGame(): Promise<void> {
    await SFX.init();
    SFX.prewarm();
    this.clearPointerCapture();
    this.resetPlayerFireState();
    this.initGame();
    this.replayActive = false;
    this.shopOpen = false;
    this.bonusActive = false;
    this.progressionOpen = false;
    uiHideShop();
    uiHideUpgradeProgression();
    hideBonusScreen();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.add("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    this.setScreen("playing");
    SFX.gameStart();
  }

  private async startDebugStart(presetId: string): Promise<void> {
    if (this.screen !== "title") return;
    const preset = getDebugStartPreset(presetId);
    if (!preset) return;
    await SFX.init();
    SFX.prewarm();
    this.clearPointerCapture();
    this.resetPlayerFireState();
    this.initGame(preset);
    this.replayActive = false;
    this.shopOpen = false;
    this.bonusActive = false;
    this.progressionOpen = false;
    this.showOptionsMenu = false;
    uiHideShop();
    uiHideUpgradeProgression();
    hideBonusScreen();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.add("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    this.optionsMenu.hidden = true;
    this.syncOptionsButtons();
    this.setScreen("playing");
    SFX.gameStart();
  }

  private returnToTitle(): void {
    this.clearPointerCapture();
    this.resetPlayerFireState();
    if (this.replayRunner) {
      this.replayRunner.cleanup();
      this.replayRunner = null;
    }
    this.replayActive = false;
    this.shopOpen = false;
    this.bonusActive = false;
    this.progressionOpen = false;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    uiHideShop();
    uiHideUpgradeProgression();
    hideBonusScreen();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.remove("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    this.optionsMenu.hidden = true;
    this.perfOverlay.hidden = true;
    this.syncOptionsButtons();
    this.setScreen("title");
  }

  private async startReplay(replayData: ReplayData): Promise<void> {
    await SFX.init();
    SFX.prewarm();
    this.clearPointerCapture();
    this.resetPlayerFireState();
    if (this.replayRunner) {
      this.replayRunner.cleanup();
      this.replayRunner = null;
    }
    const runner = createReplayRunner(replayData, (type, data) => this.handleSimEvent(type, data));
    const replayGameState = runner.init();
    this.gameRef.current = replayGameState;
    if (replayGameState) {
      replayGameState._replay = true;
      replayGameState._replayIsHuman = !!replayData.isHuman;
      replayGameState._showColliders = false;
    }
    window.__gameRef = this.gameRef;
    this.replayRunner = runner;
    this.replayActive = true;
    this.shopOpen = false;
    this.progressionOpen = false;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    uiHideShop();
    uiHideUpgradeProgression();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.add("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    this.setScreen("playing");
  }

  async loadReplay(replayData: ReplayData): Promise<void> {
    await this.startReplay(replayData);
  }

  // ─── Sim Events ─────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSimEvent(type: string, data: any): void {
    if (type === "sfx") {
      const sfxMap: Record<string, (() => void) | undefined> = {
        explosion: () => SFX.explosion(data.size),
        chainExplosion: () => SFX.chainExplosion(data.size, data.chainLevel),
        mirvIncoming: () => SFX.mirvIncoming(),
        mirvSplit: () => SFX.mirvSplit(),
        planeIncoming: () => SFX.planeIncoming(),
        planePass: () => SFX.planePass(),
        hornetBuzz: () => SFX.hornetBuzz(),
        patriotLaunch: () => SFX.patriotLaunch(),
        laserBeam: () => {
          const game = this.gameRef.current;
          if (game && !game._browserLaserHandle) {
            game._browserLaserHandle = SFX.laserBeam();
          }
        },
        waveCleared: () => SFX.waveCleared(),
        gameOver: () => SFX.gameOver(),
        burjHit: () => SFX.burjHit(),
        launcherDestroyed: () => SFX.launcherDestroyed(),
        empBlast: () => SFX.empBlast(),
        multiKill: () => SFX.multiKill(),
      };
      sfxMap[data.name]?.();
    } else if (type === "gameOver") {
      this.clearPointerCapture();
      this.resetPlayerFireState();
      this.shopOpen = false;
      this.progressionOpen = false;
      this.showOptionsMenu = false;
      this.showColliders = false;
      this.showPerfOverlay = false;
      uiHideShop();
      uiHideUpgradeProgression();
      this.battlefieldCard.classList.remove("battlefield-card--blurred");
      this.optionsMenu.hidden = true;
      this.perfOverlay.hidden = true;
      this.finalScore = data.score;
      this.finalWave = data.wave;
      this.finalStats = { ...data.stats };
      // Replay runs finalize on the next RAF tick after the runner marks itself finished.
      if (this.replayActive && this.replayRunner) {
        return;
      }
      const game = this.gameRef.current;
      if (game) {
        const nextProgression = applyRunSummaryToProgression(game.metaProgression, {
          wave: data.wave,
          score: data.score,
          stats: data.stats,
        });
        game.metaProgression = nextProgression;
        saveUpgradeProgression(nextProgression);
      }
      this.canvas.classList.remove("game-canvas--active");
      if (game && game._actionLog) {
        maybeRecordReplayCheckpoint(game, {
          force: true,
          reason: "gameover",
          tickOverride: (game._replayTick ?? 0) + 1,
        });
        const replay: ReplayData = {
          version: 2,
          seed: game._gameSeed ?? 0,
          actions: game._actionLog as ReplayData["actions"],
          checkpoints: game._replayCheckpoints || [],
          finalTick: (game._replayTick ?? 0) + 1,
          isHuman: true,
          draftMode: game._draftMode !== false,
        };
        this.lastReplay = replay;
        window.__lastReplay = replay;
        fetch("/api/save-replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...replay, score: data.score, wave: data.wave, stats: data.stats }),
        }).catch(() => {});
      }
      setRng(Math.random);
      this.setScreen("gameover");
    } else if (type === "waveBonusStart") {
      this.resetPlayerFireState();
      this.bonusActive = true;
      this.canvas.style.pointerEvents = "none";
      showBonusScreen(
        data,
        (pts) => {
          const game = this.gameRef.current;
          if (game) game.score += pts;
          this.syncHud(true);
        },
        () => {
          const game = this.gameRef.current;
          if (game) game._bonusScreenDone = true;
          this.bonusActive = false;
          this.canvas.style.pointerEvents = "";
          hideBonusScreen();
        },
      );
    } else if (type === "shopOpen") {
      const game = this.gameRef.current;
      if (game) {
        maybeRecordReplayCheckpoint(game, {
          force: true,
          reason: "shopOpen",
          tickOverride: (game._replayTick ?? 0) + 1,
        });
        this.openShop(game);
      }
    }
  }

  // ─── Shop ───────────────────────────────────────────────────────

  private openShop(game: GameState): void {
    const shopData = buildShopDataFromGame(game);
    this.resetPlayerFireState();
    this.shopOpen = true;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.optionsMenu.hidden = true;
    this.battlefieldCard.classList.add("battlefield-card--blurred");
    this.syncHud(true);

    uiShowShop(
      shopData,
      (key: string) => this.buyUpgrade(key),
      () => this.closeShop(),
    );
  }

  private buyUpgrade(key: string): void {
    const game = this.gameRef.current;
    if (!game) return;
    const isDraft = game._draftMode;
    const ok = isDraft ? simBuyDraftUpgrade(game, key) : simBuyUpgrade(game, key);
    if (ok) {
      SFX.buyUpgrade();
      this.shopBought.push(key);
      this.syncHud(true);
    }
  }

  private closeShop(): void {
    const game = this.gameRef.current;
    if (!game) return;
    if (game._actionLog) {
      game._actionLog.push({ tick: game._replayTick ?? 0, type: "shop", bought: [...this.shopBought] });
    }
    this.shopBought = [];
    simCloseShop(game);
    this.shopOpen = false;
    uiHideShop();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.syncHud(true);
  }

  private buildProgressionData(): UpgradeProgressionViewData {
    const game = this.gameRef.current;
    return {
      progression: game?.metaProgression ?? loadUpgradeProgression(),
      ownedNodes: game?.ownedUpgradeNodes ?? new Set(),
    };
  }

  private openProgression(): void {
    if (this.screen !== "gameover" || this.shopOpen) return;
    this.progressionOpen = true;
    this.gameoverPanel.hidden = false;
    this.progressionPanel.hidden = false;
    uiShowUpgradeProgression(this.buildProgressionData(), () => this.closeProgression());
  }

  private closeProgression(): void {
    this.progressionOpen = false;
    uiHideUpgradeProgression();
    this.progressionPanel.hidden = true;
    if (this.screen === "gameover") this.gameoverPanel.hidden = false;
  }

  // ─── Input Handling ─────────────────────────────────────────────

  private getCanvasCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (clientY - rect.top) * (CANVAS_H / rect.height);
    return { x, y };
  }

  private launchPlayerShot(game: GameState, x: number, y: number, silentOnFail = false): boolean {
    if (y >= GROUND_Y - 20) return false;
    const tick = game._replayTick ?? 0;
    if (!fireInterceptor(game, x, y, tick, true)) {
      if (!silentOnFail) SFX.emptyClick();
      return false;
    }
    SFX.fire();
    if (game._actionLog) game._actionLog.push({ tick, type: "fire", x, y, ignoreLauncherReload: true });
    return true;
  }

  private getActiveLauncherCount(game: GameState): number {
    let count = 0;
    for (let i = 0; i < game.launcherHP.length; i++) {
      if (game.launcherHP[i] > 0) count++;
    }
    return count;
  }

  private requestPlayerFire(game: GameState, x: number, y: number): void {
    if (y >= GROUND_Y - 20) return;
    const tick = game._replayTick ?? 0;
    const activeLauncherCount = this.getActiveLauncherCount(game);
    const reloadTicks = getLauncherReloadTicks(game);
    const burstChargeCap = getLauncherBurstChargeCap(game, activeLauncherCount);
    syncPlayerFireLimiter(this.playerFireState, tick, burstChargeCap, reloadTicks);
    if (activeLauncherCount <= 0) {
      SFX.emptyClick();
      return;
    }
    if (getPlayerBurstChargeCount(this.playerFireState) <= 0) {
      bufferPlayerFire(this.playerFireState, { x, y });
      return;
    }
    if (this.launchPlayerShot(game, x, y, true)) {
      spendPlayerBurstCharge(this.playerFireState, tick, reloadTicks);
    } else {
      bufferPlayerFire(this.playerFireState, { x, y });
    }
  }

  private releaseBufferedPlayerFire(game: GameState): void {
    const tick = game._replayTick ?? 0;
    const activeLauncherCount = this.getActiveLauncherCount(game);
    const reloadTicks = getLauncherReloadTicks(game);
    const burstChargeCap = getLauncherBurstChargeCap(game, activeLauncherCount);
    syncPlayerFireLimiter(this.playerFireState, tick, burstChargeCap, reloadTicks);
    const bufferedShot = getBufferedPlayerFire(this.playerFireState);
    if (!bufferedShot) return;
    if (getPlayerBurstChargeCount(this.playerFireState) <= 0) return;
    if (!this.launchPlayerShot(game, bufferedShot.x, bufferedShot.y, true)) return;
    consumeBufferedPlayerFire(this.playerFireState);
    spendPlayerBurstCharge(this.playerFireState, tick, reloadTicks);
  }

  private async handlePointerDown(e: PointerEvent): Promise<void> {
    if (this.shopOpen || this.replayActive) return;
    const point = this.getCanvasCoords(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    if (this.screen === "title") {
      await this.startGame();
      return;
    }
    if (this.screen === "gameover") return;
    const game = this.gameRef.current;
    if (!game || game.state !== "playing") return;
    game.crosshairX = point.x;
    game.crosshairY = point.y;
    this.syncHud(true);
    if (e.pointerType !== "mouse") {
      this.pointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
    }
    this.requestPlayerFire(game, point.x, point.y);
  }

  private handlePointerMove(e: PointerEvent): void {
    const point = this.getCanvasCoords(e.clientX, e.clientY);
    if (!point) return;
    if (this.screen === "title" || this.screen !== "playing") return;
    const game = this.gameRef.current;
    if (!game) return;
    if (e.pointerType !== "mouse" && e.buttons === 0 && this.pointerId !== e.pointerId) return;
    game.crosshairX = point.x;
    game.crosshairY = point.y;
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.pointerId === e.pointerId) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.pointerId = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.screen !== "playing" || this.shopOpen || this.replayActive) return;
    const game = this.gameRef.current;
    if (!game || game.state !== "playing") return;
    if (e.key === " ") {
      e.preventDefault();
      this.fireEmp();
      return;
    }
    if (game.crosshairY < GROUND_Y - 20) {
      this.requestPlayerFire(game, game.crosshairX, game.crosshairY);
    }
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result as string);
      } catch {
        console.warn("Dropped file is not valid JSON");
        return;
      }
      if (data.seed !== undefined && Array.isArray(data.actions)) {
        void this.startReplay(data);
      }
    };
    reader.readAsText(file);
  }

  private fireEmp(): boolean {
    if (this.screen !== "playing" || this.shopOpen || this.replayActive) return false;
    const game = this.gameRef.current;
    if (!game || game.state !== "playing") return false;
    if (game.upgrades.emp > 0 && simFireEmp(game, (t, d) => this.handleSimEvent(t, d))) {
      SFX.empBlast();
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick ?? 0, type: "emp" });
      this.syncHud(true);
      return true;
    }
    return false;
  }

  // ─── Options Menu ───────────────────────────────────────────────

  private toggleOptionsMenu(): void {
    this.showOptionsMenu = !this.showOptionsMenu;
    this.optionsMenu.hidden = !this.showOptionsMenu;
    this.syncOptionsButtons();
  }

  private syncOptionsButtons(): void {
    for (const button of [this.optionsButton, this.titleOptionsButton]) {
      button.setAttribute("aria-expanded", String(this.showOptionsMenu));
      button.setAttribute("aria-label", this.showOptionsMenu ? "Close options" : "Open options");
    }
  }

  private async toggleMute(): Promise<void> {
    await SFX.init();
    SFX.mute();
    this.muted = SFX.isMuted();
    const soundBtn = document.getElementById("option-sound")!;
    soundBtn.classList.toggle("battlefield-option--active", this.muted);
    document.getElementById("option-sound-meta")!.textContent = this.muted ? "Muted" : "On";
  }

  private toggleDebug(): void {
    const game = this.gameRef.current;
    if (!game) return;
    game._showColliders = !game._showColliders;
    this.showColliders = game._showColliders;
    document.getElementById("option-debug")!.classList.toggle("battlefield-option--active", this.showColliders);
  }

  private togglePerf(): void {
    this.showPerfOverlay = !this.showPerfOverlay;
    this.perfOverlay.hidden = !this.showPerfOverlay;
    document.getElementById("option-perf")!.classList.toggle("battlefield-option--active", this.showPerfOverlay);
    document.getElementById("option-perf-meta")!.textContent = this.showPerfOverlay ? "On" : "Off";
  }

  // ─── HUD Sync ───────────────────────────────────────────────────

  private syncHud(force = false): void {
    const now = performance.now();
    if (!force && now - this.hudRefreshTime < HUD_REFRESH_MS) return;
    this.hudRefreshTime = now;
    updateHud(buildHudSnapshot(this.gameRef.current));
  }

  private syncTransientOverlays(): void {
    updateTransientOverlays(buildTransientOverlaySnapshot(this.gameRef.current, this.screen));
  }

  private tickControllerOnlyTimers(game: GameState): void {
    if (game._purchaseToast && game._purchaseToast.timer > 0) {
      game._purchaseToast.timer -= 1;
      if (game._purchaseToast.timer <= 0) game._purchaseToast = null;
    }
    if ((game._lowAmmoTimer ?? 0) > 0) {
      game._lowAmmoTimer = Math.max(0, (game._lowAmmoTimer ?? 0) - 1);
    }
  }

  private emitFrameSample(game: GameState, frameMs: number, replayActive: boolean, screen: GameScreen): void {
    this.onFrameSample?.({
      drones: game.drones.length,
      explosions: game.explosions.length,
      frameMs,
      interceptors: game.interceptors.length,
      missiles: game.missiles.length,
      particles: game.particles.length,
      replayActive,
      screen,
      tick: game._replayTick ?? 0,
    });
  }

  // ─── Render Loop ────────────────────────────────────────────────

  private startRenderLoop(): void {
    const loop = (timestamp: number) => {
      this.rafId = requestAnimationFrame(loop);

      if (this.renderer.isRenderPaused?.()) {
        this.lastTime = timestamp;
        return;
      }

      if (this.screen === "playing" && this.gameRef.current) {
        if (this.lastTime === null) this.lastTime = timestamp;
        const elapsed = timestamp - this.lastTime;
        this.lastTime = timestamp;
        const game = this.gameRef.current;
        const screenAtFrameStart = this.screen;
        const replayWasActive = this.replayActive;
        let replayFinishedSample: GameReplayFinishedSample | null = null;
        game._rafDeltaMs = elapsed;
        game._rafFps = elapsed > 0 ? 1000 / elapsed : 0;
        game._fpsFrames = (game._fpsFrames || 0) + 1;
        game._fpsAccum = (game._fpsAccum || 0) + elapsed;
        if (game._fpsAccum >= 500) {
          game._fpsDisplay = Math.round((game._fpsFrames / game._fpsAccum) * 1000);
          game._fpsFrames = 0;
          game._fpsAccum = 0;
        }
        game._timeAccum = (game._timeAccum || 0) + Math.min(elapsed / (1000 / 60), 3);

        if (this.replayRunner) {
          const runner = this.replayRunner;
          if (runner.isShopPaused()) {
            if (!game._replayShopTimer) {
              game._replayShopTimer = performance.now();
              const bought = game._replayShopBought || [];
              if (bought.length > 0) {
                game._purchaseToast = { items: [...bought], timer: 300 };
              }
              delete game._replayShopBought;
            } else if (performance.now() - game._replayShopTimer > 1000) {
              delete game._replayShopTimer;
              runner.resumeFromShop();
              this.shopOpen = false;
              uiHideShop();
              this.battlefieldCard.classList.remove("battlefield-card--blurred");
            }
          } else {
            runner.step();
          }
          if (runner.isFinished()) {
            runner.cleanup();
            this.replayRunner = null;
            this.replayActive = false;
            this.finalScore = game.score;
            this.finalWave = game.wave;
            this.finalStats = { ...game.stats };
            replayFinishedSample = {
              score: game.score,
              tick: game._replayTick ?? 0,
              wave: game.wave,
            };
            this.canvas.classList.remove("game-canvas--active");
            this.setScreen("gameover");
          }
        } else if (game.state === "playing") {
          while (game._timeAccum >= 1) {
            game._timeAccum -= 1;
            this.releaseBufferedPlayerFire(game);
            snapshotPositions(game);
            simUpdate(game, 1, (t, d) => this.handleSimEvent(t, d));
            game._replayTick = (game._replayTick ?? 0) + 1;
            if (game._actionLog && (game._replayTick ?? 0) % 3 === 0) {
              game._actionLog.push({
                tick: game._replayTick,
                type: "cursor",
                x: Math.round(game.crosshairX),
                y: Math.round(game.crosshairY),
              });
            }
            maybeRecordReplayCheckpoint(game);
            if ((game.state as string) === "gameover" || (game.state as string) === "shop") break;
          }
        } else {
          game._timeAccum = 0;
        }

        if (!game._laserHandle && game._browserLaserHandle) {
          game._browserLaserHandle.stop();
          game._browserLaserHandle = null;
        }

        const interpolationAlpha = game.state === "playing" ? (game._timeAccum ?? 0) : 1;
        this.tickControllerOnlyTimers(game);
        this.syncHud();
        this.syncTransientOverlays();
        this.renderer.renderGameplay(game, { showShop: this.shopOpen, interpolationAlpha });
        this.emitFrameSample(game, elapsed, replayWasActive, screenAtFrameStart);
        if (replayFinishedSample) {
          this.onReplayFinished?.(replayFinishedSample);
        }
      } else {
        this.lastTime = null;
        if (this.screen === "title") {
          this.syncTransientOverlays();
          this.renderer.renderTitle();
        } else if (this.screen === "gameover") {
          this.syncTransientOverlays();
          const snapshot: GameOverSnapshot = {
            score: this.finalScore,
            wave: this.finalWave,
            stats: this.finalStats,
          };
          this.renderer.renderGameOver(snapshot);
        }
      }
    };

    this.rafId = requestAnimationFrame(loop);
  }
}
