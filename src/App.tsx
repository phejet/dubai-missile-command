import { useState, useEffect, useRef, useCallback } from "react";
import SFX from "./sound";
import "./App.css";
import { CANVAS_W, CANVAS_H, GROUND_Y, COL, fireInterceptor, getAmmoCapacity, setRng } from "./game-logic";
import { drawGame, drawTitle, drawGameOver, perfState } from "./game-render";
import ShopUI from "./ShopUI";
import BonusScreen from "./BonusScreen";
import { mulberry32 } from "./headless/rng";
import { buildReplayCheckpoint } from "./replay-debug";
import {
  UPGRADES,
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  buyDraftUpgrade as simBuyDraftUpgrade,
  closeShop as simCloseShop,
  fireEmp as simFireEmp,
  snapshotPositions,
  applyInterpolation,
  restorePositions,
} from "./game-sim";
import { createReplayRunner } from "./replay";
import type { GameState, ReplayData, UpgradeKey } from "./types";

declare global {
  interface Window {
    __gameRef?: React.MutableRefObject<GameState | null>;
    __loadReplay?: (replayData: ReplayData) => void;
    __lastReplay?: ReplayData | null;
    __createReplayRunner?: typeof createReplayRunner;
    __openShopPreview?: () => boolean;
  }
}

