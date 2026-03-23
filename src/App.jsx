import { useState, useEffect, useRef, useCallback } from "react";
import SFX from "./sound.js";
import "./App.css";
import { CANVAS_W, CANVAS_H, GROUND_Y, COL, fireInterceptor, getAmmoCapacity, setRng } from "./game-logic.js";
import { drawGame, drawTitle, drawTitleModeToggle, drawGameOver, perfState } from "./game-render.js";
import ShopUI from "./ShopUI.jsx";
import { mulberry32 } from "./headless/rng.js";
import { buildReplayCheckpoint } from "./replay-debug.js";
import {
  UPGRADES,
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  buyDraftUpgrade as simBuyDraftUpgrade,
  closeShop as simCloseShop,
  fireEmp as simFireEmp,
} from "./game-sim.js";
import { createReplayRunner } from "./replay.js";

const REPLAY_CHECKPOINT_INTERVAL = 60;
const HUD_REFRESH_MS = 120;
const PHONE_BREAKPOINT = 900;
const LANDSCAPE_BREAKPOINT = 1100;

const LAYOUT_PROFILES = {
  desktop: {
    key: "desktop",
    showTopHud: true,
    showSystemLabels: true,
    externalTitle: false,
    externalGameOver: false,
    crosshairFillRadius: 18,
    crosshairOuterRadius: 18,
    crosshairInnerRadius: 12,
    crosshairGap: 6,
    crosshairArmLength: 18,
    mirvWarningFontSize: 18,
    mirvWarningY: 56,
    purchaseToastFontSize: 22,
    purchaseToastY: CANVAS_H / 3,
    lowAmmoFontSize: 28,
    lowAmmoY: CANVAS_H / 2 - 40,
    waveClearedY: 312,
    multiKillLabelSize: 22,
    multiKillBonusSize: 16,
  },
  phonePortrait: {
    key: "phonePortrait",
    showTopHud: false,
    showSystemLabels: false,
    externalTitle: true,
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
    waveClearedY: 336,
    multiKillLabelSize: 28,
    multiKillBonusSize: 20,
  },
  phoneLandscape: {
    key: "phoneLandscape",
    showTopHud: true,
    showSystemLabels: true,
    externalTitle: false,
    externalGameOver: false,
    crosshairFillRadius: 20,
    crosshairOuterRadius: 14,
    crosshairInnerRadius: 12,
    crosshairGap: 7,
    crosshairArmLength: 20,
    mirvWarningFontSize: 20,
    mirvWarningY: 64,
    purchaseToastFontSize: 24,
    purchaseToastY: CANVAS_H / 3,
    lowAmmoFontSize: 30,
    lowAmmoY: CANVAS_H / 2 - 48,
    waveClearedY: 320,
    multiKillLabelSize: 24,
    multiKillBonusSize: 18,
  },
};

const EMPTY_HUD = {
  score: 0,
  wave: 1,
  burjHealth: 5,
  burjAlive: true,
  ammo: [0, 0, 0],
  ammoMax: 0,
  launcherHP: [0, 0, 0],
  activeUpgrades: [],
  systemsOnline: 0,
  threatCount: 0,
  readyLaunchers: 0,
  empCharge: 0,
  empChargeMax: 0,
  empReady: false,
};

