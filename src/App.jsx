import { useState, useEffect, useRef, useCallback } from "react";
import SFX from "./sound.js";
import { CANVAS_W, CANVAS_H, GROUND_Y, COL, LAUNCHERS, fireInterceptor, setRng } from "./game-logic.js";
import { drawGame, drawTitle, drawTitleModeToggle, drawGameOver, perfState } from "./game-render.js";
import ShopUI from "./ShopUI.jsx";
import { mulberry32 } from "./headless/rng.js";
import { buildReplayCheckpoint } from "./replay-debug.js";
import {
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  buyDraftUpgrade as simBuyDraftUpgrade,
  closeShop as simCloseShop,
  fireEmp as simFireEmp,
} from "./game-sim.js";
import { createReplayRunner } from "./replay.js";

const REPLAY_CHECKPOINT_INTERVAL = 60;

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

export default function DubaiMissileCommand() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const replayRef = useRef(null);
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
  const titleHoverRef = useRef(null);
  const shopBoughtRef = useRef([]);

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
  }, [draftMode]);

  // SFX event handler for game-sim events
  const handleSimEvent = useCallback(function handleSimEvent(type, data) {
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
        // Auto-save replay to disk (dev server only, silently fails in prod)
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
      const game = gameRef.current;
      setShopData({
        score: data.score,
        wave: data.wave,
        upgrades: { ...data.upgrades },
        burjHealth: game.burjHealth,
        launcherHP: [...game.launcherHP],
        defenseSites: game.defenseSites.map((s) => ({ key: s.key, alive: s.alive })),
        draftMode: game._draftMode,
        draftOffers: game._draftOffers || null,
        draftPicked: false,
      });
      setShowShop(true);
    }
  }, []);

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
    },
    [handleSimEvent],
  );

  // Expose replay loader and last replay on window for console/external use
  useEffect(() => {
    window.__loadReplay = (replayData) => startReplay(replayData);
    window.__lastReplay = lastReplay;
    window.__createReplayRunner = createReplayRunner;
    return () => {
      delete window.__loadReplay;
      delete window.__lastReplay;
      delete window.__createReplayRunner;
    };
  }, [startReplay, lastReplay]);

  // update is now delegated to simUpdate via the RAF loop

  // Drawing functions imported from game-render.js

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    function loop(timestamp) {
      // FPS probe: measure first 60 frames of gameplay
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
        // FPS tracking
        const game = gameRef.current;
        game._fpsFrames = (game._fpsFrames || 0) + 1;
        game._fpsAccum = (game._fpsAccum || 0) + elapsed;
        if (game._fpsAccum >= 500) {
          game._fpsDisplay = Math.round((game._fpsFrames / game._fpsAccum) * 1000);
          game._fpsFrames = 0;
          game._fpsAccum = 0;
        }
        // Fixed timestep: accumulate elapsed time, step in dt=1 increments
        game._timeAccum = (game._timeAccum || 0) + Math.min(elapsed / (1000 / 60), 3);
        const dt = 1;
        if (replayRef.current) {
          // Replay mode: step once per frame (dt=1 fixed timestep)
          const rr = replayRef.current;
          if (rr.isShopPaused()) {
            // Show toast with purchases and resume after 1 second
            if (!game._replayShopTimer) {
              game._replayShopTimer = performance.now();
              const bought = game._replayShopBought || [];
              if (bought.length > 0) {
                game._purchaseToast = { items: [...bought], timer: 300 };
              }
              delete game._replayShopBought;
            } else if (performance.now() - game._replayShopTimer > 1000) {
              delete game._replayShopTimer;
              rr.resumeFromShop();
              setShowShop(false);
            }
          } else {
            rr.step();
          }
          if (rr.isFinished()) {
            rr.cleanup();
            replayRef.current = null;
            setReplayActive(false);
            setFinalScore(game.score);
            setFinalWave(game.wave);
            setFinalStats({ ...game.stats });
            setScreen("gameover");
          }
        } else {
          if (game.state === "playing") {
            while (game._timeAccum >= 1) {
              game._timeAccum -= 1;
              simUpdate(gameRef.current, dt, handleSimEvent);
              game._replayTick++;
              // Record cursor position every 3 ticks for replay
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
            // Replay ticks represent deterministic sim steps, not wall-clock time spent in menus.
            game._timeAccum = 0;
          }
        }
        // Stop browser laser SFX when sim clears laser handle
        if (!gameRef.current._laserHandle && gameRef.current._browserLaserHandle) {
          gameRef.current._browserLaserHandle.stop();
          gameRef.current._browserLaserHandle = null;
        }
        drawGame(ctx, gameRef.current, { showShop });
      } else {
        lastTimeRef.current = null;
        if (screen === "title") {
          drawTitle(ctx);
          drawTitleModeToggle(ctx, draftMode, titleHoverRef.current);
        } else if (screen === "gameover") {
          drawGameOver(ctx, finalScore, finalWave, finalStats);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, finalScore, finalWave, showShop]);

  function handleCanvasClick(e) {
    if (showShop || replayActive) return;
    if (screen === "title") {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
      // Mode toggle buttons at y=490
      if (my >= 478 && my <= 506) {
        if (mx >= CANVAS_W / 2 - 135 && mx <= CANVAS_W / 2 - 45) {
          setDraftMode(false);
          return;
        }
        if (mx >= CANVAS_W / 2 + 45 && mx <= CANVAS_W / 2 + 135) {
          setDraftMode(true);
          return;
        }
      }
      SFX.init();
      initGame();
      setScreen("playing");
      SFX.gameStart();
    } else if (screen === "gameover") {
      return;
    } else {
      const game = gameRef.current;
      if (!game || game.state !== "playing") return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
      if (my < GROUND_Y - 20) {
        if (fireInterceptor(game, mx, my)) {
          SFX.fire();
          if (game._actionLog) game._actionLog.push({ tick: game._replayTick, type: "fire", x: mx, y: my });
        } else {
          SFX.emptyClick();
        }
      }
    }
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (screen !== "playing" || showShop || replayActive) return;
      const game = gameRef.current;
      if (!game || game.state !== "playing") return;
      if (e.key === " ") {
        e.preventDefault();
        if (game.upgrades.emp > 0 && simFireEmp(game, handleSimEvent)) {
          SFX.empBlast();
          if (game._actionLog) game._actionLog.push({ tick: game._replayTick, type: "emp" });
        }
        return; // space never fires interceptors
      }
      if (game.crosshairY < GROUND_Y - 20) {
        if (fireInterceptor(game, game.crosshairX, game.crosshairY)) {
          SFX.fire();
          if (game._actionLog)
            game._actionLog.push({ tick: game._replayTick, type: "fire", x: game.crosshairX, y: game.crosshairY });
        } else {
          SFX.emptyClick();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, showShop, replayActive, handleSimEvent]);

  function handleMouseMove(e) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    if (screen === "title") {
      // Track hover over mode toggle buttons
      if (my >= 478 && my <= 506) {
        if (mx >= CANVAS_W / 2 - 135 && mx <= CANVAS_W / 2 - 45) {
          titleHoverRef.current = "normal";
          return;
        }
        if (mx >= CANVAS_W / 2 + 45 && mx <= CANVAS_W / 2 + 135) {
          titleHoverRef.current = "draft";
          return;
        }
      }
      titleHoverRef.current = null;
      return;
    }
    if (screen !== "playing") return;
    const game = gameRef.current;
    if (!game) return;
    game.crosshairX = mx;
    game.crosshairY = my;
  }

  function buyUpgrade(key) {
    const game = gameRef.current;
    if (!game) return;
    const isDraft = game._draftMode;
    const ok = isDraft ? simBuyDraftUpgrade(game, key) : simBuyUpgrade(game, key);
    if (ok) {
      SFX.buyUpgrade();
      shopBoughtRef.current.push(key);
      setShopData((prev) => ({
        ...prev,
        score: game.score,
        upgrades: { ...game.upgrades },
        burjHealth: game.burjHealth,
        launcherHP: [...game.launcherHP],
        defenseSites: game.defenseSites.map((s) => ({ key: s.key, alive: s.alive })),
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
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#050810",
        fontFamily: "'Courier New', monospace",
        padding: "10px",
      }}
    >
      <div
        style={{ position: "relative" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
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
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          style={{
            cursor: screen === "playing" && !showShop ? "none" : "pointer",
            border: "1px solid rgba(0,255,200,0.2)",
            borderRadius: "4px",
            maxWidth: "100%",
            boxShadow: "0 0 40px rgba(0,100,200,0.15)",
            filter: showShop ? "brightness(0.3) blur(2px)" : "none",
            transition: "filter 0.3s",
          }}
        />

        <button
          onClick={() => {
            SFX.init();
            SFX.mute();
            setMuted(SFX.isMuted());
          }}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            zIndex: 20,
            background: "rgba(0,10,20,0.7)",
            border: "1px solid rgba(0,255,200,0.3)",
            borderRadius: "4px",
            color: "#aabbcc",
            fontSize: "18px",
            width: "32px",
            height: "32px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
        </button>

        {/* GAME OVER OVERLAY */}
        {screen === "gameover" && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div style={{ marginTop: "420px", display: "flex", gap: "20px" }}>
              <button
                onClick={() => {
                  SFX.init();
                  initGame();
                  setScreen("playing");
                  SFX.gameStart();
                }}
                style={{
                  padding: "14px 50px",
                  background: "rgba(255,60,60,0.15)",
                  border: "1px solid rgba(255,80,80,0.5)",
                  borderRadius: "4px",
                  color: COL.warning,
                  fontSize: "16px",
                  fontWeight: "bold",
                  fontFamily: "'Courier New', monospace",
                  cursor: "pointer",
                  letterSpacing: "3px",
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = "rgba(255,60,60,0.3)";
                  e.target.style.boxShadow = "0 0 25px rgba(255,60,60,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = "rgba(255,60,60,0.15)";
                  e.target.style.boxShadow = "none";
                }}
              >
                RETRY
              </button>
              {lastReplay && (
                <button
                  onClick={() => {
                    setReplayActive(false);
                    startReplay(lastReplay);
                  }}
                  style={{
                    padding: "14px 40px",
                    background: "rgba(60,160,255,0.15)",
                    border: "1px solid rgba(60,160,255,0.5)",
                    borderRadius: "4px",
                    color: "#44aaff",
                    fontSize: "16px",
                    fontWeight: "bold",
                    fontFamily: "'Courier New', monospace",
                    cursor: "pointer",
                    letterSpacing: "3px",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = "rgba(60,160,255,0.3)";
                    e.target.style.boxShadow = "0 0 25px rgba(60,160,255,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = "rgba(60,160,255,0.15)";
                    e.target.style.boxShadow = "none";
                  }}
                >
                  WATCH REPLAY
                </button>
              )}
            </div>
          </div>
        )}

        {/* UPGRADE SHOP */}
        {showShop && shopData && <ShopUI shopData={shopData} onBuyUpgrade={buyUpgrade} onClose={closeShop} />}
      </div>
      <div style={{ color: "#445566", fontSize: "11px", marginTop: "10px", letterSpacing: "2px" }}>
        DUBAI MISSILE COMMAND v2.0 — INTEGRATED AIR DEFENSE NETWORK
      </div>
    </div>
  );
}