const REPLAY_CHECKPOINT_INTERVAL = 60;
const HUD_REFRESH_MS = 120;
const LAYOUT_PROFILE = {
  key: "phonePortrait",
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

const EMPTY_HUD = {
  score: 0,
  wave: 1,
  waveProgress: 0,
  waveSpawned: 0,
  waveSpawnTotal: 0,
  burjHealth: 5,
  burjAlive: true,
  fps: 0,
  rafFps: 0,
  rafFrameMs: 0,
  perfGlowEnabled: true,
  perfProbed: false,
  ammo: [0, 0, 0] as number[],
  ammoMax: 0,
  launcherHP: [0, 0, 0] as number[],
  activeUpgrades: [] as Array<{ key: string; level: number; icon: string; name: string; color: string }>,
  systemsOnline: 0,
  threatCount: 0,
  readyLaunchers: 0,
  empCharge: 0,
  empChargeMax: 0,
  empReady: false,
};

function maybeRecordReplayCheckpoint(
  game: GameState,
  { force = false, reason = null as string | null, tickOverride = null as number | null } = {},
) {
  if (!game || !game._replayCheckpoints) return;
  const tick = tickOverride ?? game._replayTick ?? 0;
  if (!force && tick - (game._replayCheckpointLastTick ?? -Infinity) < REPLAY_CHECKPOINT_INTERVAL) return;

  const checkpoint = buildReplayCheckpoint(game, tick, reason);
  if (!force && checkpoint.hash === game._replayCheckpointLastHash) return;

  game._replayCheckpoints.push(checkpoint);
  game._replayCheckpointLastTick = tick;
  game._replayCheckpointLastHash = checkpoint.hash;
}

function getViewportSnapshot() {
  if (typeof window === "undefined") {
    return { width: CANVAS_W, height: CANVAS_H };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function buildHudSnapshot(game: GameState | null) {
  if (!game) return EMPTY_HUD;
  const ammoMax = getAmmoCapacity(game.wave, game.upgrades.launcherKit);
  const waveSpawnTotal = game.schedule?.length ?? 0;
  const waveSpawned = waveSpawnTotal > 0 ? Math.min(game.scheduleIdx, waveSpawnTotal) : 0;
  const waveProgress = waveSpawnTotal > 0 ? Math.round((waveSpawned / waveSpawnTotal) * 100) : 0;
  const activeUpgrades = Object.entries(game.upgrades)
    .filter(([, level]) => level > 0)
    .map(([key, level]) => {
      const def = UPGRADES[key as UpgradeKey];
      return {
        key,
        level,
        icon: def?.icon ?? "•",
        name: def?.name ?? key,
        color: def?.color ?? COL.hud,
      };
    });
  return {
    score: game.score,
    wave: game.wave,
    waveProgress,
    waveSpawned,
    waveSpawnTotal,
    burjHealth: game.burjHealth,
    burjAlive: game.burjAlive,
    fps: game._fpsDisplay || 0,
    rafFps: game._rafFps || 0,
    rafFrameMs: game._rafDeltaMs || 0,
    perfGlowEnabled: perfState.glowEnabled,
    perfProbed: perfState.probed,
    ammo: [...game.ammo],
    ammoMax,
    launcherHP: [...game.launcherHP],
    activeUpgrades,
    systemsOnline: activeUpgrades.length,
    threatCount: game.missiles.length + game.drones.length,
    readyLaunchers: game.launcherHP.filter((hp: number) => hp > 0).length,
    empCharge: game.empCharge,
    empChargeMax: game.empChargeMax,
    empReady: game.empReady,
  };
}

function buildShopDataFromGame(game: GameState) {
  return {
    score: game.score,
    wave: game.wave,
    upgrades: { ...game.upgrades },
    burjHealth: game.burjHealth,
    launcherHP: [...game.launcherHP],
    defenseSites: game.defenseSites.map((site: { key: string; alive: boolean }) => ({
      key: site.key,
      alive: site.alive,
    })),
    draftMode: game._draftMode,
    draftOffers: game._draftOffers ?? undefined,
    draftPicked: false,
  };
}

function getHitRatio(stats: { missileKills: number; droneKills: number; shotsFired: number }) {
  const totalKills = stats.missileKills + stats.droneKills;
  return stats.shotsFired > 0 ? Math.round((totalKills / stats.shotsFired) * 100) : 0;
}

function getEmpProgress(hud: typeof EMPTY_HUD) {
  if (hud.empChargeMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((hud.empCharge / hud.empChargeMax) * 100)));
}

export default function DubaiMissileCommand() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const battlefieldCardRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const replayRef = useRef<ReturnType<typeof createReplayRunner> | null>(null);
  const shopBoughtRef = useRef<string[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const hudRefreshRef = useRef(0);

  const [screen, setScreen] = useState("title");
  const [finalScore, setFinalScore] = useState(0);
  const [finalWave, setFinalWave] = useState(1);
  const [finalStats, setFinalStats] = useState({ missileKills: 0, droneKills: 0, shotsFired: 0 });
  const [showShop, setShowShop] = useState(false);
  const [bonusData, setBonusData] = useState<{
    wave: number;
    buildings: number;
    savedAmmo: number;
    missileKills: number;
    droneKills: number;
  } | null>(null);
  const [shopData, setShopData] = useState<ReturnType<typeof buildShopDataFromGame> | null>(null);
  const [muted, setMuted] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [lastReplay, setLastReplay] = useState<ReplayData | null>(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showColliders, setShowColliders] = useState(false);
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  const [viewport, setViewport] = useState(getViewportSnapshot);
  const [hudSnapshot, setHudSnapshot] = useState(EMPTY_HUD);
  const [, setBattlefieldRect] = useState({ width: 0, height: 0 });
  const draftMode = true;

  const isCompactPortrait = viewport.height <= 760;

  const syncHudSnapshot = useCallback((game: GameState | null, { force = false } = {}) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - hudRefreshRef.current < HUD_REFRESH_MS) return;
    hudRefreshRef.current = now;
    setHudSnapshot(buildHudSnapshot(game));
  }, []);

  const initGame = useCallback(() => {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    setRng(mulberry32(seed));
    gameRef.current = simInitGame();
    // Starting upgrades
    simBuyUpgrade(gameRef.current, "wildHornets");
    simBuyUpgrade(gameRef.current, "emp");
    gameRef.current._gameSeed = seed;
    gameRef.current._draftMode = draftMode;
    gameRef.current._actionLog = [];
    gameRef.current._replayTick = 0;
    gameRef.current._replayCheckpoints = [];
    gameRef.current._replayCheckpointLastTick = -Infinity;
    gameRef.current._replayCheckpointLastHash = null;
    maybeRecordReplayCheckpoint(gameRef.current, { force: true, reason: "start" });
    shopBoughtRef.current = [];
    setShowOptionsMenu(false);
    setShowColliders(false);
    setShowPerfOverlay(false);
    window.__gameRef = gameRef;
    syncHudSnapshot(gameRef.current, { force: true });
  }, [draftMode, syncHudSnapshot]);

  const handleSimEvent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleSimEvent(type: string, data: any) {
      if (type === "sfx") {
        const sfxMap = {
          explosion: () => SFX.explosion(data.size),
          chainExplosion: () => SFX.chainExplosion(data.size, data.chainLevel),
          mirvIncoming: () => SFX.mirvIncoming(),
          mirvSplit: () => SFX.mirvSplit(),
          planeIncoming: () => SFX.planeIncoming(),
          planePass: () => SFX.planePass(),
          hornetBuzz: () => SFX.hornetBuzz(),
          patriotLaunch: () => SFX.patriotLaunch(),
          laserBeam: () => {
            const game = gameRef.current;
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
        const fn = (sfxMap as Record<string, (() => void) | undefined>)[data.name];
        if (fn) fn();
      } else if (type === "gameOver") {
        setShowShop(false);
        setShowOptionsMenu(false);
        setShowColliders(false);
        setShowPerfOverlay(false);
        setFinalScore(data.score);
        setFinalWave(data.wave);
        setFinalStats({ ...data.stats });
        syncHudSnapshot(gameRef.current, { force: true });
        const game = gameRef.current;
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
          setLastReplay(replay);
          fetch("/api/save-replay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...replay, score: data.score, wave: data.wave, stats: data.stats }),
          }).catch(() => {});
        }
        setRng(Math.random);
        setScreen("gameover");
      } else if (type === "waveBonusStart") {
        setBonusData({
          wave: data.wave,
          buildings: data.buildings,
          savedAmmo: data.savedAmmo,
          missileKills: data.missileKills,
          droneKills: data.droneKills,
        });
      } else if (type === "shopOpen") {
        const shopGame = gameRef.current;
        if (shopGame) {
          maybeRecordReplayCheckpoint(shopGame, {
            force: true,
            reason: "shopOpen",
            tickOverride: (shopGame._replayTick ?? 0) + 1,
          });
          setShopData(buildShopDataFromGame(shopGame));
          setShowShop(true);
          setShowOptionsMenu(false);
          setShowColliders(false);
          syncHudSnapshot(shopGame, { force: true });
        }
      }
    },
    [syncHudSnapshot],
  );

  const startReplay = useCallback(
    async (replayData: ReplayData) => {
      await SFX.init();
      const runner = createReplayRunner(replayData, handleSimEvent);
      const replayGameState = runner.init();
      gameRef.current = replayGameState;
      if (replayGameState) {
        replayGameState._replay = true;
        replayGameState._replayIsHuman = !!replayData.isHuman;
        replayGameState._showColliders = false;
      }
      window.__gameRef = gameRef;
      replayRef.current = runner;
      setReplayActive(true);
      setShowShop(false);
      setShowOptionsMenu(false);
      setShowColliders(false);
      setShowPerfOverlay(false);
      setScreen("playing");
      syncHudSnapshot(gameRef.current, { force: true });
    },
    [handleSimEvent, syncHudSnapshot],
  );

  const startGame = useCallback(async () => {
    await SFX.init();
    initGame();
    setReplayActive(false);
    setShowShop(false);
    setShopData(null);
    setShowOptionsMenu(false);
    setShowColliders(false);
    setShowPerfOverlay(false);
    setScreen("playing");
    SFX.gameStart();
  }, [initGame]);

  const fireEmp = useCallback(() => {
    if (screen !== "playing" || showShop || replayActive) return false;
    const game = gameRef.current;
    if (!game || game.state !== "playing") return false;
    if (game.upgrades.emp > 0 && simFireEmp(game, handleSimEvent)) {
      SFX.empBlast();
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick ?? 0, type: "emp" });
      syncHudSnapshot(game, { force: true });
      return true;
    }
    return false;
  }, [handleSimEvent, replayActive, screen, showShop, syncHudSnapshot]);

  useEffect(() => {
    function handleResize() {
      setViewport(getViewportSnapshot());
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  useEffect(() => {
    window.__loadReplay = (replayData) => startReplay(replayData);
    window.__lastReplay = lastReplay;
    window.__createReplayRunner = createReplayRunner;
    window.__openShopPreview = () => {
      const game = gameRef.current;
      if (!game) return false;
      game.state = "shop";
      setShopData(buildShopDataFromGame(game));
      setShowShop(true);
      syncHudSnapshot(game, { force: true });
      return true;
    };
    return () => {
      delete window.__loadReplay;
      delete window.__lastReplay;
      delete window.__createReplayRunner;
      delete window.__openShopPreview;
    };
  }, [lastReplay, startReplay, syncHudSnapshot]);

  useEffect(() => {
    const card = battlefieldCardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return undefined;

    const updateRect = () => {
      const rect = card.getBoundingClientRect();
      setBattlefieldRect((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height },
      );
    };

    updateRect();
    const observer = new ResizeObserver(updateRect);
    observer.observe(card);
    return () => observer.disconnect();
  }, [screen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const activeLayoutProfile = LAYOUT_PROFILE;

    function loop(timestamp: number) {
      if (!perfState.probed && screen === "playing" && gameRef.current) {
        if (perfState.frameCount === 0) perfState.startTime = timestamp;
        perfState.frameCount++;
        if (perfState.frameCount >= 60) {
          const elapsed = timestamp - perfState.startTime;
          const avgFps = (60 / elapsed) * 1000;
          perfState.glowEnabled = avgFps >= 45;
          perfState.probed = true;
        }
      }

      if (screen === "playing" && gameRef.current) {
        if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
        const elapsed = timestamp - lastTimeRef.current;
        lastTimeRef.current = timestamp;
        const game = gameRef.current;
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
        const dt = 1;

        if (replayRef.current) {
          const runner = replayRef.current;
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
              setShowShop(false);
            }
          } else {
            runner.step();
          }
          if (runner.isFinished()) {
            runner.cleanup();
            replayRef.current = null;
            setReplayActive(false);
            setFinalScore(game.score);
            setFinalWave(game.wave);
            setFinalStats({ ...game.stats });
            setScreen("gameover");
          }
        } else if (game.state === "playing") {
          while (game._timeAccum >= 1) {
            game._timeAccum -= 1;
            snapshotPositions(game);
            simUpdate(game, dt, handleSimEvent);
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

        if (!gameRef.current._laserHandle && gameRef.current._browserLaserHandle) {
          gameRef.current._browserLaserHandle.stop();
          gameRef.current._browserLaserHandle = null;
        }

        // Interpolate entity positions for smooth sub-tick rendering
        const alpha = game.state === "playing" ? (game._timeAccum ?? 0) : 1;
        applyInterpolation(game, alpha);
        syncHudSnapshot(gameRef.current);
        drawGame(ctx, gameRef.current, { showShop, layoutProfile: activeLayoutProfile });
        restorePositions(game);
      } else {
        lastTimeRef.current = null;
        if (screen === "title") {
          drawTitle(ctx, { layoutProfile: activeLayoutProfile });
        } else if (screen === "gameover") {
          drawGameOver(ctx, finalScore, finalWave, finalStats, { layoutProfile: activeLayoutProfile });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [finalScore, finalStats, finalWave, handleSimEvent, screen, showShop, syncHudSnapshot]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (screen !== "playing" || showShop || replayActive) return;
      const game = gameRef.current;
      if (!game || game.state !== "playing") return;
      if (event.key === " ") {
        event.preventDefault();
        fireEmp();
        return;
      }
      if (game.crosshairY < GROUND_Y - 20) {
        if (fireInterceptor(game, game.crosshairX, game.crosshairY)) {
          SFX.fire();
          if (game._actionLog) {
            game._actionLog.push({ tick: game._replayTick ?? 0, type: "fire", x: game.crosshairX, y: game.crosshairY });
          }
        } else {
          SFX.emptyClick();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fireEmp, replayActive, screen, showShop]);

  function getCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (clientX - rect.left) * (CANVAS_W / rect.width);
    const canvasY = (clientY - rect.top) * (CANVAS_H / rect.height);
    return { x: canvasX, y: canvasY };
  }

  function fireAt(game: GameState, x: number, y: number) {
    if (y >= GROUND_Y - 20) return;
    if (fireInterceptor(game, x, y)) {
      SFX.fire();
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick ?? 0, type: "fire", x, y });
    } else {
      SFX.emptyClick();
    }
  }

  async function handleCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (showShop || replayActive) return;
    const point = getCanvasCoords(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();

    if (screen === "gameover") return;

    const game = gameRef.current;
    if (!game || game.state !== "playing") return;

    game.crosshairX = point.x;
    game.crosshairY = point.y;
    syncHudSnapshot(game, { force: true });
    if (event.pointerType !== "mouse") {
      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    fireAt(game, point.x, point.y);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasCoords(event.clientX, event.clientY);
    if (!point) return;

    if (screen === "title") return;

    if (screen !== "playing") return;
    const game = gameRef.current;
    if (!game) return;
    if (event.pointerType !== "mouse" && event.buttons === 0 && pointerIdRef.current !== event.pointerId) return;

    game.crosshairX = point.x;
    game.crosshairY = point.y;
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerIdRef.current === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      pointerIdRef.current = null;
    }
  }

  function buyUpgrade(key: UpgradeKey) {
    const game = gameRef.current;
    if (!game) return;
    const isDraft = game._draftMode;
    const ok = isDraft ? simBuyDraftUpgrade(game, key) : simBuyUpgrade(game, key);
    if (ok) {
      SFX.buyUpgrade();
      shopBoughtRef.current.push(key);
      syncHudSnapshot(game, { force: true });
      setShopData((prev) =>
        prev
          ? {
              ...prev,
              score: game.score,
              upgrades: { ...game.upgrades },
              burjHealth: game.burjHealth,
              launcherHP: [...game.launcherHP],
              defenseSites: game.defenseSites.map((site: { key: string; alive: boolean }) => ({
                key: site.key,
                alive: site.alive,
              })),
              draftPicked: isDraft ? true : prev.draftPicked,
            }
          : prev,
      );
    }
  }

  function closeShop() {
    const game = gameRef.current;
    if (!game) return;
    if (game._actionLog) {
      game._actionLog.push({ tick: game._replayTick ?? 0, type: "shop", bought: [...shopBoughtRef.current] });
    }
    shopBoughtRef.current = [];
    simCloseShop(game);
    setShowShop(false);
    setShopData(null);
    syncHudSnapshot(game, { force: true });
  }

  const hitRatio = getHitRatio(finalStats);
  const empProgress = getEmpProgress(hudSnapshot);

  return (
    <div
      className={`game-shell game-shell--phonePortrait ${isCompactPortrait ? "game-shell--compactPortrait" : ""}`}
      data-screen={screen}
      data-ui-mode="phonePortrait"
      onPointerDown={(event) => {
        if (screen !== "title" || showShop || replayActive) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, select, textarea, [role='button']")) return;
        void startGame();
      }}
    >
      <div className="game-shell__ambient" aria-hidden="true" />
      <div className="game-shell__content">
        <div className="battlefield-shell">
          <div
            ref={battlefieldCardRef}
            className={`battlefield-card ${showShop ? "battlefield-card--blurred" : ""} ${
              screen === "playing" ? "battlefield-card--portraitSky" : ""
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
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
                  startReplay(data);
                }
              };
              reader.readAsText(file);
            }}
          >
            {screen === "playing" && (
              <div className="battlefield-hud" data-testid="portrait-hud">
                <div
                  className="battlefield-hud__progress"
                  role="progressbar"
                  aria-label={`Wave ${hudSnapshot.wave} spawn progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={hudSnapshot.waveProgress}
                >
                  <span className="battlefield-hud__progress-fill" style={{ width: `${hudSnapshot.waveProgress}%` }} />
                </div>

                <div className="battlefield-hud__summary">
                  <div className="battlefield-score">
                    <span className="battlefield-score__label">Score</span>
                    <strong className="battlefield-score__value">{hudSnapshot.score}</strong>
                  </div>

                  <div className="battlefield-status">
                    <div
                      className={`battlefield-status__item ${hudSnapshot.burjAlive ? "battlefield-status__item--good" : "battlefield-status__item--danger"}`}
                    >
                      <span className="battlefield-status__label">Burj</span>
                      <strong className="battlefield-status__value">
                        {hudSnapshot.burjAlive ? `${hudSnapshot.burjHealth}/5` : "DOWN"}
                      </strong>
                    </div>
                  </div>

                  <div className="battlefield-ammo" aria-label="Launcher ammo">
                    <span className="battlefield-ammo__label">
                      <svg className="battlefield-ammo__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 18h14" />
                        <path d="M7 18l2-7h6l2 7" />
                        <path d="M10.8 11V5.8l1.2-.8 1.2.8V11" />
                        <path d="M9 7.2h6" />
                      </svg>
                      <span>Ammo</span>
                    </span>
                    <div className="battlefield-ammo__grid">
                      {hudSnapshot.ammo.map((count, idx) => (
                        <div
                          key={`ammo-${idx}`}
                          className={`battlefield-ammo__cell ${hudSnapshot.launcherHP[idx] > 0 ? "" : "battlefield-ammo__cell--down"}`}
                        >
                          <span className="battlefield-ammo__slot">L{idx + 1}</span>
                          <strong className="battlefield-ammo__count">{count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="battlefield-options-button"
                    aria-label={showOptionsMenu ? "Close options" : "Open options"}
                    aria-expanded={showOptionsMenu}
                    aria-haspopup="menu"
                    onClick={() => setShowOptionsMenu((value) => !value)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                      <path d="M19.1 13.3a7.8 7.8 0 0 0 .1-2.6l2-1.1-2-3.5-2.2.6a8.4 8.4 0 0 0-2.2-1.3L14.2 3H9.8l-.6 2.4a8.4 8.4 0 0 0-2.2 1.3l-2.2-.6-2 3.5 2 1.1a7.8 7.8 0 0 0 0 2.6l-2 1.1 2 3.5 2.2-.6a8.4 8.4 0 0 0 2.2 1.3l.6 2.4h4.4l.6-2.4a8.4 8.4 0 0 0 2.2-1.3l2.2.6 2-3.5-2-1.1Z" />
                    </svg>
                  </button>
                </div>

                {showOptionsMenu && (
                  <div className="battlefield-options-menu" role="menu" aria-label="Game options">
                    <button
                      type="button"
                      className={`battlefield-option ${muted ? "battlefield-option--active" : ""}`}
                      aria-label="Mute audio"
                      aria-pressed={muted}
                      onClick={async () => {
                        await SFX.init();
                        SFX.mute();
                        setMuted(SFX.isMuted());
                      }}
                    >
                      <span className="battlefield-option__label">Sound</span>
                      <span className="battlefield-option__meta">{muted ? "Muted" : "On"}</span>
                    </button>
                    <button
                      type="button"
                      className={`battlefield-option ${showColliders ? "battlefield-option--active" : ""}`}
                      onClick={() => {
                        if (gameRef.current) {
                          gameRef.current._showColliders = !gameRef.current._showColliders;
                          setShowColliders(gameRef.current._showColliders);
                        }
                      }}
                    >
                      <span className="battlefield-option__label">Debug</span>
                      <span className="battlefield-option__meta">Colliders</span>
                    </button>
                    <button
                      type="button"
                      className={`battlefield-option ${showPerfOverlay ? "battlefield-option--active" : ""}`}
                      onClick={() => setShowPerfOverlay((value) => !value)}
                    >
                      <span className="battlefield-option__label">Perf</span>
                      <span className="battlefield-option__meta">{showPerfOverlay ? "On" : "Off"}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="battlefield-stage">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                className={`game-canvas ${screen === "playing" && !showShop ? "game-canvas--active" : ""}`}
                style={bonusData ? { pointerEvents: "none" } : undefined}
              />
              {screen === "playing" && hudSnapshot.empChargeMax > 0 && (
                <button
                  type="button"
                  className={`battlefield-emp ${hudSnapshot.empReady ? "battlefield-emp--ready" : ""}`}
                  onClick={fireEmp}
                  aria-label={hudSnapshot.empReady ? "Fire EMP" : "EMP charging"}
                  disabled={!hudSnapshot.empReady}
                >
                  <span className="battlefield-emp__label">EMP</span>
                  <span className="battlefield-emp__meta">{hudSnapshot.empReady ? "READY" : `${empProgress}%`}</span>
                </button>
              )}
              {bonusData && (
                <BonusScreen
                  wave={bonusData.wave}
                  buildings={bonusData.buildings}
                  savedAmmo={bonusData.savedAmmo}
                  missileKills={bonusData.missileKills}
                  droneKills={bonusData.droneKills}
                  onScoreAdd={(pts) => {
                    const game = gameRef.current;
                    if (game) game.score += pts;
                    syncHudSnapshot(gameRef.current, { force: true });
                  }}
                  onComplete={() => {
                    const game = gameRef.current;
                    if (game) game._bonusScreenDone = true;
                    setBonusData(null);
                  }}
                />
              )}
              {screen === "playing" && showPerfOverlay && (
                <div className="battlefield-debug-overlay" aria-hidden="true">
                  <div className="battlefield-debug-overlay__title">Render Probe</div>
                  <div className="battlefield-debug-overlay__row">
                    <span>RAF</span>
                    <strong>{hudSnapshot.rafFps ? `${hudSnapshot.rafFps.toFixed(1)} fps` : "--"}</strong>
                  </div>
                  <div className="battlefield-debug-overlay__row">
                    <span>Frame</span>
                    <strong>{hudSnapshot.rafFrameMs ? `${hudSnapshot.rafFrameMs.toFixed(1)} ms` : "--"}</strong>
                  </div>
                  <div className="battlefield-debug-overlay__row">
                    <span>HUD FPS</span>
                    <strong>{hudSnapshot.fps ? `${hudSnapshot.fps} fps` : "--"}</strong>
                  </div>
                  <div className="battlefield-debug-overlay__row">
                    <span>Glow</span>
                    <strong>{hudSnapshot.perfProbed ? (hudSnapshot.perfGlowEnabled ? "on" : "off") : "probing"}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {screen === "gameover" && (
          <section className="portrait-panel portrait-panel--gameover">
            <div className="portrait-panel__header">
              <span className="portrait-panel__kicker">After Action Report</span>
              <span className="portrait-panel__subtle">The skyline has fallen</span>
            </div>
            <div className="report-grid">
              <div className="report-card">
                <span className="report-card__label">Score</span>
                <strong className="report-card__value">{finalScore}</strong>
              </div>
              <div className="report-card">
                <span className="report-card__label">Waves</span>
                <strong className="report-card__value">{finalWave}</strong>
              </div>
              <div className="report-card">
                <span className="report-card__label">Hit Ratio</span>
                <strong className="report-card__value">{hitRatio}%</strong>
              </div>
              <div className="report-card">
                <span className="report-card__label">Missiles</span>
                <strong className="report-card__value">{finalStats.missileKills}</strong>
              </div>
            </div>
            <div className="portrait-panel__actions portrait-panel__actions--stacked">
              <button
                type="button"
                className="action-button action-button--danger action-button--wide"
                onClick={startGame}
              >
                Retry
              </button>
              {lastReplay && (
                <button
                  type="button"
                  className="action-button action-button--info action-button--wide"
                  onClick={() => {
                    setReplayActive(false);
                    startReplay(lastReplay);
                  }}
                >
                  Watch Replay
                </button>
              )}
            </div>
          </section>
        )}

        {showShop && shopData && (
          <ShopUI shopData={shopData} onBuyUpgrade={buyUpgrade} onClose={closeShop} mode="phonePortrait" />
        )}
      </div>
    </div>
  );
}