function maybeRecordReplayCheckpoint(game, { force = false, reason = null, tickOverride = null } = {}) {
  if (!game || !game._replayCheckpoints) return;
  const tick = tickOverride ?? game._replayTick;
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

function getUiMode({ width, height }) {
  if (width <= PHONE_BREAKPOINT && height > width) return "phonePortrait";
  if (width <= LANDSCAPE_BREAKPOINT && width > height) return "phoneLandscape";
  return "desktop";
}

function getLayoutProfile(uiMode) {
  return LAYOUT_PROFILES[uiMode] ?? LAYOUT_PROFILES.desktop;
}

function buildHudSnapshot(game) {
  if (!game) return EMPTY_HUD;
  const ammoMax = getAmmoCapacity(game.wave, game.upgrades.launcherKit);
  const activeUpgrades = Object.entries(game.upgrades)
    .filter(([, level]) => level > 0)
    .map(([key, level]) => {
      const def = UPGRADES[key];
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
    burjHealth: game.burjHealth,
    burjAlive: game.burjAlive,
    ammo: [...game.ammo],
    ammoMax,
    launcherHP: [...game.launcherHP],
    activeUpgrades,
    systemsOnline: activeUpgrades.length,
    threatCount: game.missiles.length + game.drones.length,
    readyLaunchers: game.launcherHP.filter((hp) => hp > 0).length,
    empCharge: game.empCharge,
    empChargeMax: game.empChargeMax,
    empReady: game.empReady,
  };
}

function buildShopDataFromGame(game) {
  return {
    score: game.score,
    wave: game.wave,
    upgrades: { ...game.upgrades },
    burjHealth: game.burjHealth,
    launcherHP: [...game.launcherHP],
    defenseSites: game.defenseSites.map((site) => ({ key: site.key, alive: site.alive })),
    draftMode: game._draftMode,
    draftOffers: game._draftOffers || null,
    draftPicked: false,
  };
}

function getHitRatio(stats) {
  const totalKills = stats.missileKills + stats.droneKills;
  return stats.shotsFired > 0 ? Math.round((totalKills / stats.shotsFired) * 100) : 0;
}

function formatEmpLabel(hud) {
  if (hud.empChargeMax <= 0) return "EMP OFFLINE";
  if (hud.empReady) return "EMP READY";
  return `EMP ${Math.round((hud.empCharge / hud.empChargeMax) * 100)}%`;
}

function getEmpProgress(hud) {
  if (hud.empChargeMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((hud.empCharge / hud.empChargeMax) * 100)));
}

export default function DubaiMissileCommand() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const replayRef = useRef(null);
  const titleHoverRef = useRef(null);
  const shopBoughtRef = useRef([]);
  const pointerIdRef = useRef(null);
  const hudRefreshRef = useRef(0);

  const [screen, setScreen] = useState("title");
  const [finalScore, setFinalScore] = useState(0);
  const [finalWave, setFinalWave] = useState(1);
  const [finalStats, setFinalStats] = useState({ missileKills: 0, droneKills: 0, shotsFired: 0 });
  const [showShop, setShowShop] = useState(false);
  const [shopData, setShopData] = useState(null);
  const [muted, setMuted] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [lastReplay, setLastReplay] = useState(null);
  const [draftMode, setDraftMode] = useState(false);
  const [viewport, setViewport] = useState(getViewportSnapshot);
  const [hudSnapshot, setHudSnapshot] = useState(EMPTY_HUD);

  const uiMode = getUiMode(viewport);
  const layoutProfile = getLayoutProfile(uiMode);
  const isPhonePortrait = uiMode === "phonePortrait";

  const syncHudSnapshot = useCallback((game, { force = false } = {}) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - hudRefreshRef.current < HUD_REFRESH_MS) return;
    hudRefreshRef.current = now;
    setHudSnapshot(buildHudSnapshot(game));
  }, []);

  const initGame = useCallback(() => {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    setRng(mulberry32(seed));
    gameRef.current = simInitGame();
    gameRef.current._gameSeed = seed;
    gameRef.current._draftMode = draftMode;
    gameRef.current._actionLog = [];
    gameRef.current._replayTick = 0;
    gameRef.current._replayCheckpoints = [];
    gameRef.current._replayCheckpointLastTick = -Infinity;
    gameRef.current._replayCheckpointLastHash = null;
    maybeRecordReplayCheckpoint(gameRef.current, { force: true, reason: "start" });
    shopBoughtRef.current = [];
    window.__gameRef = gameRef;
    syncHudSnapshot(gameRef.current, { force: true });
  }, [draftMode, syncHudSnapshot]);

  const handleSimEvent = useCallback(
    function handleSimEvent(type, data) {
      if (type === "sfx") {
        const sfxMap = {
          explosion: () => SFX.explosion(data.size),
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
        const fn = sfxMap[data.name];
        if (fn) fn();
      } else if (type === "gameOver") {
        setShowShop(false);
        setFinalScore(data.score);
        setFinalWave(data.wave);
        setFinalStats({ ...data.stats });
        syncHudSnapshot(gameRef.current, { force: true });
        const game = gameRef.current;
        if (game && game._actionLog) {
          maybeRecordReplayCheckpoint(game, { force: true, reason: "gameover", tickOverride: game._replayTick + 1 });
          const replay = {
            version: 2,
            seed: game._gameSeed,
            actions: game._actionLog,
            checkpoints: game._replayCheckpoints || [],
            finalTick: game._replayTick + 1,
            isHuman: true,
            draftMode: game._draftMode || false,
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
      } else if (type === "shopOpen") {
        maybeRecordReplayCheckpoint(gameRef.current, {
          force: true,
          reason: "shopOpen",
          tickOverride: gameRef.current._replayTick + 1,
        });
        setShopData(buildShopDataFromGame(gameRef.current));
        setShowShop(true);
        syncHudSnapshot(gameRef.current, { force: true });
      }
    },
    [syncHudSnapshot],
  );

  const startReplay = useCallback(
    (replayData) => {
      SFX.init();
      const runner = createReplayRunner(replayData, handleSimEvent);
      gameRef.current = runner.init();
      gameRef.current._replay = true;
      gameRef.current._replayIsHuman = !!replayData.isHuman;
      window.__gameRef = gameRef;
      replayRef.current = runner;
      setReplayActive(true);
      setShowShop(false);
      setScreen("playing");
      syncHudSnapshot(gameRef.current, { force: true });
    },
    [handleSimEvent, syncHudSnapshot],
  );

  const startGame = useCallback(() => {
    SFX.init();
    initGame();
    setReplayActive(false);
    setShowShop(false);
    setShopData(null);
    setScreen("playing");
    SFX.gameStart();
  }, [initGame]);

  const fireEmp = useCallback(() => {
    if (screen !== "playing" || showShop || replayActive) return false;
    const game = gameRef.current;
    if (!game || game.state !== "playing") return false;
    if (game.upgrades.emp > 0 && simFireEmp(game, handleSimEvent)) {
      SFX.empBlast();
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick, type: "emp" });
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
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const activeLayoutProfile = getLayoutProfile(uiMode);

    function loop(timestamp) {
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
            simUpdate(game, dt, handleSimEvent);
            game._replayTick++;
            if (game._actionLog && game._replayTick % 3 === 0) {
              game._actionLog.push({
                tick: game._replayTick,
                type: "cursor",
                x: Math.round(game.crosshairX),
                y: Math.round(game.crosshairY),
              });
            }
            maybeRecordReplayCheckpoint(game);
            if (game.state === "gameover" || game.state === "shop") break;
          }
        } else {
          game._timeAccum = 0;
        }

        if (!gameRef.current._laserHandle && gameRef.current._browserLaserHandle) {
          gameRef.current._browserLaserHandle.stop();
          gameRef.current._browserLaserHandle = null;
        }

        syncHudSnapshot(gameRef.current);
        drawGame(ctx, gameRef.current, { showShop, layoutProfile: activeLayoutProfile });
      } else {
        lastTimeRef.current = null;
        if (screen === "title") {
          drawTitle(ctx, { layoutProfile: activeLayoutProfile });
          if (!activeLayoutProfile.externalTitle) {
            drawTitleModeToggle(ctx, draftMode, titleHoverRef.current);
          }
        } else if (screen === "gameover") {
          drawGameOver(ctx, finalScore, finalWave, finalStats, { layoutProfile: activeLayoutProfile });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draftMode, finalScore, finalStats, finalWave, handleSimEvent, screen, showShop, syncHudSnapshot, uiMode]);

  useEffect(() => {
    function handleKeyDown(event) {
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
            game._actionLog.push({ tick: game._replayTick, type: "fire", x: game.crosshairX, y: game.crosshairY });
          }
        } else {
          SFX.emptyClick();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fireEmp, replayActive, screen, showShop]);

  function getCanvasCoords(clientX, clientY) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (CANVAS_W / rect.width),
      y: (clientY - rect.top) * (CANVAS_H / rect.height),
    };
  }

  function handleTitleModeHit(x, y) {
    if (y < 478 || y > 506) return false;
    if (x >= CANVAS_W / 2 - 135 && x <= CANVAS_W / 2 - 45) {
      setDraftMode(false);
      return true;
    }
    if (x >= CANVAS_W / 2 + 45 && x <= CANVAS_W / 2 + 135) {
      setDraftMode(true);
      return true;
    }
    return false;
  }

  function fireAt(game, x, y) {
    if (y >= GROUND_Y - 20) return;
    if (fireInterceptor(game, x, y)) {
      SFX.fire();
      if (game._actionLog) game._actionLog.push({ tick: game._replayTick, type: "fire", x, y });
    } else {
      SFX.emptyClick();
    }
  }

  function handleCanvasPointerDown(event) {
    if (showShop || replayActive) return;
    const point = getCanvasCoords(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();

    if (screen === "title") {
      if (!layoutProfile.externalTitle && handleTitleModeHit(point.x, point.y)) return;
      startGame();
      return;
    }

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

  function handleCanvasPointerMove(event) {
    const point = getCanvasCoords(event.clientX, event.clientY);
    if (!point) return;

    if (screen === "title") {
      if (!layoutProfile.externalTitle) {
        if (point.y >= 478 && point.y <= 506) {
          if (point.x >= CANVAS_W / 2 - 135 && point.x <= CANVAS_W / 2 - 45) {
            titleHoverRef.current = "normal";
            return;
          }
          if (point.x >= CANVAS_W / 2 + 45 && point.x <= CANVAS_W / 2 + 135) {
            titleHoverRef.current = "draft";
            return;
          }
        }
        titleHoverRef.current = null;
      }
      return;
    }

    if (screen !== "playing") return;
    const game = gameRef.current;
    if (!game) return;
    if (event.pointerType !== "mouse" && event.buttons === 0 && pointerIdRef.current !== event.pointerId) return;

    game.crosshairX = point.x;
    game.crosshairY = point.y;
  }

  function handleCanvasPointerLeave() {
    if (screen === "title") {
      titleHoverRef.current = null;
    }
  }

  function handleCanvasPointerUp(event) {
    if (pointerIdRef.current === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      pointerIdRef.current = null;
    }
  }

  function buyUpgrade(key) {
    const game = gameRef.current;
    if (!game) return;
    const isDraft = game._draftMode;
    const ok = isDraft ? simBuyDraftUpgrade(game, key) : simBuyUpgrade(game, key);
    if (ok) {
      SFX.buyUpgrade();
      shopBoughtRef.current.push(key);
      syncHudSnapshot(game, { force: true });
      setShopData((prev) => ({
        ...prev,
        score: game.score,
        upgrades: { ...game.upgrades },
        burjHealth: game.burjHealth,
        launcherHP: [...game.launcherHP],
        defenseSites: game.defenseSites.map((site) => ({ key: site.key, alive: site.alive })),
        draftPicked: isDraft ? true : prev?.draftPicked,
      }));
    }
  }

  function closeShop() {
    const game = gameRef.current;
    if (!game) return;
    if (game._actionLog) {
      game._actionLog.push({ tick: game._replayTick, type: "shop", bought: [...shopBoughtRef.current] });
    }
    shopBoughtRef.current = [];
    simCloseShop(game);
    setShowShop(false);
    setShopData(null);
    syncHudSnapshot(game, { force: true });
  }

  const hitRatio = getHitRatio(finalStats);
  const empProgress = getEmpProgress(hudSnapshot);
  const footerText = "Dubai Missile Command v2.0 - Integrated Air Defense Network";

  return (
    <div className={`game-shell game-shell--${uiMode}`} data-ui-mode={uiMode}>
      <div className="game-shell__ambient" aria-hidden="true" />
      <div className="game-shell__content">
        {isPhonePortrait && screen === "title" && (
          <section className="portrait-hero" data-testid="portrait-title">
            <div className="portrait-hero__eyebrow">Integrated Air Defense Network</div>
            <h1 className="portrait-hero__title">Dubai Missile Command</h1>
            <p className="portrait-hero__copy">
              Defend the skyline, intercept incoming strikes, and build a layered shield around the Burj.
            </p>
          </section>
        )}

        {isPhonePortrait && screen === "playing" && (
          <header className="portrait-hud" data-testid="portrait-hud">
            <div className="portrait-hud__cluster">
              <div className="hud-chip hud-chip--gold">
                <span className="hud-chip__label">Score</span>
                <strong className="hud-chip__value">$ {hudSnapshot.score}</strong>
              </div>
              <div className="hud-chip">
                <span className="hud-chip__label">Wave</span>
                <strong className="hud-chip__value">{hudSnapshot.wave}</strong>
              </div>
              <div className={`hud-chip ${hudSnapshot.burjAlive ? "hud-chip--good" : "hud-chip--danger"}`}>
                <span className="hud-chip__label">Burj</span>
                <strong className="hud-chip__value">
                  {hudSnapshot.burjAlive ? `${hudSnapshot.burjHealth}/5` : "DOWN"}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="mute-button mute-button--mobile"
              aria-label={muted ? "Unmute audio" : "Mute audio"}
              onClick={() => {
                SFX.init();
                SFX.mute();
                setMuted(SFX.isMuted());
              }}
            >
              {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
            </button>
          </header>
        )}

        <div className="battlefield-shell">
          <div
            className={`battlefield-card ${showShop ? "battlefield-card--blurred" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                let data;
                try {
                  data = JSON.parse(reader.result);
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
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerLeave={handleCanvasPointerLeave}
              onPointerUp={handleCanvasPointerUp}
              className={`game-canvas ${screen === "playing" && !showShop ? "game-canvas--active" : ""}`}
            />

            {!isPhonePortrait && (
              <button
                type="button"
                className="mute-button"
                aria-label={muted ? "Unmute audio" : "Mute audio"}
                onClick={() => {
                  SFX.init();
                  SFX.mute();
                  setMuted(SFX.isMuted());
                }}
              >
                {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
              </button>
            )}

            {!isPhonePortrait && screen === "gameover" && (
              <div className="battlefield-overlay battlefield-overlay--desktop">
                <div className="desktop-gameover-actions">
                  <button type="button" className="action-button action-button--danger" onClick={startGame}>
                    Retry
                  </button>
                  {lastReplay && (
                    <button
                      type="button"
                      className="action-button action-button--info"
                      onClick={() => {
                        setReplayActive(false);
                        startReplay(lastReplay);
                      }}
                    >
                      Watch Replay
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {isPhonePortrait && screen === "title" && (
          <section className="portrait-panel portrait-panel--title">
            <div className="portrait-panel__header">
              <span className="portrait-panel__kicker">Launch Profile</span>
              <span className="portrait-panel__subtle">Portrait-first command deck</span>
            </div>
            <div className="mode-toggle" role="group" aria-label="Game mode">
              <button
                type="button"
                className={`mode-toggle__button ${!draftMode ? "mode-toggle__button--active" : ""}`}
                onClick={() => setDraftMode(false)}
              >
                Normal
              </button>
              <button
                type="button"
                className={`mode-toggle__button ${draftMode ? "mode-toggle__button--draft" : ""}`}
                onClick={() => setDraftMode(true)}
              >
                Draft
              </button>
            </div>
            <p className="portrait-panel__copy">
              {draftMode
                ? "Pick one free upgrade each wave from three rotating options."
                : "Earn score, buy systems, and build your own defense network."}
            </p>
            <button
              type="button"
              className="action-button action-button--primary action-button--wide"
              onClick={startGame}
            >
              Start Defense
            </button>
            <div className="portrait-tip">Tap the battlefield at any time to start and fire.</div>
          </section>
        )}

        {isPhonePortrait && screen === "playing" && (
          <section className="portrait-panel portrait-panel--playing">
            <div className="portrait-panel__header">
              <span className="portrait-panel__kicker">Defense Grid</span>
              <span className="portrait-panel__subtle">
                {replayActive ? "Replay in progress" : "Touch and drag to aim, tap to fire"}
              </span>
            </div>
            <div className="status-strip">
              <div className="status-strip__card">
                <span className="status-strip__label">Threats</span>
                <strong className="status-strip__value">{hudSnapshot.threatCount}</strong>
                <span className="status-strip__meta">Active tracks</span>
              </div>
              <div className="status-strip__card">
                <span className="status-strip__label">Interceptors</span>
                <strong className="status-strip__value">{hudSnapshot.ammo.reduce((sum, ammo) => sum + ammo, 0)}</strong>
                <span className="status-strip__meta">{hudSnapshot.readyLaunchers} launchers ready</span>
              </div>
              <div className="status-strip__card">
                <span className="status-strip__label">Systems</span>
                <strong className="status-strip__value">{hudSnapshot.systemsOnline}</strong>
                <span className="status-strip__meta">Automations online</span>
              </div>
            </div>
            <div className="launcher-grid">
              {hudSnapshot.ammo.map((ammo, index) => (
                <div
                  key={`launcher-${index + 1}`}
                  className={`launcher-card ${hudSnapshot.launcherHP[index] > 0 ? "" : "launcher-card--down"}`}
                >
                  <div className="launcher-card__topline">
                    <span className="launcher-card__label">Launcher {index + 1}</span>
                    <span className="launcher-card__state">
                      {hudSnapshot.launcherHP[index] > 0 ? "Ready" : "Offline"}
                    </span>
                  </div>
                  <strong className="launcher-card__value">{hudSnapshot.launcherHP[index] > 0 ? ammo : "OFF"}</strong>
                  <div className="launcher-card__meter" aria-hidden="true">
                    <span
                      className="launcher-card__meter-fill"
                      style={{
                        width:
                          hudSnapshot.launcherHP[index] > 0 && hudSnapshot.ammoMax > 0
                            ? `${(ammo / hudSnapshot.ammoMax) * 100}%`
                            : "0%",
                      }}
                    />
                  </div>
                  <span className="launcher-card__meta">
                    HP {hudSnapshot.launcherHP[index]} · cap{" "}
                    {hudSnapshot.launcherHP[index] > 0 ? hudSnapshot.ammoMax : 0}
                  </span>
                </div>
              ))}
            </div>

            <div className="portrait-panel__section">
              <div className="portrait-panel__section-title">Active Systems</div>
              <div className="upgrade-chip-list">
                {hudSnapshot.activeUpgrades.length > 0 ? (
                  hudSnapshot.activeUpgrades.map((upgrade) => (
                    <span
                      key={upgrade.key}
                      className="upgrade-chip"
                      style={{ "--chip-accent": upgrade.color }}
                      title={`${upgrade.name} level ${upgrade.level}`}
                    >
                      <span className="upgrade-chip__icon">{upgrade.icon}</span>
                      <span className="upgrade-chip__text">{upgrade.name}</span>
                      <span className="upgrade-chip__level">L{upgrade.level}</span>
                    </span>
                  ))
                ) : (
                  <span className="upgrade-chip upgrade-chip--empty">
                    No systems online yet. Clear waves to fund upgrades.
                  </span>
                )}
              </div>
            </div>

            <div className="portrait-panel__actions">
              <button
                type="button"
                className={`emp-button ${hudSnapshot.empReady ? "emp-button--ready" : ""}`}
                onClick={fireEmp}
                disabled={!hudSnapshot.empReady}
              >
                <div className="emp-button__topline">
                  <span className="emp-button__label">{formatEmpLabel(hudSnapshot)}</span>
                  <span className="emp-button__percent">
                    {hudSnapshot.empChargeMax > 0 ? `${empProgress}%` : "LOCKED"}
                  </span>
                </div>
                <div className="emp-button__meter" aria-hidden="true">
                  <span className="emp-button__meter-fill" style={{ width: `${empProgress}%` }} />
                </div>
                <span className="emp-button__meta">
                  {hudSnapshot.empChargeMax > 0
                    ? "Charged shockwave damages every threat on screen."
                    : "Purchase EMP to unlock the emergency pulse."}
                </span>
              </button>
            </div>
          </section>
        )}

        {isPhonePortrait && screen === "gameover" && (
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
          <ShopUI shopData={shopData} onBuyUpgrade={buyUpgrade} onClose={closeShop} mode={uiMode} />
        )}

        <footer className={`game-footer ${isPhonePortrait ? "game-footer--compact" : ""}`}>{footerText}</footer>
      </div>
    </div>
  );
}
