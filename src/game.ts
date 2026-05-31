// Game controller — owns canvas, game loop, input, screen state
// Replaces App.tsx (no React)

import SFX from "./sound";
import {
  CANVAS_H,
  CANVAS_W,
  GROUND_Y,
  countAliveLaunchers,
  fireInterceptor,
  getAmmoCapacity,
  getGameplayViewTransform,
  createEmptyGameStats,
  normalizeGameStats,
  setRng,
  syncFireChargeForTick,
} from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameScreen } from "./game-renderer";
import { DEBUG_START_PRESETS, applyDebugStartPreset, getDebugStartPreset, type DebugStartPreset } from "./debug-starts";
import {
  getDebugUpgradeFamilyOptions,
  loadDebugOptions,
  saveDebugOptions,
  setForceShowUpgradeFamily,
  type DebugOptions,
} from "./debug-options";
import { mulberry32 } from "./headless/rng";
import { getFireChargeCount, type BufferedPlayerShot } from "./player-fire-limiter";
import { buildReplayCheckpoint } from "./replay-debug";
import {
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  buyDraftUpgrade as simBuyDraftUpgrade,
  closeShop as simCloseShop,
  fireFlareSalvo as simFireFlareSalvo,
  fireEmp as simFireEmp,
  fireF15Pair as simFireF15Pair,
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
import { seekRunnerToTick } from "./replay-seek";
import { mountRunRecapDeathClip } from "./run-recap-death-clip";
import { handleRunRecapReplayEvent } from "./run-recap-replay-events";
import { buildRunRecapData } from "./run-recap";
import { saveReplayToFile } from "./save-replay";
import type { GameState, GameStats, ReplayAction, ReplayData, SimEvent, SimEventMap, UpgradeKey } from "./types";
import {
  showShop as uiShowShop,
  hideShop as uiHideShop,
  showBonusScreen,
  hideBonusScreen,
  showGameOver as uiShowGameOver,
  showRunRecap as uiShowRunRecap,
  hideRunRecap as uiHideRunRecap,
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
    __lastReplayResult?: GameReplayFinishedSample | null;
    __onReplayFinished?: (sample: GameReplayFinishedSample) => unknown;
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

function assertNever(value: never): never {
  throw new Error(`Unhandled sim event: ${JSON.stringify(value)}`);
}

function recordWavePlanAction(game: GameState): void {
  if (!game._actionLog) return;
  game._actionLog.push({
    tick: game._replayTick ?? 0,
    type: "wave_plan",
    wave: game.wave,
    tactics: game.waveTactics,
    style: game.commander.style,
  } satisfies ReplayAction);
}

function buildHudSnapshot(game: GameState | null): HudSnapshot {
  if (!game) {
    return {
      score: 0,
      combo: 1,
      wave: 1,
      waveProgress: 0,
      burjHealth: 7,
      burjAlive: true,
      fps: 0,
      rafFps: 0,
      rafFrameMs: 0,
      ammo: [0, 0],
      ammoMax: 0,
      launcherHP: [0, 0],
      activeFamily: null,
      activeLabel: "EMP",
      activeReady: false,
      activePhase: "spent",
    };
  }
  syncFireChargeForTick(game, game._replayTick ?? 0);
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
    ...buildActiveSlotSnapshot(game),
  };
}

function buildActiveSlotSnapshot(game: GameState): {
  activeFamily: "emp" | "f15" | "flare" | null;
  activeLabel: string;
  activeReady: boolean;
  activePhase: "ready" | "active" | "spent";
} {
  if (game.upgrades.flare > 0) {
    const activeReady = game.flareReadyThisWave;
    const flareActive =
      game.flares.some((flare) => flare.alive) ||
      game.flareSalvoQueue.length > 0 ||
      game.missiles.some((missile) => missile.flareControl?.mode === "turncoat") ||
      game.drones.some((drone) => drone.flareControl?.mode === "turncoat");
    return {
      activeFamily: "flare",
      activeLabel: game.upgrades.flare >= 2 ? "Counter-Salvo" : "Flares",
      activeReady,
      activePhase: activeReady ? "ready" : flareActive ? "active" : "spent",
    };
  }
  if (game.upgrades.f15 > 0) {
    const activeReady = game.f15ReadyThisWave;
    const sortieActive = game.planes.some((plane) => plane.alive) || game.f15ReturnTimer > 0;
    return {
      activeFamily: "f15",
      activeLabel: "F-15",
      activeReady,
      activePhase: activeReady ? "ready" : sortieActive ? "active" : "spent",
    };
  }
  if (game.upgrades.emp > 0) {
    const activeReady = game.empReadyThisWave;
    const blastActive = game.empRings.some((ring) => ring.alive !== false);
    return {
      activeFamily: "emp",
      activeLabel: "EMP",
      activeReady,
      activePhase: activeReady ? "ready" : blastActive ? "active" : "spent",
    };
  }
  return { activeFamily: null, activeLabel: "EMP", activeReady: false, activePhase: "spent" };
}

function emptyTransientOverlaySnapshot(titleCopyVisible = false): TransientOverlaySnapshot {
  return {
    titleCopyVisible,
    mirvWarning: { visible: false, alpha: 0 },
    purchaseToast: { visible: false, text: "", alpha: 0 },
    lowAmmoWarning: { visible: false, text: "LOW AMMO", alpha: 0 },
    waveClearedBanner: { visible: false, text: "", alpha: 0, scale: 1 },
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
    const remaining = game.waveClearedTimer ?? 0;
    const elapsed = Math.max(0, 120 - remaining);
    const intro = Math.min(1, elapsed / 14);
    const outro = Math.min(1, remaining / 20);
    snapshot.waveClearedBanner = {
      visible: true,
      text: `WAVE ${game.wave} CLEARED`,
      alpha: Math.min(intro, outro),
      scale: 0.92 + intro * 0.08,
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
  stats: GameStats;
  tick: number;
  wave: number;
}

function publishReplayFinished(sample: GameReplayFinishedSample): void {
  window.__lastReplayResult = sample;
  window.dispatchEvent(new CustomEvent("dmc:replay-finished", { detail: sample }));
  try {
    void window.__onReplayFinished?.(sample);
  } catch (error) {
    console.warn("[replay] finish notification failed", error);
  }
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
  private gameoverDeathClipStage: HTMLElement;
  private progressionPanel: HTMLElement;
  private runRecapPanel: HTMLElement;
  private progressionButton: HTMLElement;
  private titleMenuButton: HTMLElement;
  private retryButton: HTMLElement;
  private activeButton: HTMLButtonElement;
  private optionsButton: HTMLElement;
  private titleOptionsButton: HTMLElement;
  private optionsMenu: HTMLElement;
  private debugStartsEl: HTMLElement;
  private upgradesTableEl: HTMLElement;
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
  private bufferedPlayerShot: BufferedPlayerShot | null = null;

  // UI state
  private muted = false;
  private showColliders = false;
  private showPerfOverlay = false;
  private showOptionsMenu = false;
  private showUpgradesTable = false;
  private shopOpen = false;
  private replayActive = false;
  private bonusActive = false;
  private progressionOpen = false;
  private runRecapOpen = false;

  // Final stats for game over
  private finalScore = 0;
  private finalWave = 1;
  private finalStats = createEmptyGameStats();
  private lastReplay: ReplayData | null = null;
  private deathClipCleanup: (() => void) | null = null;
  private replaySeekGeneration = 0;
  private replaySeekOverlay: HTMLElement | null = null;
  private debugOptions: DebugOptions = loadDebugOptions();

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
    this.gameoverDeathClipStage = this.gameoverPanel.querySelector<HTMLElement>("[data-gameover-death-clip-stage]")!;
    this.progressionPanel = document.getElementById("progression-panel")!;
    this.runRecapPanel = document.getElementById("run-recap-panel")!;
    this.progressionButton = document.getElementById("progression-button")!;
    this.titleMenuButton = document.getElementById("title-menu-button")!;
    this.retryButton = document.getElementById("retry-button")!;
    this.activeButton = document.getElementById("active-button") as HTMLButtonElement;
    this.optionsButton = document.getElementById("options-button")!;
    this.titleOptionsButton = document.getElementById("title-options-button")!;
    this.optionsMenu = document.getElementById("options-menu")!;
    this.debugStartsEl = document.getElementById("debug-starts")!;
    this.upgradesTableEl = document.getElementById("upgrades-table")!;
    this.perfOverlay = document.getElementById("perf-overlay")!;

    cacheHudElements();
    cacheTransientOverlayElements();
    this.renderDebugStartOptions();
    this.renderUpgradesTable();
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
    this.progressionButton.addEventListener("click", () => this.openRunRecap());
    this.titleProgressionButton.addEventListener("click", () => this.openProgression());
    this.activeButton.addEventListener("click", () => this.fireActive());
    this.optionsButton.addEventListener("click", () => this.toggleOptionsMenu());
    this.titleOptionsButton.addEventListener("click", () => this.toggleOptionsMenu());
    document.getElementById("option-sound")!.addEventListener("click", () => void this.toggleMute());
    document.getElementById("option-debug")!.addEventListener("click", () => this.toggleDebug());
    document.getElementById("option-perf")!.addEventListener("click", () => this.togglePerf());
    document.getElementById("option-upgrades-table")!.addEventListener("click", () => this.toggleUpgradesTable());
    this.debugStartsEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-debug-start-id]");
      if (!button) return;
      event.preventDefault();
      void this.startDebugStart(button.dataset.debugStartId ?? "");
    });
    this.upgradesTableEl.addEventListener("change", (event) => this.handleUpgradesTableChange(event));
    this.upgradesTableEl.addEventListener("click", (event) => {
      const closeButton = (event.target as HTMLElement).closest("[data-upgrades-table-close]");
      if (closeButton) this.closeUpgradesTable();
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

  private stopDeathClip(): void {
    if (this.deathClipCleanup) {
      this.deathClipCleanup();
      this.deathClipCleanup = null;
    }
  }

  private mountGameOverDeathClip(): void {
    this.stopDeathClip();
    if (!this.lastReplay) {
      this.gameoverDeathClipStage.innerHTML = `<span>No death replay recorded.</span>`;
      return;
    }
    this.deathClipCleanup = mountRunRecapDeathClip(this.gameoverDeathClipStage, this.lastReplay);
  }

  private resetPlayerFireState(): void {
    this.bufferedPlayerShot = null;
  }

  // ─── Screen Management ──────────────────────────────────────────

  private setScreen(s: GameScreen): void {
    this.screen = s;
    this.shell.dataset.screen = s;
    this.battlefieldCard.hidden = s === "gameover" && !this.progressionOpen && !this.runRecapOpen;

    // Toggle visibility of screen-specific elements
    this.hudEl.hidden = s !== "playing";
    const titleHidden = s !== "title" || this.progressionOpen;
    this.titleOverlay.hidden = titleHidden;
    this.titleOverlay.setAttribute("aria-hidden", titleHidden ? "true" : "false");
    this.titleOverlay.inert = titleHidden;
    this.titleProgressionButton.hidden = s !== "title" || this.progressionOpen;
    const gameoverHidden = s !== "gameover" || this.progressionOpen || this.runRecapOpen;
    this.gameoverPanel.hidden = gameoverHidden;
    this.gameoverPanel.inert = gameoverHidden;
    const progressionHidden = !this.progressionOpen || (s !== "gameover" && s !== "title");
    this.progressionPanel.hidden = progressionHidden;
    this.progressionPanel.inert = progressionHidden;
    const runRecapHidden = !this.runRecapOpen || s !== "gameover";
    this.runRecapPanel.hidden = runRecapHidden;
    this.runRecapPanel.inert = runRecapHidden;
    this.battlefieldCard.classList.toggle("battlefield-card--portraitSky", s === "playing");
    if (s === "title") {
      void SFX.playTitleTheme();
    } else {
      SFX.stopTitleTheme();
      this.closeUpgradesTable();
    }

    if (s !== "gameover") {
      this.runRecapOpen = false;
      this.progressionOpen = false;
      this.stopDeathClip();
      uiHideRunRecap();
      uiHideUpgradeProgression();
      this.progressionPanel.hidden = true;
      this.runRecapPanel.hidden = true;
    }

    if (s === "gameover") {
      uiShowGameOver(this.finalScore, this.finalWave, this.finalStats);
      if (!this.progressionOpen && !this.runRecapOpen) this.mountGameOverDeathClip();
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
        const variantClass = preset.variant ? ` battlefield-debug-starts__button--${preset.variant}` : "";
        button.className = `battlefield-debug-starts__button${variantClass}`;
        button.dataset.debugStartId = preset.id;
        button.textContent = `W${preset.wave}`;
        button.setAttribute("aria-label", `Start ${preset.label}`);
        return button;
      }),
    );
  }

  private renderUpgradesTable(): void {
    const forced = new Set(this.debugOptions.forceShowUpgradeFamilies);
    const header = document.createElement("div");
    header.className = "battlefield-upgrades-table__header";

    const title = document.createElement("div");
    title.className = "battlefield-upgrades-table__title";
    title.textContent = "Upgrades Table";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "battlefield-upgrades-table__close";
    close.dataset.upgradesTableClose = "true";
    close.setAttribute("aria-label", "Close upgrades table");
    close.textContent = "Close";

    header.append(title, close);

    const list = document.createElement("div");
    list.className = "battlefield-upgrades-table__list";
    for (const option of getDebugUpgradeFamilyOptions()) {
      const row = document.createElement("label");
      row.className = "battlefield-upgrades-table__row";
      row.classList.toggle("battlefield-upgrades-table__row--disabled", !option.draftable);

      const identity = document.createElement("span");
      identity.className = "battlefield-upgrades-table__identity";

      const icon = document.createElement("span");
      icon.className = "battlefield-upgrades-table__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = option.icon;

      const name = document.createElement("span");
      name.className = "battlefield-upgrades-table__name";
      name.textContent = option.name;

      const meta = document.createElement("span");
      meta.className = "battlefield-upgrades-table__meta";
      meta.textContent = option.draftable ? "Force show" : "Not draftable";

      identity.append(icon, name, meta);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.forceUpgradeFamily = option.key;
      checkbox.checked = forced.has(option.key);
      checkbox.disabled = !option.draftable;
      checkbox.setAttribute("aria-label", `Force show ${option.name}`);

      row.append(identity, checkbox);
      list.append(row);
    }

    this.upgradesTableEl.replaceChildren(header, list);
  }

  private handleUpgradesTableChange(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-force-upgrade-family]");
    if (!input || input.disabled) return;
    const family = input.dataset.forceUpgradeFamily as UpgradeKey | undefined;
    if (!family) return;
    this.debugOptions = setForceShowUpgradeFamily(this.debugOptions, family, input.checked);
    saveDebugOptions(this.debugOptions);
    const game = this.gameRef.current;
    if (game) game._debugUpgradeForceShowFamilies = [...this.debugOptions.forceShowUpgradeFamilies];
    this.renderUpgradesTable();
  }

  private closeUpgradesTable(): void {
    this.showUpgradesTable = false;
    this.upgradesTableEl.hidden = true;
    document.getElementById("option-upgrades-table")?.classList.remove("battlefield-option--active");
  }

  private toggleUpgradesTable(): void {
    if (this.screen !== "title") return;
    this.showUpgradesTable = !this.showUpgradesTable;
    this.upgradesTableEl.hidden = !this.showUpgradesTable;
    document
      .getElementById("option-upgrades-table")
      ?.classList.toggle("battlefield-option--active", this.showUpgradesTable);
    if (this.showUpgradesTable) this.renderUpgradesTable();
  }

  private initGame(debugStart?: DebugStartPreset): void {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    setRng(mulberry32(seed));
    this.gameRef.current = simInitGame();
    const game = this.gameRef.current;
    this.debugOptions = loadDebugOptions();
    game.metaProgression = loadUpgradeProgression();
    if (!debugStart) {
      simBuyUpgrade(game, "wildHornets");
      simBuyUpgrade(game, "emp");
    }
    game._gameSeed = seed;
    game._debugUpgradeForceShowFamilies = [...this.debugOptions.forceShowUpgradeFamilies];
    game._draftMode = this.draftMode;
    game._actionLog = [];
    game._replayTick = 0;
    game._replayCheckpoints = [];
    game._replayCheckpointLastTick = -Infinity;
    game._replayCheckpointLastHash = null;
    if (debugStart) {
      applyDebugStartPreset(game, debugStart);
    }
    recordWavePlanAction(game);
    maybeRecordReplayCheckpoint(game, { force: true, reason: debugStart ? `debugStart:${debugStart.id}` : "start" });
    this.shopBought = [];
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    this.closeUpgradesTable();
    this.optionsMenu.hidden = true;
    this.syncOptionsButtons();
    this.perfOverlay.hidden = true;
    window.__gameRef = this.gameRef;
  }

  private async startGame(): Promise<void> {
    await SFX.init();
    SFX.prewarm();
    this.cancelReplaySeek();
    this.clearPointerCapture();
    this.resetPlayerFireState();
    this.initGame();
    this.replayActive = false;
    this.shopOpen = false;
    this.bonusActive = false;
    this.progressionOpen = false;
    this.runRecapOpen = false;
    uiHideShop();
    this.stopDeathClip();
    uiHideRunRecap();
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
    this.cancelReplaySeek();
    this.clearPointerCapture();
    this.resetPlayerFireState();
    this.initGame(preset);
    this.replayActive = false;
    this.shopOpen = false;
    this.bonusActive = false;
    this.progressionOpen = false;
    this.runRecapOpen = false;
    this.showOptionsMenu = false;
    uiHideShop();
    this.stopDeathClip();
    uiHideRunRecap();
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
    if (this.screen !== "gameover") return;
    this.cancelReplaySeek();
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
    this.runRecapOpen = false;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    uiHideShop();
    this.stopDeathClip();
    uiHideRunRecap();
    uiHideUpgradeProgression();
    hideBonusScreen();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.remove("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    this.optionsMenu.hidden = true;
    this.perfOverlay.hidden = true;
    this.closeUpgradesTable();
    this.syncOptionsButtons();
    this.setScreen("title");
  }

  private showReplaySeekOverlay(targetTick: number, progressTick = 0): void {
    if (!this.replaySeekOverlay) {
      this.replaySeekOverlay = document.createElement("div");
      this.replaySeekOverlay.className = "replay-seek-overlay";
      this.battlefieldCard.append(this.replaySeekOverlay);
    }
    const progress = targetTick > 0 ? Math.min(100, Math.round((progressTick / targetTick) * 100)) : 100;
    this.replaySeekOverlay.textContent = `Seeking replay... ${progress}%`;
    this.replaySeekOverlay.hidden = false;
  }

  private hideReplaySeekOverlay(): void {
    this.replaySeekOverlay?.remove();
    this.replaySeekOverlay = null;
  }

  private cancelReplaySeek(): void {
    this.replaySeekGeneration++;
    this.hideReplaySeekOverlay();
  }

  private async startReplay(replayData: ReplayData, opts: { seekToTick?: number } = {}): Promise<void> {
    await SFX.init();
    SFX.prewarm();
    const seekToTick = Math.max(0, Math.floor(opts.seekToTick ?? 0));
    const shouldSeek = seekToTick > 0;
    const currentSeekGeneration = ++this.replaySeekGeneration;
    this.clearPointerCapture();
    this.resetPlayerFireState();
    if (this.replayRunner) {
      this.replayRunner.cleanup();
      this.replayRunner = null;
    }
    let seeking = shouldSeek;
    let runner: ReturnType<typeof createReplayRunner>;
    runner = createReplayRunner(replayData, (type, data) => {
      if (seeking) handleRunRecapReplayEvent(replayData, runner, type, data);
      else this.handleSimEvent(type, data);
    });
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
    this.runRecapOpen = false;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.showPerfOverlay = false;
    this.closeUpgradesTable();
    uiHideShop();
    this.stopDeathClip();
    uiHideRunRecap();
    uiHideUpgradeProgression();
    this.battlefieldCard.classList.remove("battlefield-card--blurred");
    this.canvas.classList.add("game-canvas--active");
    this.canvas.style.pointerEvents = "";
    if (shouldSeek) {
      this.showReplaySeekOverlay(seekToTick);
      const isCurrentSeek = () => currentSeekGeneration === this.replaySeekGeneration;
      const signal = {
        get cancelled() {
          return !isCurrentSeek();
        },
      };
      const result = await seekRunnerToTick(runner, seekToTick, signal, (tick) => {
        if (isCurrentSeek()) this.showReplaySeekOverlay(seekToTick, tick);
      });
      if (currentSeekGeneration !== this.replaySeekGeneration) {
        runner.cleanup();
        if (this.replayRunner === runner) this.replayRunner = null;
        return;
      }
      if (!result.reached) {
        console.warn(`[replay] seek target ${seekToTick} was not reached; aborting at tick ${result.finalTick}`);
        runner.cleanup();
        if (this.replayRunner === runner) this.replayRunner = null;
        this.replayActive = false;
        this.hideReplaySeekOverlay();
        this.setScreen("gameover");
        return;
      }
    }
    seeking = false;
    this.hideReplaySeekOverlay();
    this.setScreen("playing");
  }

  async loadReplay(replayData: ReplayData): Promise<void> {
    await this.startReplay(replayData);
  }

  // ─── Sim Events ─────────────────────────────────────────────────

  private handleSimEvent<Type extends keyof SimEventMap>(type: Type, data: SimEventMap[Type]): void {
    const event = { type, data } as SimEvent;
    switch (event.type) {
      case "sfx":
        switch (event.data.name) {
          case "explosion":
            SFX.explosion(event.data.size);
            break;
          case "chainExplosion":
            SFX.chainExplosion(event.data.size, event.data.chainLevel);
            break;
          case "mirvIncoming":
            SFX.mirvIncoming();
            break;
          case "mirvSplit":
            SFX.mirvSplit();
            break;
          case "planeIncoming":
            SFX.planeIncoming();
            break;
          case "planePass":
            SFX.planePass();
            break;
          case "hornetBuzz":
            SFX.hornetBuzz();
            break;
          case "patriotLaunch":
            SFX.patriotLaunch();
            break;
          case "laserBeam": {
            const game = this.gameRef.current;
            if (game && !game._browserLaserHandle) {
              game._browserLaserHandle = SFX.laserBeam();
            }
            break;
          }
          case "waveCleared":
            SFX.waveCleared();
            break;
          case "gameOver":
            SFX.gameOver();
            break;
          case "burjHit":
            SFX.burjHit();
            break;
          case "launcherDestroyed":
            SFX.launcherDestroyed();
            break;
          case "empBlast":
            SFX.empBlast();
            break;
          case "multiKill":
            SFX.multiKill();
            break;
          case "flareLaunch":
            // No runtime sound is wired for flare launches today; preserve the previous no-op.
            break;
          default:
            assertNever(event.data);
        }
        break;
      case "gameOver": {
        const { data } = event;
        this.clearPointerCapture();
        this.resetPlayerFireState();
        this.shopOpen = false;
        this.progressionOpen = false;
        this.runRecapOpen = false;
        this.showOptionsMenu = false;
        this.showColliders = false;
        this.showPerfOverlay = false;
        this.closeUpgradesTable();
        uiHideShop();
        this.stopDeathClip();
        uiHideRunRecap();
        uiHideUpgradeProgression();
        this.battlefieldCard.classList.remove("battlefield-card--blurred");
        this.optionsMenu.hidden = true;
        this.perfOverlay.hidden = true;
        this.finalScore = data.score;
        this.finalWave = data.wave;
        this.finalStats = normalizeGameStats(data.stats);
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
            version: 4,
            seed: game._gameSeed ?? 0,
            actions: game._actionLog as ReplayData["actions"],
            checkpoints: game._replayCheckpoints || [],
            finalTick: (game._replayTick ?? 0) + 1,
            isHuman: true,
            draftMode: game._draftMode !== false,
            score: data.score,
            wave: data.wave,
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
        break;
      }
      case "waveBonusStart":
        this.resetPlayerFireState();
        this.bonusActive = true;
        this.canvas.style.pointerEvents = "none";
        showBonusScreen(
          event.data,
          (pts) => {
            const game = this.gameRef.current;
            const shouldApplyReplayBonus = !this.replayActive || game?._replayIsHuman === true;
            if (game && shouldApplyReplayBonus) game.score += pts;
            this.syncHud(true);
          },
          () => {
            const game = this.gameRef.current;
            if (game) game._bonusScreenDone = true;
            this.bonusActive = false;
            this.canvas.style.pointerEvents = "";
            hideBonusScreen();
          },
          this.replayActive ? { autoCompleteAfterTotalMs: 500 } : undefined,
        );
        break;
      case "shopOpen": {
        const game = this.gameRef.current;
        if (game) {
          maybeRecordReplayCheckpoint(game, {
            force: true,
            reason: "shopOpen",
            tickOverride: (game._replayTick ?? 0) + 1,
          });
          this.openShop(game);
        }
        break;
      }
      case "waveComplete":
        // The runtime has always ignored this; keep it explicit so the event union stays exhaustive.
        break;
      default:
        assertNever(event);
    }
  }

  // ─── Shop ───────────────────────────────────────────────────────

  private openShop(game: GameState): void {
    const shopData = buildShopDataFromGame(game);
    this.resetPlayerFireState();
    this.shopOpen = true;
    this.showOptionsMenu = false;
    this.showColliders = false;
    this.closeUpgradesTable();
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
      game._actionLog.push({
        tick: game._replayTick ?? 0,
        type: "shop",
        bought: [...this.shopBought],
        wave: game.wave,
      });
    }
    this.shopBought = [];
    simCloseShop(game);
    recordWavePlanAction(game);
    maybeRecordReplayCheckpoint(game, {
      force: true,
      reason: `waveStart:${game.wave}`,
    });
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

  private openRunRecap(): void {
    if (this.screen !== "gameover" || this.shopOpen) return;
    const game = this.gameRef.current;
    if (!game) return;
    this.runRecapOpen = true;
    this.progressionOpen = false;
    this.stopDeathClip();
    uiHideUpgradeProgression();
    this.progressionPanel.hidden = true;
    this.gameoverPanel.hidden = true;
    this.runRecapPanel.hidden = false;
    this.runRecapPanel.inert = false;
    this.battlefieldCard.hidden = true;
    uiShowRunRecap(buildRunRecapData(game, this.lastReplay), {
      onClose: () => this.closeRunRecap(),
      onWatchFullReplay: () => {
        if (this.lastReplay) {
          this.runRecapOpen = false;
          this.stopDeathClip();
          uiHideRunRecap();
          this.battlefieldCard.hidden = false;
          void this.startReplay(this.lastReplay);
        }
      },
      onWatchFromWave: (startTick) => {
        if (this.lastReplay) {
          this.runRecapOpen = false;
          this.stopDeathClip();
          uiHideRunRecap();
          this.runRecapPanel.hidden = true;
          this.battlefieldCard.hidden = false;
          void this.startReplay(this.lastReplay, { seekToTick: startTick });
        }
      },
      onSaveReplay: async () => {
        if (this.lastReplay) await saveReplayToFile(this.lastReplay);
      },
    });
  }

  private closeRunRecap(): void {
    this.runRecapOpen = false;
    this.stopDeathClip();
    uiHideRunRecap();
    this.runRecapPanel.hidden = true;
    this.battlefieldCard.hidden = true;
    if (this.screen === "gameover") {
      this.gameoverPanel.hidden = false;
      this.gameoverPanel.inert = false;
      this.mountGameOverDeathClip();
    }
  }

  private openProgression(): void {
    if ((this.screen !== "gameover" && this.screen !== "title") || this.shopOpen) return;
    this.progressionOpen = true;
    this.runRecapOpen = false;
    this.stopDeathClip();
    uiHideRunRecap();
    this.battlefieldCard.hidden = this.screen === "gameover";
    this.gameoverPanel.hidden = this.screen !== "gameover";
    if (this.screen === "title") {
      this.titleOverlay.hidden = true;
      this.titleOverlay.inert = true;
      this.titleProgressionButton.hidden = true;
    }
    this.progressionPanel.hidden = false;
    uiShowUpgradeProgression(this.buildProgressionData(), () => this.closeProgression());
  }

  private closeProgression(): void {
    this.progressionOpen = false;
    uiHideUpgradeProgression();
    this.progressionPanel.hidden = true;
    if (this.screen === "gameover") this.gameoverPanel.hidden = false;
    if (this.screen === "title") {
      this.titleOverlay.hidden = false;
      this.titleOverlay.inert = false;
      this.titleProgressionButton.hidden = false;
    }
  }

  // ─── Input Handling ─────────────────────────────────────────────

  private getCanvasCoords(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = (clientX - rect.left) * (CANVAS_W / rect.width);
    const canvasY = (clientY - rect.top) * (CANVAS_H / rect.height);
    // Invert the gameplay scene's pivot+scale+shake so a click on a visually
    // shaken / zoomed missile maps to its actual sim coordinates. Without this
    // the EMP zoom-punch silently shifts crosshair-to-target by ~4% near the
    // edges, and shake events offset clicks by their amplitude.
    const game = this.gameRef.current;
    if (game && this.screen === "playing") {
      const { shakeX, shakeY, zoom } = getGameplayViewTransform(game);
      const cx = CANVAS_W / 2;
      const cy = CANVAS_H / 2;
      const x = (canvasX - (cx + shakeX)) / zoom + cx;
      const y = (canvasY - (cy + shakeY)) / zoom + cy;
      return { x, y };
    }
    return { x: canvasX, y: canvasY };
  }

  private launchPlayerShot(game: GameState, x: number, y: number, silentOnFail = false): boolean {
    if (y >= GROUND_Y - 20) return false;
    const tick = game._replayTick ?? 0;
    if (!fireInterceptor(game, x, y, tick)) {
      if (!silentOnFail) SFX.emptyClick();
      return false;
    }
    SFX.fire();
    if (game._actionLog) game._actionLog.push({ tick, type: "fire", x, y });
    return true;
  }

  private requestPlayerFire(game: GameState, x: number, y: number): void {
    if (y >= GROUND_Y - 20) return;
    const tick = game._replayTick ?? 0;
    syncFireChargeForTick(game, tick);
    const activeLauncherCount = countAliveLaunchers(game);
    if (activeLauncherCount <= 0) {
      SFX.emptyClick();
      return;
    }
    if (getFireChargeCount(game.fireChargeState) <= 0) {
      this.bufferedPlayerShot = { x, y };
      return;
    }
    if (this.launchPlayerShot(game, x, y, true)) {
      this.bufferedPlayerShot = null;
    } else {
      this.bufferedPlayerShot = { x, y };
    }
  }

  private releaseBufferedPlayerFire(game: GameState): void {
    const tick = game._replayTick ?? 0;
    syncFireChargeForTick(game, tick);
    if (game.waveComplete) {
      this.bufferedPlayerShot = null;
      return;
    }
    const bufferedShot = this.bufferedPlayerShot;
    if (!bufferedShot) return;
    if (getFireChargeCount(game.fireChargeState) <= 0) return;
    if (!this.launchPlayerShot(game, bufferedShot.x, bufferedShot.y, true)) return;
    this.bufferedPlayerShot = null;
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
    if (!game || game.state !== "playing" || game.waveComplete) return;
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
    if (!game || game.state !== "playing" || game.waveComplete) return;
    if (e.key === " ") {
      e.preventDefault();
      this.fireActive();
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

  private fireActive(): boolean {
    if (this.screen !== "playing" || this.shopOpen || this.replayActive) return false;
    const game = this.gameRef.current;
    if (!game || game.state !== "playing" || game.waveComplete) return false;
    if (game.upgrades.flare > 0 && simFireFlareSalvo(game, (t, d) => this.handleSimEvent(t, d))) {
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick ?? 0, type: "flare" });
      this.syncHud(true);
      return true;
    }
    if (game.upgrades.f15 > 0 && simFireF15Pair(game, (t, d) => this.handleSimEvent(t, d))) {
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick ?? 0, type: "f15" });
      this.syncHud(true);
      return true;
    }
    if (game.upgrades.emp > 0 && simFireEmp(game, (t, d) => this.handleSimEvent(t, d))) {
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
    if (!this.showOptionsMenu) this.closeUpgradesTable();
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
          if (runner.isBonusPaused()) {
            if (game._bonusScreenDone) {
              runner.resumeFromBonusScreen();
            }
          } else if (runner.isShopPaused()) {
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
            this.finalStats = normalizeGameStats(game.stats);
            replayFinishedSample = {
              score: game.score,
              stats: this.finalStats,
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
          publishReplayFinished(replayFinishedSample);
          this.onReplayFinished?.(replayFinishedSample);
        }
      } else {
        this.lastTime = null;
        if (this.screen === "title") {
          this.syncTransientOverlays();
          this.renderer.renderTitle();
        } else if (this.screen === "gameover" && !this.runRecapOpen) {
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
