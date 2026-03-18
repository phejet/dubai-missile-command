import { useState, useEffect, useRef, useCallback } from "react";
import SFX from "./sound.js";
import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  COL,
  BURJ_X,
  BURJ_H,
  LAUNCHERS,
  fireInterceptor,
  getPhalanxTurrets,
} from "./game-logic.js";
import {
  UPGRADES,
  initGame as simInitGame,
  update as simUpdate,
  buyUpgrade as simBuyUpgrade,
  closeShop as simCloseShop,
} from "./game-sim.js";
import { createReplayRunner } from "./replay.js";

// FPS probe: measure first 60 frames, disable shadowBlur if avg FPS < 45
const perfState = { frameCount: 0, startTime: 0, glowEnabled: true, probed: false };

function glow(ctx, color, radius) {
  if (!perfState.glowEnabled) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = radius;
}

function glowOff(ctx) {
  if (!perfState.glowEnabled) return;
  ctx.shadowBlur = 0;
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

  const initGame = useCallback(() => {
    gameRef.current = simInitGame();
    window.__gameRef = gameRef;
  }, []);

  // SFX event handler for game-sim events
  const handleSimEvent = useCallback(function handleSimEvent(type, data) {
    if (type === "sfx") {
      const sfxMap = {
        explosion: () => SFX.explosion(data.size),
        planePass: () => SFX.planePass(),
        hornetBuzz: () => SFX.hornetBuzz(),
        patriotLaunch: () => SFX.patriotLaunch(),
        laserBeam: () => {
          const g = gameRef.current;
          if (g && !g._browserLaserHandle) {
            g._browserLaserHandle = SFX.laserBeam();
          }
        },
        waveCleared: () => SFX.waveCleared(),
        gameOver: () => SFX.gameOver(),
        burjHit: () => SFX.burjHit(),
        launcherDestroyed: () => SFX.launcherDestroyed(),
      };
      const fn = sfxMap[data.name];
      if (fn) fn();
    } else if (type === "gameOver") {
      setShowShop(false);
      setFinalScore(data.score);
      setFinalWave(data.wave);
      setFinalStats({ ...data.stats });
      setScreen("gameover");
    } else if (type === "shopOpen") {
      setShopData({ score: data.score, wave: data.wave, upgrades: { ...data.upgrades } });
      setShowShop(true);
    }
  }, []);

  const startReplay = useCallback(
    (replayData) => {
      SFX.init();
      const runner = createReplayRunner(replayData, handleSimEvent);
      gameRef.current = runner.init();
      gameRef.current._replay = true;
      window.__gameRef = gameRef;
      replayRef.current = runner;
      setReplayActive(true);
      setShowShop(false);
      setScreen("playing");
    },
    [handleSimEvent],
  );

  // Expose replay loader on window for console/external use
  useEffect(() => {
    window.__loadReplay = (replayData) => startReplay(replayData);
    return () => {
      delete window.__loadReplay;
    };
  }, [startReplay]);

  // update is now delegated to simUpdate via the RAF loop

  // ── DRAWING ──
  function drawGame(ctx, g) {
    let sx = 0,
      sy = 0;
    if (g.shakeTimer > 0) {
      sx = (Math.random() - 0.5) * g.shakeIntensity * 2;
      sy = (Math.random() - 0.5) * g.shakeIntensity * 2;
    }
    ctx.save();
    ctx.translate(sx, sy);

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    skyGrad.addColorStop(0, COL.sky1);
    skyGrad.addColorStop(0.4, COL.sky2);
    skyGrad.addColorStop(0.7, COL.sky3);
    skyGrad.addColorStop(1, COL.ground);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    g.stars.forEach((s) => {
      ctx.globalAlpha = 0.4 + 0.6 * Math.sin(g.time * 0.02 + s.twinkle);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Moon
    ctx.fillStyle = "#ffe8b0";
    ctx.beginPath();
    ctx.arc(780, 60, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.sky1;
    ctx.beginPath();
    ctx.arc(788, 55, 22, 0, Math.PI * 2);
    ctx.fill();

    // Decoy flares
    g.flares.forEach((f) => {
      if (!f.alive) return;
      const alpha = Math.min(1, f.life / 30);
      const flicker = 0.7 + 0.3 * Math.sin(f.life * 0.5);
      ctx.globalAlpha = alpha * flicker;
      ctx.fillStyle = COL.flare;
      glow(ctx, COL.flare, 12);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3 + Math.sin(f.life * 0.3) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
      ctx.globalAlpha = 1;
    });

    // Ground
    ctx.fillStyle = COL.sand;
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 20);
    groundGrad.addColorStop(0, "#3a3060");
    groundGrad.addColorStop(1, COL.sand);
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y, CANVAS_W, 20);

    // Buildings
    g.buildings.forEach((b) => {
      if (!b.alive) {
        ctx.fillStyle = "#333";
        ctx.fillRect(b.x, CITY_Y - 8, b.w, 8);
        return;
      }
      const bTop = CITY_Y - b.h;
      const bGrad = ctx.createLinearGradient(b.x, bTop, b.x + b.w, CITY_Y);
      bGrad.addColorStop(0, "#1a2545");
      bGrad.addColorStop(1, "#0d1525");
      ctx.fillStyle = bGrad;
      ctx.fillRect(b.x, bTop, b.w, b.h);
      ctx.strokeStyle = "rgba(80,120,200,0.15)";
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, bTop, b.w, b.h);
      const winW = 4,
        winH = 5,
        gap = 8,
        cols = b.windows;
      const startX = b.x + (b.w - cols * (winW + gap) + gap) / 2;
      for (let row = 0; row < Math.floor(b.h / 15); row++) {
        for (let col = 0; col < cols; col++) {
          const lit = Math.sin(g.time * 0.01 + b.x + row + col * 3) > -0.3;
          ctx.fillStyle = lit ? COL.buildingLit : "#0a0a15";
          ctx.globalAlpha = lit ? 0.7 + Math.random() * 0.3 : 0.3;
          ctx.fillRect(startX + col * (winW + gap), bTop + 10 + row * 15, winW, winH);
        }
      }
      ctx.globalAlpha = 1;
    });

    // Burj Khalifa
    if (g.burjAlive) {
      const bx = BURJ_X,
        by = CITY_Y,
        bh = BURJ_H;
      ctx.save();
      const burjGrad = ctx.createLinearGradient(bx - 11, by - bh, bx + 11, by);
      burjGrad.addColorStop(0, "#d0d8e8");
      burjGrad.addColorStop(0.5, "#a0a8c0");
      burjGrad.addColorStop(1, "#707888");
      ctx.fillStyle = burjGrad;
      ctx.beginPath();
      ctx.moveTo(bx, by - bh - 30);
      ctx.lineTo(bx - 3, by - bh);
      ctx.lineTo(bx - 7, by - bh * 0.7);
      ctx.lineTo(bx - 11, by - bh * 0.4);
      ctx.lineTo(bx - 13, by - bh * 0.15);
      ctx.lineTo(bx - 15, by);
      ctx.lineTo(bx + 15, by);
      ctx.lineTo(bx + 13, by - bh * 0.15);
      ctx.lineTo(bx + 11, by - bh * 0.4);
      ctx.lineTo(bx + 7, by - bh * 0.7);
      ctx.lineTo(bx + 3, by - bh);
      ctx.closePath();
      ctx.fill();
      glow(ctx, COL.burjGlow, 20 + Math.sin(g.time * 0.03) * 8);
      ctx.strokeStyle = "rgba(68,136,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      glowOff(ctx);
      for (let i = 0; i < 15; i++) {
        const ly = by - bh * 0.1 - bh * 0.8 * (i / 15);
        const lw = 8 * (1 - i / 20);
        if (Math.sin(g.time * 0.05 + i * 0.5) > 0) {
          ctx.fillStyle = `rgba(68,136,255,${0.3 + Math.sin(g.time * 0.05 + i) * 0.2})`;
          ctx.fillRect(bx - lw, ly, lw * 2, 2);
        }
      }
      if (Math.sin(g.time * 0.1) > 0.5) {
        ctx.fillStyle = "#f00";
        glow(ctx, "#f00", 15);
        ctx.beginPath();
        ctx.arc(bx, by - bh - 30, 3, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
      }
      if (g.upgrades.ironBeam > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(g.time * 0.08);
        ctx.fillStyle = `rgba(255,34,0,${pulse * 0.6})`;
        ctx.beginPath();
        ctx.arc(bx, by - bh * 0.6, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      const hpW = 40,
        hpH = 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW, hpH);
      ctx.fillStyle = g.burjHealth > 2 ? "#44ff88" : g.burjHealth > 1 ? "#ffaa00" : "#ff3333";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW * (g.burjHealth / 5), hpH);
    } else {
      ctx.fillStyle = "#444";
      // Use deterministic pseudo-random offsets based on index to avoid per-frame jitter
      for (let i = 0; i < 8; i++) {
        const h1 = ((i * 7 + 3) % 13) / 13; // pseudo-random 0..1
        const h2 = ((i * 11 + 5) % 13) / 13;
        ctx.fillRect(BURJ_X - 15 + i * 4, CITY_Y - 10 - h1 * 20, 5, 10 + h2 * 15);
      }
    }

    // F-15 Eagle fighter jets
    g.planes.forEach((p) => {
      if (!p.alive) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.vx < 0) ctx.scale(-1, 1);
      // Fuselage — sleek fighter body
      ctx.fillStyle = "#7888a0";
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(10, -3);
      ctx.lineTo(-18, -3.5);
      ctx.lineTo(-22, -2);
      ctx.lineTo(-22, 2);
      ctx.lineTo(-18, 3.5);
      ctx.lineTo(10, 3);
      ctx.closePath();
      ctx.fill();
      // Nose cone — pointed
      ctx.fillStyle = "#5a6a80";
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(30, 0);
      ctx.lineTo(22, -1.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(30, 0);
      ctx.lineTo(22, 1.5);
      ctx.closePath();
      ctx.fill();
      // Swept wings
      ctx.fillStyle = "#687890";
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.lineTo(-8, -16);
      ctx.lineTo(-14, -14);
      ctx.lineTo(-6, -3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 3);
      ctx.lineTo(-8, 16);
      ctx.lineTo(-14, 14);
      ctx.lineTo(-6, 3);
      ctx.closePath();
      ctx.fill();
      // Twin vertical stabilizers
      ctx.fillStyle = "#5a6878";
      ctx.beginPath();
      ctx.moveTo(-16, -3.5);
      ctx.lineTo(-20, -10);
      ctx.lineTo(-22, -9);
      ctx.lineTo(-20, -3.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-16, 3.5);
      ctx.lineTo(-20, 10);
      ctx.lineTo(-22, 9);
      ctx.lineTo(-20, 3.5);
      ctx.closePath();
      ctx.fill();
      // Engine nozzles (twin)
      ctx.fillStyle = "#4a5060";
      ctx.beginPath();
      ctx.ellipse(-22, -2, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-22, 2, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Afterburner glow
      const abLen = 4 + Math.random() * 5;
      ctx.fillStyle = "#ff8844";
      glow(ctx, "#ff6600", 8);
      ctx.beginPath();
      ctx.moveTo(-22, -3);
      ctx.lineTo(-22 - abLen, -2);
      ctx.lineTo(-22, -1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-22, 1);
      ctx.lineTo(-22 - abLen, 2);
      ctx.lineTo(-22, 3);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
      // Cockpit
      ctx.fillStyle = "rgba(100,200,255,0.4)";
      ctx.beginPath();
      ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Nav lights
      if (Math.sin(p.blinkTimer * 0.15) > 0) {
        ctx.fillStyle = "#f00";
        glow(ctx, "#f00", 6);
        ctx.beginPath();
        ctx.arc(-10, -14, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f0";
        glow(ctx, "#0f0", 6);
        ctx.beginPath();
        ctx.arc(-10, 14, 1.5, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
      }
      ctx.restore();
    });

    // Iron Beam lasers
    g.laserBeams.forEach((b) => {
      const alpha = b.life / b.maxLife;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = COL.laser;
      glow(ctx, COL.laser, 15);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      glowOff(ctx);
      ctx.globalAlpha = 1;
    });

    // Phalanx bullets
    g.phalanxBullets.forEach((b) => {
      if (b.cx === undefined) return;
      ctx.fillStyle = COL.phalanx;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(b.cx - 1, b.cy - 1, 2, 2);
      ctx.strokeStyle = "rgba(255,136,68,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Missiles
    g.missiles.forEach((m) => {
      const angle = Math.atan2(m.vy, m.vx);

      if (m.type === "bomb") {
        // Bomb trail
        ctx.beginPath();
        m.trail.forEach((t, i) => {
          ctx.strokeStyle = `rgba(255,100,0,${(i / m.trail.length) * 0.6})`;
          ctx.lineWidth = 1.5;
          if (i === 0) ctx.moveTo(t.x, t.y);
          else ctx.lineTo(t.x, t.y);
        });
        if (m.trail.length > 1) ctx.stroke();
        ctx.fillStyle = "#ff8800";
        glow(ctx, "#ff6600", 8);
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
      } else {
        // Ballistic missile — pointed warhead with body and exhaust
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(angle);

        // Exhaust smoke trail (drawn in world space via trail points)
        ctx.restore();
        ctx.save();
        // Smoke trail
        m.trail.forEach((t, i) => {
          const a = (i / m.trail.length) * 0.35;
          const r = 2 + (1 - i / m.trail.length) * 3;
          ctx.fillStyle = `rgba(180,140,100,${a})`;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fill();
        });
        // Hot inner trail
        for (let i = Math.max(0, m.trail.length - 6); i < m.trail.length; i++) {
          const a = ((i - (m.trail.length - 6)) / 6) * 0.6;
          ctx.fillStyle = `rgba(255,200,80,${a})`;
          ctx.beginPath();
          ctx.arc(m.trail[i].x, m.trail[i].y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.translate(m.x, m.y);
        ctx.rotate(angle);

        // Missile body
        ctx.fillStyle = "#889098";
        ctx.beginPath();
        ctx.moveTo(8, 0); // nose tip
        ctx.lineTo(4, -2.5);
        ctx.lineTo(-6, -2.5);
        ctx.lineTo(-6, 2.5);
        ctx.lineTo(4, 2.5);
        ctx.closePath();
        ctx.fill();

        // Warhead (darker nose cone)
        ctx.fillStyle = "#556070";
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(4, -2.5);
        ctx.lineTo(4, 2.5);
        ctx.closePath();
        ctx.fill();

        // Fins
        ctx.fillStyle = "#667078";
        ctx.beginPath();
        ctx.moveTo(-6, -2.5);
        ctx.lineTo(-9, -6);
        ctx.lineTo(-4, -2.5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-6, 2.5);
        ctx.lineTo(-9, 6);
        ctx.lineTo(-4, 2.5);
        ctx.closePath();
        ctx.fill();

        // Rocket flame
        const flameLen = 4 + Math.random() * 6;
        ctx.fillStyle = "#ff6633";
        glow(ctx, "#ff4400", 10);
        ctx.beginPath();
        ctx.moveTo(-6, -2);
        ctx.lineTo(-6 - flameLen, 0);
        ctx.lineTo(-6, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffcc66";
        glowOff(ctx);
        ctx.beginPath();
        ctx.moveTo(-6, -1);
        ctx.lineTo(-6 - flameLen * 0.5, 0);
        ctx.lineTo(-6, 1);
        ctx.closePath();
        ctx.fill();
        glowOff(ctx);

        ctx.restore();
      }

      if (m.luredByFlare) {
        ctx.fillStyle = COL.flare;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // Drones (Shaheds)
    g.drones.forEach((d) => {
      ctx.save();
      ctx.translate(d.x, d.y);
      const facing = d.vx > 0 ? 1 : -1;
      if (d.diving) {
        const angle = Math.atan2(d.vy, d.vx);
        ctx.rotate(angle);
      } else {
        ctx.scale(facing, 1);
      }

      if (d.subtype === "shahed238") {
        // Jet Shahed-238 — sleek delta wing, larger
        ctx.fillStyle = "#4a4a5a";
        // Fuselage
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-10, -3);
        ctx.lineTo(-14, 0);
        ctx.lineTo(-10, 3);
        ctx.closePath();
        ctx.fill();
        // Delta wings
        ctx.fillStyle = "#3a3a4a";
        ctx.beginPath();
        ctx.moveTo(4, -2);
        ctx.lineTo(-8, -14);
        ctx.lineTo(-12, -2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(4, 2);
        ctx.lineTo(-8, 14);
        ctx.lineTo(-12, 2);
        ctx.closePath();
        ctx.fill();
        // Jet exhaust
        const exLen = 6 + Math.random() * 8;
        ctx.fillStyle = "#ff6600";
        glow(ctx, "#ff4400", 12);
        ctx.beginPath();
        ctx.moveTo(-14, -2);
        ctx.lineTo(-14 - exLen, 0);
        ctx.lineTo(-14, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffcc44";
        glowOff(ctx);
        ctx.beginPath();
        ctx.moveTo(-14, -1);
        ctx.lineTo(-14 - exLen * 0.5, 0);
        ctx.lineTo(-14, 1);
        ctx.closePath();
        ctx.fill();
        glowOff(ctx);
        // Dive warning indicator
        if (d.diving) {
          ctx.strokeStyle = "#ff2200";
          ctx.globalAlpha = 0.5 + Math.sin(g.time * 0.3) * 0.3;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else {
        // Prop Shahed-136 — stubby delta with pusher prop
        ctx.fillStyle = "#555566";
        // Fuselage
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-8, -2.5);
        ctx.lineTo(-10, 0);
        ctx.lineTo(-8, 2.5);
        ctx.closePath();
        ctx.fill();
        // Short delta wings
        ctx.fillStyle = "#444455";
        ctx.beginPath();
        ctx.moveTo(2, -2);
        ctx.lineTo(-6, -10);
        ctx.lineTo(-8, -2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(2, 2);
        ctx.lineTo(-6, 10);
        ctx.lineTo(-8, 2);
        ctx.closePath();
        ctx.fill();
        // Pusher propeller (rear spinning prop)
        const pa = g.time * 0.8;
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-10 - Math.cos(pa) * 5, -Math.sin(pa) * 5);
        ctx.lineTo(-10 + Math.cos(pa) * 5, Math.sin(pa) * 5);
        ctx.stroke();
      }

      // Blinking nav light
      if (Math.sin(g.time * 0.15) > 0) {
        ctx.fillStyle = d.subtype === "shahed238" ? "#ff2200" : "#ff4400";
        glow(ctx, ctx.fillStyle, 6);
        ctx.beginPath();
        ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
      }
      ctx.restore();
    });

    // Interceptors (player green, F-15 blue-white)
    g.interceptors.forEach((ic) => {
      const isF15 = ic.fromF15;
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        ctx.strokeStyle = isF15
          ? `rgba(150,200,255,${(i / ic.trail.length) * 0.6})`
          : `rgba(68,255,170,${(i / ic.trail.length) * 0.8})`;
        ctx.lineWidth = isF15 ? 1.5 : 2;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (ic.trail.length > 1) ctx.stroke();
      ctx.fillStyle = isF15 ? "#aaccff" : COL.interceptor;
      glow(ctx, isF15 ? "#6699ff" : COL.interceptor, isF15 ? 6 : 10);
      ctx.beginPath();
      ctx.arc(ic.x, ic.y, isF15 ? 2 : 3, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    });

    // Wild Hornets
    g.hornets.forEach((h) => {
      ctx.beginPath();
      h.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(255,204,0,${(i / h.trail.length) * 0.6})`;
        ctx.lineWidth = 1.5;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (h.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.hornet;
      glow(ctx, COL.hornet, 8);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,204,0,0.5)";
      ctx.fillRect(h.x - 5, h.y - 1, 3, 2);
      ctx.fillRect(h.x + 2, h.y - 1, 3, 2);
      glowOff(ctx);
    });

    // Roadrunners
    g.roadrunners.forEach((r) => {
      ctx.beginPath();
      r.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(68,170,255,${(i / r.trail.length) * 0.7})`;
        ctx.lineWidth = 2;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (r.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.roadrunner;
      glow(ctx, COL.roadrunner, 10);
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.fillRect(-4, -6, 8, 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-2, -8, 4, 3);
      ctx.restore();
      glowOff(ctx);
    });

    // Patriot missiles
    g.patriotMissiles.forEach((p) => {
      ctx.beginPath();
      p.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(136,255,68,${(i / p.trail.length) * 0.7})`;
        ctx.lineWidth = 2.5;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (p.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.patriot;
      glow(ctx, COL.patriot, 12);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    });

    // Explosions
    g.explosions.forEach((ex) => {
      ctx.globalAlpha = ex.alpha;
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, ex.radius);
      grad.addColorStop(0, "#fff");
      grad.addColorStop(0.3, ex.color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Particles
    g.particles.forEach((p) => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Launchers
    LAUNCHERS.forEach((l, i) => {
      if (g.launcherHP[i] <= 0) {
        // Destroyed rubble
        ctx.fillStyle = "#333";
        ctx.fillRect(l.x - 10, l.y - 3, 20, 6);
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(l.x - 5, l.y - 5, 8, 4);
        ctx.fillRect(l.x + 2, l.y - 4, 5, 3);
        return;
      }
      // Damaged tint
      if (g.launcherHP[i] === 1) {
        ctx.fillStyle = "#3a2020";
        ctx.fillRect(l.x - 12, l.y - 8, 24, 12);
        ctx.fillStyle = "#4a3030";
        ctx.fillRect(l.x - 8, l.y - 12, 16, 8);
      } else {
        ctx.fillStyle = "#2a3a50";
        ctx.fillRect(l.x - 12, l.y - 8, 24, 12);
        ctx.fillStyle = "#3a4a60";
        ctx.fillRect(l.x - 8, l.y - 12, 16, 8);
      }
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(l.x - 15, l.y + 8, 30, 5);
      const ammoMax = 20 + g.wave * 2;
      const ammoRatio = g.ammo[i] / ammoMax;
      ctx.fillStyle = ammoRatio > 0.3 ? COL.hud : COL.warning;
      ctx.fillRect(l.x - 15, l.y + 8, 30 * ammoRatio, 5);
      // HP pips
      for (let h = 0; h < 2; h++) {
        ctx.fillStyle = h < g.launcherHP[i] ? "#44ff88" : "#333";
        ctx.fillRect(l.x - 5 + h * 6, l.y + 15, 4, 3);
      }
      const angle = Math.atan2(g.crosshairY - l.y, g.crosshairX - l.x);
      ctx.save();
      ctx.translate(l.x, l.y - 8);
      ctx.rotate(Math.min(-0.2, Math.max(angle, -Math.PI + 0.2)));
      ctx.fillStyle = g.launcherHP[i] === 1 ? "#5a3a3a" : "#4a5a70";
      ctx.fillRect(0, -2, 18, 4);
      ctx.restore();
    });

    // Phalanx turrets
    if (g.upgrades.phalanx > 0) {
      const turrets = getPhalanxTurrets(g.upgrades.phalanx);
      turrets.forEach((t) => {
        ctx.fillStyle = "#556677";
        ctx.fillRect(t.x - 6, t.y, 12, 10);
        ctx.fillStyle = "#778899";
        ctx.fillRect(t.x - 4, t.y - 6, 8, 8);
        ctx.save();
        ctx.translate(t.x, t.y - 4);
        ctx.rotate(g.time * 0.3);
        ctx.fillStyle = "#99aabb";
        ctx.fillRect(-1, -8, 2, 8);
        ctx.restore();
        ctx.fillStyle = "rgba(255,136,68,0.6)";
        ctx.font = "7px monospace";
        ctx.fillText("CIWS", t.x - 10, t.y + 18);
      });
    }

    // Patriot launcher
    if (g.upgrades.patriot > 0) {
      ctx.fillStyle = "#3a4a30";
      ctx.fillRect(30, GROUND_Y - 15, 40, 15);
      ctx.fillStyle = "#5a6a50";
      ctx.fillRect(35, GROUND_Y - 25, 10, 12);
      ctx.fillRect(50, GROUND_Y - 22, 10, 10);
      ctx.fillStyle = "rgba(136,255,68,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("PAC-3", 30, GROUND_Y + 10);
    }

    // Flare launcher
    if (g.upgrades.flare > 0) {
      ctx.fillStyle = "#4a3a28";
      ctx.fillRect(BURJ_X - 27, GROUND_Y - 14, 10, 14);
      ctx.fillStyle = "#5a4a38";
      ctx.fillRect(BURJ_X - 26, GROUND_Y - 20, 8, 8);
      // Tubes
      ctx.fillStyle = "#3a2a18";
      for (let i = 0; i < g.upgrades.flare; i++) {
        ctx.fillRect(BURJ_X - 25 + i * 3, GROUND_Y - 24, 2, 6);
      }
      ctx.fillStyle = "rgba(255,136,51,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("FLARE", BURJ_X - 35, GROUND_Y + 10);
    }

    // Defense sites — destroyed rubble or alive glow
    g.defenseSites.forEach((site) => {
      if (!site.alive) {
        // Rubble
        ctx.fillStyle = "#333";
        ctx.fillRect(site.x - site.hw * 0.6, site.y - 3, site.hw * 1.2, 6);
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(site.x - site.hw * 0.3, site.y - 5, site.hw * 0.4, 4);
        ctx.fillRect(site.x + 2, site.y - 4, site.hw * 0.3, 3);
        ctx.fillStyle = "rgba(255,60,0,0.15)";
        ctx.fillRect(site.x - site.hw * 0.6, site.y - 5, site.hw * 1.2, 8);
      } else {
        // Subtle targeting indicator glow
        const def = UPGRADES[site.key];
        const pulse = 0.2 + 0.15 * Math.sin(g.time * 0.06);
        ctx.strokeStyle = def ? def.color : "#44ffaa";
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 1;
        ctx.strokeRect(site.x - site.hw, site.y - site.hh, site.hw * 2, site.hh * 2);
        ctx.globalAlpha = 1;
      }
    });

    // Crosshair
    if (!showShop) {
      const cx = g.crosshairX,
        cy = g.crosshairY;
      ctx.strokeStyle = "rgba(0,255,200,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy);
      ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx + 6, cy);
      ctx.lineTo(cx + 18, cy);
      ctx.moveTo(cx, cy - 18);
      ctx.lineTo(cx, cy - 6);
      ctx.moveTo(cx, cy + 6);
      ctx.lineTo(cx, cy + 18);
      ctx.stroke();
    }

    ctx.restore();

    // HUD
    ctx.fillStyle = "rgba(0,10,20,0.7)";
    ctx.fillRect(0, 0, CANVAS_W, 36);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 36);
    ctx.lineTo(CANVAS_W, 36);
    ctx.stroke();
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.fillStyle = COL.gold;
    ctx.fillText(`$ ${g.score}`, 15, 23);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`WAVE ${g.wave}`, 130, 23);
    ctx.fillStyle = g.burjAlive ? "#44ff88" : "#ff4444";
    ctx.fillText(`BURJ:${g.burjAlive ? "OK" : "XX"}`, 240, 23);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`AMMO ${g.ammo[0]}|${g.ammo[1]}|${g.ammo[2]}`, 360, 23);
    // Replay indicator
    if (g._replay) {
      ctx.fillStyle = "#ff8844";
      ctx.fillText("REPLAY", 520, 23);
    }
    // FPS
    if (g._fpsDisplay) {
      ctx.fillStyle = g._fpsDisplay >= 50 ? "#556677" : g._fpsDisplay >= 30 ? "#ffaa44" : "#ff4444";
      ctx.font = "10px 'Courier New', monospace";
      ctx.fillText(`${g._fpsDisplay} FPS`, CANVAS_W - 60, 23);
      ctx.font = "bold 12px 'Courier New', monospace";
    }

    // Wave progress bar
    const wpX = 650,
      wpW = 120,
      wpH = 8,
      wpY = 14;
    const waveProgress = Math.min(g.waveMissiles / g.waveTarget, 1);
    const threatsLeft = g.missiles.length + g.drones.length;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = waveProgress >= 1 ? "#44ff88" : COL.hud;
    ctx.fillRect(wpX, wpY, wpW * waveProgress, wpH);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.strokeRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = "#aabbcc";
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(
      waveProgress >= 1 ? `CLEAR ${threatsLeft}` : `${g.waveMissiles}/${g.waveTarget}`,
      wpX + wpW + 6,
      wpY + 7,
    );
    ctx.font = "bold 12px 'Courier New', monospace";

    // Active upgrades in HUD
    const activeUpgrades = Object.entries(g.upgrades).filter(([, v]) => v > 0);
    if (activeUpgrades.length > 0) {
      let ux = 640;
      activeUpgrades.forEach(([key, lvl]) => {
        const def = UPGRADES[key];
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.9;
        ctx.font = "11px monospace";
        ctx.fillText(`${def.icon}${lvl}`, ux, 23);
        ux += 38;
      });
      ctx.globalAlpha = 1;
    }

    // Wave cleared banner
    if (g.waveComplete && g.waveClearedTimer > 0) {
      const alpha = Math.min(1, g.waveClearedTimer / 20);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,20,10,0.6)";
      ctx.fillRect(CANVAS_W / 2 - 160, 280, 320, 50);
      ctx.strokeStyle = COL.hud;
      ctx.lineWidth = 1;
      ctx.strokeRect(CANVAS_W / 2 - 160, 280, 320, 50);
      ctx.textAlign = "center";
      ctx.font = "bold 22px 'Courier New', monospace";
      ctx.fillStyle = COL.hud;
      ctx.fillText(`WAVE ${g.wave} CLEARED`, CANVAS_W / 2, 312);
      ctx.textAlign = "left";
      ctx.restore();
    }
  }

  function drawTitle(ctx) {
    const t = performance.now() / 1000;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    skyGrad.addColorStop(0, "#050810");
    skyGrad.addColorStop(0.5, "#0a1030");
    skyGrad.addColorStop(1, "#151030");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(0,255,200,0.02)";
    for (let y = 0; y < CANVAS_H; y += 3) ctx.fillRect(0, y + ((t * 20) % 3), CANVAS_W, 1);
    ctx.textAlign = "center";
    ctx.fillStyle = COL.hud;
    glow(ctx, COL.hud, 20);
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.fillText("DUBAI", CANVAS_W / 2, 160);
    ctx.font = "bold 36px 'Courier New', monospace";
    ctx.fillText("MISSILE COMMAND", CANVAS_W / 2, 210);
    glowOff(ctx);
    ctx.fillStyle = "#ff6644";
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillText("DEFEND THE CITY  ★  PROTECT THE SKIES", CANVAS_W / 2, 250);
    // Burj silhouette
    ctx.fillStyle = "rgba(0,255,200,0.08)";
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2, 280);
    ctx.lineTo(CANVAS_W / 2 - 3, 320);
    ctx.lineTo(CANVAS_W / 2 - 8, 380);
    ctx.lineTo(CANVAS_W / 2 - 12, 480);
    ctx.lineTo(CANVAS_W / 2 + 12, 480);
    ctx.lineTo(CANVAS_W / 2 + 8, 380);
    ctx.lineTo(CANVAS_W / 2 + 3, 320);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8899aa";
    ctx.font = "13px 'Courier New', monospace";
    ctx.fillText("CLICK TO LAUNCH INTERCEPTORS", CANVAS_W / 2, 360);
    ctx.fillText("DESTROY MISSILES & DRONES", CANVAS_W / 2, 380);
    ctx.fillText("EARN SCORE TO BUY AUTOMATED DEFENSES", CANVAS_W / 2, 400);
    ctx.fillText("PROTECT BURJ KHALIFA", CANVAS_W / 2, 420);
    // Upgrade preview
    ctx.fillStyle = "#556677";
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillText("🐝 Wild Hornets  🦅 Roadrunner  🎆 Flares  ⚡ Iron Beam  🔫 Phalanx  🚀 Patriot", CANVAS_W / 2, 460);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText("[ CLICK TO START ]", CANVAS_W / 2, 520);
    ctx.textAlign = "left";
  }

  function drawGameOver(ctx) {
    const t = performance.now() / 1000;
    ctx.fillStyle = "#080008";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Animated embers / ash
    for (let i = 0; i < 300; i++) {
      const px = (Math.sin(i * 73.1 + t * 0.3) * 0.5 + 0.5) * CANVAS_W;
      const py = (i * 37.7 + t * 20) % CANVAS_H;
      ctx.fillStyle = `rgba(255,${50 + (i % 60)},0,${0.03 + Math.sin(i + t) * 0.02})`;
      ctx.fillRect(px, py, 2, 2);
    }
    // Ruined Burj silhouette
    ctx.fillStyle = "rgba(60,20,10,0.4)";
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 12, 500);
    ctx.lineTo(CANVAS_W / 2 - 8, 400);
    ctx.lineTo(CANVAS_W / 2 - 5, 360);
    ctx.lineTo(CANVAS_W / 2 - 3, 340);
    ctx.lineTo(CANVAS_W / 2 + 2, 350);
    ctx.lineTo(CANVAS_W / 2 + 6, 380);
    ctx.lineTo(CANVAS_W / 2 + 10, 420);
    ctx.lineTo(CANVAS_W / 2 + 12, 500);
    ctx.closePath();
    ctx.fill();
    // Smoke wisps
    for (let i = 0; i < 5; i++) {
      const sx = CANVAS_W / 2 + Math.sin(t + i * 1.3) * 15;
      const sy = 330 - i * 20 - ((t * 8) % 40);
      ctx.globalAlpha = 0.1 - i * 0.015;
      ctx.fillStyle = "#442222";
      ctx.beginPath();
      ctx.arc(sx, sy, 8 + i * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Title
    ctx.textAlign = "center";
    ctx.fillStyle = COL.warning;
    glow(ctx, "#ff0000", 30);
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.fillText("CITY FALLEN", CANVAS_W / 2, 140);
    glowOff(ctx);
    // Divider line
    ctx.strokeStyle = "rgba(255,60,60,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 150, 160);
    ctx.lineTo(CANVAS_W / 2 + 150, 160);
    ctx.stroke();
    // Stats
    ctx.fillStyle = "#887766";
    ctx.font = "13px 'Courier New', monospace";
    ctx.fillText("AFTER ACTION REPORT", CANVAS_W / 2, 195);
    ctx.fillStyle = "#ccbbaa";
    ctx.font = "20px 'Courier New', monospace";
    ctx.fillText(`SCORE: ${finalScore}`, CANVAS_W / 2, 240);
    ctx.fillStyle = "#aa9988";
    ctx.font = "16px 'Courier New', monospace";
    ctx.fillText(`WAVES SURVIVED: ${finalWave}`, CANVAS_W / 2, 275);
    // Rating
    let rating, ratingColor;
    if (finalWave >= 10) {
      rating = "LEGENDARY COMMANDER";
      ratingColor = COL.gold;
    } else if (finalWave >= 7) {
      rating = "VETERAN DEFENDER";
      ratingColor = "#44ffaa";
    } else if (finalWave >= 4) {
      rating = "CAPABLE OFFICER";
      ratingColor = "#88aacc";
    } else {
      rating = "CADET";
      ratingColor = "#886655";
    }
    ctx.fillStyle = ratingColor;
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.fillText(rating, CANVAS_W / 2, 310);
    // Combat stats
    ctx.strokeStyle = "rgba(255,60,60,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 120, 330);
    ctx.lineTo(CANVAS_W / 2 + 120, 330);
    ctx.stroke();
    ctx.fillStyle = "#887766";
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillText("COMBAT RECORD", CANVAS_W / 2, 352);
    ctx.fillStyle = "#aa9988";
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillText(`MISSILES DESTROYED: ${finalStats.missileKills}`, CANVAS_W / 2, 378);
    ctx.fillText(`DRONES KILLED: ${finalStats.droneKills}`, CANVAS_W / 2, 400);
    ctx.fillText(`SHOTS FIRED: ${finalStats.shotsFired}`, CANVAS_W / 2, 422);
    const totalKills = finalStats.missileKills + finalStats.droneKills;
    const hitRatio = finalStats.shotsFired > 0 ? Math.round((totalKills / finalStats.shotsFired) * 100) : 0;
    ctx.fillStyle = hitRatio >= 50 ? "#44ff88" : hitRatio >= 25 ? "#ffaa44" : "#ff4444";
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.fillText(`HIT RATIO: ${hitRatio}%`, CANVAS_W / 2, 448);
    ctx.textAlign = "left";
  }

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
        const dt = Math.min(elapsed / (1000 / 60), 3);
        lastTimeRef.current = timestamp;
        // FPS tracking
        const g = gameRef.current;
        g._fpsFrames = (g._fpsFrames || 0) + 1;
        g._fpsAccum = (g._fpsAccum || 0) + elapsed;
        if (g._fpsAccum >= 500) {
          g._fpsDisplay = Math.round((g._fpsFrames / g._fpsAccum) * 1000);
          g._fpsFrames = 0;
          g._fpsAccum = 0;
        }
        if (replayRef.current) {
          // Replay mode: step once per frame (dt=1 fixed timestep)
          const rr = replayRef.current;
          rr.step();
          if (rr.isFinished()) {
            rr.cleanup();
            replayRef.current = null;
            setReplayActive(false);
            setFinalScore(g.score);
            setFinalWave(g.wave);
            setFinalStats({ ...g.stats });
            setScreen("gameover");
          }
        } else {
          simUpdate(gameRef.current, dt, handleSimEvent);
        }
        // Stop browser laser SFX when sim clears laser handle
        if (!gameRef.current._laserHandle && gameRef.current._browserLaserHandle) {
          gameRef.current._browserLaserHandle.stop();
          gameRef.current._browserLaserHandle = null;
        }
        drawGame(ctx, gameRef.current);
      } else {
        lastTimeRef.current = null;
        if (screen === "title") {
          drawTitle(ctx);
        } else if (screen === "gameover") {
          drawGameOver(ctx);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen, finalScore, finalWave, showShop]);

  function handleCanvasClick(e) {
    if (showShop || replayActive) return;
    if (screen === "title") {
      SFX.init();
      initGame();
      setScreen("playing");
      SFX.gameStart();
    } else if (screen === "gameover") {
      return;
    } else {
      const g = gameRef.current;
      if (!g) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
      if (my < GROUND_Y - 20) {
        fireInterceptor(g, mx, my);
        SFX.fire();
      }
    }
  }

  function handleMouseMove(e) {
    if (screen !== "playing") return;
    const g = gameRef.current;
    if (!g) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    g.crosshairX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    g.crosshairY = (e.clientY - rect.top) * (CANVAS_H / rect.height);
  }

  function buyUpgrade(key) {
    const g = gameRef.current;
    if (!g) return;
    if (simBuyUpgrade(g, key)) {
      SFX.buyUpgrade();
      setShopData({ score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
    }
  }

  function closeShop() {
    const g = gameRef.current;
    if (!g) return;
    simCloseShop(g);
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
            try {
              const data = JSON.parse(reader.result);
              if (data.seed !== undefined && data.actions) {
                startReplay(data);
              }
            } catch {
              // ignore invalid files
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
            <button
              onClick={() => {
                SFX.init();
                initGame();
                setScreen("playing");
                SFX.gameStart();
              }}
              style={{
                marginTop: "420px",
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
          </div>
        )}

        {/* UPGRADE SHOP */}
        {showShop && shopData && (
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
            <div
              style={{
                background: "rgba(8,14,30,0.97)",
                border: "1px solid rgba(0,255,200,0.3)",
                borderRadius: "8px",
                padding: "18px 22px",
                maxWidth: "860px",
                width: "96%",
                boxShadow: "0 0 60px rgba(0,100,200,0.2), inset 0 0 30px rgba(0,20,40,0.5)",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: "14px" }}>
                <div style={{ color: COL.hud, fontSize: "18px", fontWeight: "bold", letterSpacing: "3px" }}>
                  ⬡ DEFENSE SYSTEMS MARKET ⬡
                </div>
                <div style={{ color: "#667788", fontSize: "11px", marginTop: "3px" }}>
                  WAVE {shopData.wave} COMPLETE — UPGRADE YOUR DEFENSES
                </div>
                <div
                  style={{
                    color: COL.gold,
                    fontSize: "16px",
                    fontWeight: "bold",
                    marginTop: "6px",
                    textShadow: "0 0 10px rgba(255,215,0,0.5)",
                  }}
                >
                  BUDGET: $ {shopData.score}
                </div>
              </div>

              <div
                style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "14px" }}
              >
                {Object.entries(UPGRADES).map(([key, def]) => {
                  const lvl = shopData.upgrades[key];
                  const maxed = lvl >= def.maxLevel;
                  const cost = maxed ? null : def.costs[lvl];
                  const canAfford = cost !== null && shopData.score >= cost;

                  return (
                    <div
                      key={key}
                      style={{
                        background: COL.panelBg,
                        border: `1px solid ${maxed ? "rgba(0,255,200,0.3)" : canAfford ? def.color + "66" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: "6px",
                        padding: "11px",
                        opacity: maxed ? 0.7 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                        <span style={{ fontSize: "20px" }}>{def.icon}</span>
                        <div>
                          <div style={{ color: def.color, fontSize: "11px", fontWeight: "bold", letterSpacing: "1px" }}>
                            {def.name.toUpperCase()}
                          </div>
                          <div style={{ display: "flex", gap: "3px", marginTop: "2px" }}>
                            {Array.from({ length: def.maxLevel }, (_, i) => (
                              <div
                                key={i}
                                style={{
                                  width: "7px",
                                  height: "7px",
                                  borderRadius: "50%",
                                  background: i < lvl ? def.color : "rgba(255,255,255,0.1)",
                                  border: `1px solid ${i < lvl ? def.color : "rgba(255,255,255,0.15)"}`,
                                  boxShadow: i < lvl ? `0 0 4px ${def.color}` : "none",
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          color: "#778899",
                          fontSize: "9.5px",
                          lineHeight: "1.4",
                          marginBottom: "7px",
                          minHeight: "26px",
                        }}
                      >
                        {def.desc}
                      </div>
                      {!maxed && (
                        <div
                          style={{
                            color: def.color,
                            fontSize: "9px",
                            opacity: 0.8,
                            marginBottom: "7px",
                            padding: "3px 5px",
                            background: "rgba(0,0,0,0.3)",
                            borderRadius: "3px",
                          }}
                        >
                          LVL {lvl + 1}: {def.statLines[lvl]}
                        </div>
                      )}
                      <button
                        onClick={() => buyUpgrade(key)}
                        disabled={maxed || !canAfford}
                        style={{
                          width: "100%",
                          padding: "5px 0",
                          background: maxed
                            ? "rgba(0,255,200,0.1)"
                            : canAfford
                              ? `${def.color}22`
                              : "rgba(255,255,255,0.03)",
                          border: `1px solid ${maxed ? "rgba(0,255,200,0.3)" : canAfford ? def.color : "rgba(255,255,255,0.1)"}`,
                          borderRadius: "4px",
                          color: maxed ? COL.hud : canAfford ? def.color : "#444",
                          fontSize: "10px",
                          fontWeight: "bold",
                          fontFamily: "'Courier New', monospace",
                          cursor: maxed || !canAfford ? "default" : "pointer",
                          letterSpacing: "1px",
                        }}
                        onMouseEnter={(e) => {
                          if (!maxed && canAfford) {
                            e.target.style.background = `${def.color}44`;
                            e.target.style.boxShadow = `0 0 12px ${def.color}33`;
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = maxed
                            ? "rgba(0,255,200,0.1)"
                            : canAfford
                              ? `${def.color}22`
                              : "rgba(255,255,255,0.03)";
                          e.target.style.boxShadow = "none";
                        }}
                      >
                        {maxed ? "✓ MAXED" : canAfford ? `UPGRADE — $${cost}` : `$${cost} NEEDED`}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div style={{ textAlign: "center" }}>
                <button
                  onClick={closeShop}
                  style={{
                    padding: "9px 36px",
                    background: "rgba(0,255,200,0.12)",
                    border: "1px solid rgba(0,255,200,0.5)",
                    borderRadius: "4px",
                    color: COL.hud,
                    fontSize: "13px",
                    fontWeight: "bold",
                    fontFamily: "'Courier New', monospace",
                    cursor: "pointer",
                    letterSpacing: "3px",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = "rgba(0,255,200,0.25)";
                    e.target.style.boxShadow = "0 0 20px rgba(0,255,200,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = "rgba(0,255,200,0.12)";
                    e.target.style.boxShadow = "none";
                  }}
                >
                  DEPLOY WAVE {shopData.wave + 1} →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ color: "#445566", fontSize: "11px", marginTop: "10px", letterSpacing: "2px" }}>
        DUBAI MISSILE COMMAND v2.0 — INTEGRATED AIR DEFENSE NETWORK
      </div>
    </div>
  );
}
