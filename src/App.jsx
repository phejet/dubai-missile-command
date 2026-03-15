import { useState, useEffect, useRef, useCallback } from "react";
import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  COL,
  BURJ_X,
  BURJ_H,
  LAUNCHERS,
  burjHalfW,
  dist,
  rand,
  randInt,
  lerp,
  pickTarget,
  fireInterceptor,
  createExplosion,
  destroyDefenseSite,
  getPhalanxTurrets,
  damageTarget,
} from "./game-logic.js";

const BUILDINGS_LEFT = [
  [40, 35, 80, 3],
  [85, 30, 120, 3],
  [125, 40, 95, 4],
  [175, 28, 140, 3],
  [210, 45, 110, 4],
  [265, 32, 70, 3],
  [305, 38, 130, 3],
  [350, 42, 100, 4],
];
const BUILDINGS_RIGHT = [
  [530, 38, 90, 3],
  [575, 32, 110, 3],
  [615, 45, 75, 4],
  [665, 30, 130, 3],
  [700, 40, 100, 4],
  [745, 35, 85, 3],
  [790, 42, 120, 3],
  [840, 28, 95, 3],
];

// ── UPGRADE DEFINITIONS ──
const UPGRADES = {
  wildHornets: {
    name: "Wild Hornets",
    icon: "🐝",
    desc: "Ukrainian FPV drone swarm. Autonomous kamikaze drones hunt incoming threats.",
    maxLevel: 3,
    costs: [1200, 3000, 7500],
    color: COL.hornet,
    statLines: ["1 drone / 4s · 25 blast", "2 drones / 3s · 30 blast", "3 drones / 2s · 40 blast"],
  },
  roadrunner: {
    name: "Anduril Roadrunner",
    icon: "🦅",
    desc: "AI-guided reusable interceptor. Launches vertically, locks nearest threat.",
    maxLevel: 3,
    costs: [1500, 3750, 9000],
    color: COL.roadrunner,
    statLines: ["1 interceptor / 5s · fast", "2 interceptors / 4s · faster", "3 interceptors / 3s · max speed"],
  },
  flare: {
    name: "Decoy Flares",
    icon: "🎆",
    desc: "Burj launches IR decoys. Incoming missiles retarget to flares and miss.",
    maxLevel: 3,
    costs: [900, 2250, 6000],
    color: COL.flare,
    statLines: ["1 flare / 5s · 30% lure chance", "2 flares / 4s · 45% lure chance", "3 flares / 3s · 60% lure chance"],
  },
  ironBeam: {
    name: "Iron Beam",
    icon: "⚡",
    desc: "High-energy laser defense. Instant beam locks on and burns down incoming projectiles.",
    maxLevel: 3,
    costs: [1800, 4500, 10500],
    color: COL.laser,
    statLines: ["1 beam · 60 range · slow charge", "2 beams · 80 range · medium", "3 beams · 100 range · fast"],
  },
  phalanx: {
    name: "Phalanx CIWS",
    icon: "🔫",
    desc: "Close-in weapon system. Last-resort rapid-fire autocannon near protected sites.",
    maxLevel: 3,
    costs: [1350, 3300, 8250],
    color: COL.phalanx,
    statLines: [
      "1 turret at Burj · 80 range",
      "+ turret at east launcher · 100 range",
      "3 turrets · 120 range · faster",
    ],
  },
  patriot: {
    name: "Patriot Battery",
    icon: "🚀",
    desc: "Long-range SAM battery. Massive blast radius, targets highest threats first.",
    maxLevel: 3,
    costs: [2250, 5250, 12000],
    color: COL.patriot,
    statLines: ["1 launch / 8s · 50 blast", "1 launch / 6s · 65 blast", "2 launches / 5s · 80 blast"],
  },
};

export default function DubaiMissileCommand() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const [screen, setScreen] = useState("title");
  const [finalScore, setFinalScore] = useState(0);
  const [finalWave, setFinalWave] = useState(1);
  const [finalStats, setFinalStats] = useState({ missileKills: 0, droneKills: 0, shotsFired: 0 });
  const [showShop, setShowShop] = useState(false);
  const [shopData, setShopData] = useState(null);

  const initGame = useCallback(() => {
    const allBuildings = [...BUILDINGS_LEFT, ...BUILDINGS_RIGHT].map(([x, w, h, win]) => ({
      x,
      w,
      h,
      windows: win,
      alive: true,
    }));

    gameRef.current = {
      score: 0,
      wave: 1,
      stats: { missileKills: 0, droneKills: 0, shotsFired: 0 },
      ammo: [22, 22, 22],
      launcherHP: [2, 2, 2],
      missiles: [],
      drones: [],
      interceptors: [],
      explosions: [],
      particles: [],
      planes: [],
      buildings: allBuildings,
      burjAlive: true,
      burjHealth: 5,
      stars: Array.from({ length: 120 }, () => ({
        x: rand(0, CANVAS_W),
        y: rand(0, CANVAS_H * 0.6),
        size: rand(0.5, 2),
        twinkle: rand(0, Math.PI * 2),
      })),
      spawnTimer: 0,
      spawnInterval: 120,
      droneTimer: 0,
      droneInterval: 180,
      planeTimer: 0,
      planeInterval: 800,
      waveMissiles: 0,
      waveTarget: 10,
      waveComplete: false,
      crosshairX: CANVAS_W / 2,
      crosshairY: CANVAS_H / 2,
      time: 0,
      shakeTimer: 0,
      shakeIntensity: 0,
      upgrades: {
        wildHornets: 0,
        roadrunner: 0,
        flare: 0,
        ironBeam: 0,
        phalanx: 0,
        patriot: 0,
      },
      defenseSites: [],
      hornets: [],
      roadrunners: [],
      laserBeams: [],
      phalanxBullets: [],
      patriotMissiles: [],
      flares: [],
      hornetTimer: 0,
      roadrunnerTimer: 0,
      ironBeamTimer: 0,
      phalanxTimer: 0,
      patriotTimer: 0,
      flareTimer: 0,
    };
    window.__gameRef = gameRef;
  }, []);

  function spawnPlane(g) {
    const goRight = Math.random() > 0.5;
    g.planes.push({
      x: goRight ? -60 : CANVAS_W + 60,
      y: rand(120, 280),
      vx: goRight ? rand(2.8, 4.0) : rand(-4.0, -2.8),
      vy: 0,
      blinkTimer: 0,
      alive: true,
      fireTimer: 0,
      fireInterval: 25,
    });
  }

  function spawnMissile(g) {
    const speed = rand(0.5, 1.0) + g.wave * 0.08;
    // From wave 2+, some missiles come from sides
    let startX, startY;
    if (g.wave >= 2 && Math.random() < Math.min(0.4, (g.wave - 1) * 0.1)) {
      const fromLeft = Math.random() > 0.5;
      startX = fromLeft ? -10 : CANVAS_W + 10;
      startY = rand(20, 200);
    } else {
      startX = rand(50, CANVAS_W - 50);
      startY = -10;
    }
    const target = pickTarget(g, startX);
    if (!target) return;
    // Avoid spawning directly above target — push spawn toward sides for a better angle
    if (Math.abs(startX - target.x) < 150 && startY < 0) {
      startX = target.x + (Math.random() > 0.5 ? 1 : -1) * rand(200, 400);
      startX = Math.max(-10, Math.min(CANVAS_W + 10, startX));
    }
    const dx = target.x - startX;
    const dy = target.y - startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    g.missiles.push({
      x: startX,
      y: startY,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      accel: 1.003 + g.wave * 0.0006,
      trail: [],
      alive: true,
      type: "missile",
    });
    g.waveMissiles++;
  }

  function spawnDrone(g) {
    const goingRight = Math.random() > 0.5;
    // Shahed-238 (jet) starts appearing at wave 4, becomes more common
    const jetChance = Math.max(0, (g.wave - 3) * 0.15);
    const isJet = g.wave >= 4 && Math.random() < jetChance;
    const baseSpeed = isJet ? rand(1.8, 2.8) : rand(0.6, 1.2);
    const speed = baseSpeed + g.wave * 0.05;
    const health = isJet ? 2 + Math.floor(g.wave / 4) : 1 + Math.floor(g.wave / 3);
    g.drones.push({
      x: goingRight ? -20 : CANVAS_W + 20,
      y: rand(80, 250),
      vx: goingRight ? speed : -speed,
      vy: rand(-0.1, 0.3),
      wobble: rand(0, Math.PI * 2),
      alive: true,
      type: "drone",
      subtype: isJet ? "shahed238" : "shahed136",
      health,
    });
  }

  // ── AUTO-DEFENSE SYSTEMS ──
  function updateAutoSystems(g, dt, allThreats) {
    // ── WILD HORNETS ──
    if (g.upgrades.wildHornets > 0) {
      const lvl = g.upgrades.wildHornets;
      const interval = [240, 180, 120][lvl - 1];
      const count = lvl;
      const blastR = [25, 30, 40][lvl - 1];
      g.hornetTimer += dt;
      if (g.hornetTimer >= interval && allThreats.length > 0) {
        g.hornetTimer = 0;
        for (let i = 0; i < count; i++) {
          const target = allThreats[randInt(0, allThreats.length - 1)];
          if (!target) continue;
          g.hornets.push({
            x: rand(100, CANVAS_W - 100),
            y: GROUND_Y - 20,
            targetRef: target,
            speed: rand(3, 4.5),
            trail: [],
            alive: true,
            blastRadius: blastR,
            wobble: rand(0, Math.PI * 2),
          });
        }
      }
      g.hornets.forEach((h) => {
        if (!h.alive) return;
        const t = h.targetRef;
        if (!t || !t.alive) {
          const newT = allThreats.find((th) => th.alive);
          if (newT) h.targetRef = newT;
          else {
            h.alive = false;
            return;
          }
        }
        h.wobble += 0.15 * dt;
        const dx = h.targetRef.x - h.x;
        const dy = h.targetRef.y - h.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 12) {
          h.alive = false;
          createExplosion(g, h.x, h.y, h.blastRadius, COL.hornet);
          return;
        }
        h.trail.push({ x: h.x, y: h.y });
        if (h.trail.length > 12) h.trail.shift();
        h.x += ((dx / d) * h.speed + Math.sin(h.wobble) * 0.8) * dt;
        h.y += ((dy / d) * h.speed + Math.cos(h.wobble) * 0.5) * dt;
      });
      g.hornets = g.hornets.filter((h) => h.alive);
    }

    // ── ANDURIL ROADRUNNER ──
    if (g.upgrades.roadrunner > 0) {
      const lvl = g.upgrades.roadrunner;
      const interval = [300, 240, 180][lvl - 1];
      const count = [1, 2, 3][lvl - 1];
      const speed = [4, 5.5, 7][lvl - 1];
      g.roadrunnerTimer += dt;
      if (g.roadrunnerTimer >= interval && allThreats.length > 0) {
        g.roadrunnerTimer = 0;
        const sorted = [...allThreats].sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(count, sorted.length); i++) {
          g.roadrunners.push({
            x: BURJ_X + rand(-30, 30),
            y: GROUND_Y - 10,
            targetRef: sorted[i],
            speed,
            trail: [],
            alive: true,
            phase: "launch",
            launchY: GROUND_Y - 80 - rand(0, 40),
          });
        }
      }
      g.roadrunners.forEach((r) => {
        if (!r.alive) return;
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 20) r.trail.shift();
        if (r.phase === "launch") {
          r.y -= speed * 0.8 * dt;
          if (r.y <= r.launchY) r.phase = "track";
        } else {
          const t = r.targetRef;
          if (!t || !t.alive) {
            const newT = allThreats.find((th) => th.alive);
            if (newT) r.targetRef = newT;
            else {
              r.alive = false;
              return;
            }
          }
          const dx = r.targetRef.x - r.x;
          const dy = r.targetRef.y - r.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 15) {
            r.alive = false;
            createExplosion(g, r.x, r.y, 30, COL.roadrunner);
            return;
          }
          r.x += (dx / d) * r.speed * dt;
          r.y += (dy / d) * r.speed * dt;
        }
      });
      g.roadrunners = g.roadrunners.filter((r) => r.alive);
    }

    // ── DECOY FLARES ──
    if (g.upgrades.flare > 0) {
      const lvl = g.upgrades.flare;
      const interval = [300, 240, 180][lvl - 1];
      const count = lvl;
      const lureChance = [0.3, 0.45, 0.6][lvl - 1];
      g.flareTimer += dt;
      if (g.flareTimer >= interval) {
        g.flareTimer = 0;
        for (let i = 0; i < count; i++) {
          const fx = BURJ_X + rand(-120, 120);
          const fy = rand(200, 420);
          g.flares.push({
            x: BURJ_X,
            y: GROUND_Y - BURJ_H * 0.5,
            tx: fx,
            ty: fy,
            vx: (fx - BURJ_X) * 0.04,
            vy: -rand(2, 4),
            life: 180,
            maxLife: 180,
            alive: true,
          });
        }
      }
      // Update flares
      g.flares.forEach((f) => {
        if (!f.alive) return;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 0.015 * dt; // slow arc
        f.vx *= 0.99 ** dt;
        f.life -= dt;
        if (f.life <= 0) f.alive = false;
        // Emit sparks
        f.sparkAccum = (f.sparkAccum || 0) + dt;
        if (f.life > 30 && f.sparkAccum >= 3) {
          f.sparkAccum -= 3;
          g.particles.push({
            x: f.x,
            y: f.y,
            vx: rand(-1, 1),
            vy: rand(-0.5, 1.5),
            life: 15,
            maxLife: 15,
            color: COL.flare,
            size: rand(1, 2.5),
          });
        }
      });
      // Lure missiles toward flares
      g.missiles.forEach((m) => {
        if (!m.alive || m.luredByFlare) return;
        const nearFlare = g.flares.find((f) => f.alive && f.life > 30 && dist(m.x, m.y, f.x, f.y) < 200);
        if (nearFlare && Math.random() < lureChance * 0.015 * dt) {
          m.luredByFlare = true;
          const dx = nearFlare.x - m.x,
            dy = nearFlare.y - m.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
          m.vx = (dx / len) * spd;
          m.vy = (dy / len) * spd;
          m.accel = 1; // stop accelerating — it's chasing a decoy
          for (let i = 0; i < 5; i++) {
            g.particles.push({
              x: m.x,
              y: m.y,
              vx: rand(-1.5, 1.5),
              vy: rand(-1.5, 1.5),
              life: 20,
              maxLife: 20,
              color: "#ffaa44",
              size: 1.5,
            });
          }
        }
      });
      g.flares = g.flares.filter((f) => f.alive);
    }

    // ── IRON BEAM ──
    if (g.upgrades.ironBeam > 0) {
      const lvl = g.upgrades.ironBeam;
      const beamCount = lvl;
      const range = [250, 320, 420][lvl - 1];
      const chargeTime = [90, 60, 40][lvl - 1];
      g.ironBeamTimer += dt;
      if (g.ironBeamTimer >= chargeTime) {
        const inRange = allThreats
          .filter((t) => t.alive && dist(t.x, t.y, BURJ_X, GROUND_Y - BURJ_H * 0.6) < range)
          .sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(beamCount, inRange.length); i++) {
          const t = inRange[i];
          g.laserBeams.push({
            x1: BURJ_X,
            y1: GROUND_Y - BURJ_H * 0.6,
            x2: t.x,
            y2: t.y,
            life: 20,
            maxLife: 20,
            targetRef: t,
          });
          damageTarget(g, t, t.type === "drone" ? 2 : 1, COL.laser, t.type === "drone" ? 20 : 15);
        }
        if (inRange.length > 0) g.ironBeamTimer = 0;
      }
      g.laserBeams.forEach((b) => (b.life -= dt));
      g.laserBeams = g.laserBeams.filter((b) => b.life > 0);
    }

    // ── PHALANX CIWS ──
    if (g.upgrades.phalanx > 0) {
      const lvl = g.upgrades.phalanx;
      const turrets = getPhalanxTurrets(lvl);
      const range = [80, 100, 120][lvl - 1];
      const fireRate = lvl >= 3 ? 3 : 5;
      g.phalanxTimer += dt;
      if (g.phalanxTimer >= fireRate) {
        g.phalanxTimer = 0;
        turrets.forEach((turret) => {
          const close = allThreats
            .filter((t) => t.alive && dist(t.x, t.y, turret.x, turret.y) < range)
            .sort((a, b) => dist(a.x, a.y, turret.x, turret.y) - dist(b.x, b.y, turret.x, turret.y));
          if (close.length > 0) {
            const t = close[0];
            g.phalanxBullets.push({
              x: turret.x,
              y: turret.y,
              tx: t.x + rand(-5, 5),
              ty: t.y + rand(-5, 5),
              life: 8,
              hit: Math.random() < 0.35,
              targetRef: t,
            });
          }
        });
      }
      g.phalanxBullets.forEach((b) => {
        b.life -= dt;
        const progress = 1 - b.life / 8;
        b.cx = lerp(b.x, b.tx, progress);
        b.cy = lerp(b.y, b.ty, progress);
        if (b.life <= 0 && b.hit && b.targetRef.alive) {
          damageTarget(g, b.targetRef, 1, COL.phalanx, b.targetRef.type === "drone" ? 15 : 12);
        }
      });
      g.phalanxBullets = g.phalanxBullets.filter((b) => b.life > 0);
    }

    // ── PATRIOT BATTERY ──
    if (g.upgrades.patriot > 0) {
      const lvl = g.upgrades.patriot;
      const interval = [480, 360, 300][lvl - 1];
      const count = lvl >= 3 ? 2 : 1;
      const blastR = [50, 65, 80][lvl - 1];
      g.patriotTimer += dt;
      if (g.patriotTimer >= interval && allThreats.length > 0) {
        g.patriotTimer = 0;
        const sorted = [...allThreats].sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(count, sorted.length); i++) {
          g.patriotMissiles.push({
            x: 50,
            y: GROUND_Y - 20,
            targetRef: sorted[i],
            speed: 3.5,
            trail: [],
            alive: true,
            blastRadius: blastR,
            phase: "launch",
            launchY: rand(100, 250),
          });
        }
      }
      g.patriotMissiles.forEach((p) => {
        if (!p.alive) return;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 25) p.trail.shift();
        if (p.phase === "launch") {
          p.y -= 3 * dt;
          if (p.y <= p.launchY) p.phase = "track";
        } else {
          const t = p.targetRef;
          if (!t || !t.alive) {
            const newT = allThreats.find((th) => th.alive);
            if (newT) p.targetRef = newT;
            else {
              p.alive = false;
              return;
            }
          }
          const dx = p.targetRef.x - p.x;
          const dy = p.targetRef.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 20) {
            p.alive = false;
            createExplosion(g, p.x, p.y, p.blastRadius, COL.patriot);
            return;
          }
          p.x += (dx / d) * p.speed * dt;
          p.y += (dy / d) * p.speed * dt;
        }
      });
      g.patriotMissiles = g.patriotMissiles.filter((p) => p.alive);
    }
  }

  function update(g, dt) {
    g.time += dt;
    if (g.shakeTimer > 0) g.shakeTimer -= dt;
    if (g.waveClearedTimer > 0) g.waveClearedTimer -= dt;

    // Game over — Burj destroyed (must tick even during waveComplete)
    if (!g.burjAlive && !g.gameOverTimer) {
      g.gameOverTimer = 60; // ~1 second of destruction before game over screen
    }
    if (g.gameOverTimer > 0) {
      g.gameOverTimer -= dt;
      if (g.gameOverTimer <= 0) {
        setShowShop(false);
        setFinalScore(g.score);
        setFinalWave(g.wave);
        setFinalStats({ ...g.stats });
        setScreen("gameover");
      }
      return;
    }

    if (g.waveComplete) {
      if (g.waveClearedTimer <= 0 && !g.shopOpened) {
        g.shopOpened = true;
        if (g.burjAlive) {
          setShopData({ score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
          setShowShop(true);
        }
      }
      return;
    }

    // Check wave complete
    if (g.burjAlive && g.waveMissiles >= g.waveTarget && g.missiles.length === 0 && g.drones.length === 0) {
      g.waveComplete = true;
      g.shopOpened = false;
      g.waveClearedTimer = 120; // ~2 seconds at 60fps
      g.score += 250 * g.wave;
      return;
    }

    // Spawning
    if (g.waveMissiles < g.waveTarget) {
      g.spawnTimer += dt;
      if (g.spawnTimer >= g.spawnInterval) {
        g.spawnTimer = 0;
        const count = Math.min(1 + Math.floor(g.wave / 2), g.waveTarget - g.waveMissiles);
        for (let i = 0; i < Math.min(count, 3); i++) spawnMissile(g);
      }
    }
    g.droneTimer += dt;
    if (g.droneTimer >= g.droneInterval && g.waveMissiles < g.waveTarget) {
      g.droneTimer = 0;
      const droneCount = 1 + Math.floor(g.wave / 3);
      for (let i = 0; i < Math.min(droneCount, 4); i++) spawnDrone(g);
    }
    g.planeTimer += dt;
    if (g.planeTimer >= g.planeInterval) {
      g.planeTimer = 0;
      spawnPlane(g);
    }

    const allThreats = [...g.missiles.filter((m) => m.alive), ...g.drones.filter((d) => d.alive)];
    updateAutoSystems(g, dt, allThreats);

    // Update missiles
    g.missiles.forEach((m) => {
      if (!m.alive) return;
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 30) m.trail.shift();
      if (m.accel) {
        m.vx *= m.accel ** dt;
        m.vy *= m.accel ** dt;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // Burj collision — matches rendered tapered shape
      if (
        g.burjAlive &&
        m.alive &&
        m.y >= GROUND_Y - BURJ_H - 30 &&
        m.y <= GROUND_Y &&
        Math.abs(m.x - BURJ_X) < burjHalfW(m.y)
      ) {
        m.alive = false;
        createExplosion(g, m.x, m.y, 30, "#ff4400");
        g.shakeTimer = 10;
        g.shakeIntensity = 4;
        g.burjHealth--;
        if (g.burjHealth <= 0) {
          g.burjAlive = false;
          createExplosion(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200");
        }
      }
      // Building collisions
      if (m.alive) {
        g.buildings.forEach((b) => {
          if (b.alive && m.alive && m.x >= b.x && m.x <= b.x + b.w && m.y >= GROUND_Y - b.h) {
            m.alive = false;
            createExplosion(g, m.x, m.y, 20, "#ff4400");
            b.alive = false;
          }
        });
      }
      // Defense site collisions
      if (m.alive) {
        g.defenseSites.forEach((site) => {
          if (site.alive && m.alive && Math.abs(m.x - site.x) < site.hw && Math.abs(m.y - site.y) < site.hh) {
            m.alive = false;
            destroyDefenseSite(g, site);
            createExplosion(g, m.x, m.y, 35, "#ff4400");
            g.shakeTimer = 12;
            g.shakeIntensity = 5;
          }
        });
      }
      // Launcher collision
      if (m.alive) {
        LAUNCHERS.forEach((l, i) => {
          if (g.launcherHP[i] > 0 && m.alive && Math.abs(m.x - l.x) < 15 && m.y >= l.y - 12) {
            m.alive = false;
            g.launcherHP[i]--;
            createExplosion(g, m.x, m.y, 25, "#ff4400");
            g.shakeTimer = 10;
            g.shakeIntensity = 4;
            if (g.launcherHP[i] <= 0) g.ammo[i] = 0;
          }
        });
      }
      // Ground impact
      if (m.alive && m.y >= GROUND_Y) {
        m.alive = false;
        createExplosion(g, m.x, GROUND_Y, 25, "#ff4400");
      }
      if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
    });

    // Update drones (Shaheds)
    g.drones.forEach((d) => {
      if (!d.alive) return;
      d.wobble += 0.05 * dt;
      if (d.subtype === "shahed238") {
        // Jet Shahed — dives toward a target after crossing ~40% of screen
        if (!d.diving && ((d.vx > 0 && d.x > CANVAS_W * 0.3) || (d.vx < 0 && d.x < CANVAS_W * 0.7))) {
          if (Math.random() < 0.02 * dt) {
            d.diving = true;
            const t = pickTarget(g, d.x);
            if (t) d.diveTarget = t;
          }
        }
        if (d.diving && d.diveTarget) {
          const dx = d.diveTarget.x - d.x;
          const dy = d.diveTarget.y - d.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const diveSpeed = Math.abs(d.vx) * 1.2;
          d.vx = (dx / len) * diveSpeed;
          d.vy = (dy / len) * diveSpeed;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        } else {
          d.x += d.vx * dt;
          d.y += (d.vy + Math.sin(d.wobble) * 0.15) * dt;
        }
      } else {
        // Prop Shahed-136 — cruises, drops 1 bomb, then dives to Burj
        if (!d.diving) {
          d.x += d.vx * dt;
          d.y += (d.vy + Math.sin(d.wobble) * 0.3) * dt;
          // Drop bomb and begin dive near mid-screen
          const nearMid = (d.vx > 0 && d.x > CANVAS_W * 0.35) || (d.vx < 0 && d.x < CANVAS_W * 0.65);
          if (!d.bombDropped && nearMid) {
            d.bombDropped = true;
            const bombT = pickTarget(g, d.x);
            if (bombT) {
              const tx = bombT.x;
              g.missiles.push({
                x: d.x,
                y: d.y,
                vx: (tx - d.x) * 0.002,
                vy: rand(1.2, 2.0),
                trail: [],
                alive: true,
                type: "bomb",
              });
            }
            // Immediately begin kamikaze dive
            d.diving = true;
            const diveT = pickTarget(g, d.x);
            d.diveTarget = diveT || { x: BURJ_X, y: CITY_Y };
          }
        } else {
          // Diving
          const dx = d.diveTarget.x - d.x;
          const dy = d.diveTarget.y - d.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const diveSpeed = Math.max(Math.abs(d.vx), 1.0) * 1.1;
          d.vx = (dx / len) * diveSpeed;
          d.vy = (dy / len) * diveSpeed;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
      }
      if (d.x < -60 || d.x > CANVAS_W + 60 || d.y > CANVAS_H + 20) d.alive = false;
      // Shahed impact — kamikaze: hit dive target or ground
      if (d.diving && d.diveTarget && d.alive) {
        const hitTarget = dist(d.x, d.y, d.diveTarget.x, d.diveTarget.y) < 20;
        const hitGround = d.y >= GROUND_Y - 5;
        if (hitTarget || hitGround) {
          d.alive = false;
          createExplosion(g, d.x, d.y, 40, "#ff6600");
          g.shakeTimer = 15;
          g.shakeIntensity = 6;
          g.buildings.forEach((b) => {
            if (b.alive && Math.abs(d.x - (b.x + b.w / 2)) < b.w / 2 + 30) {
              b.alive = false;
            }
          });
          g.defenseSites.forEach((site) => {
            if (site.alive && Math.abs(d.x - site.x) < site.hw + 20 && Math.abs(d.y - site.y) < site.hh + 20) {
              destroyDefenseSite(g, site);
            }
          });
          LAUNCHERS.forEach((l, i) => {
            if (g.launcherHP[i] > 0 && Math.abs(d.x - l.x) < 30) {
              g.launcherHP[i]--;
              if (g.launcherHP[i] <= 0) g.ammo[i] = 0;
            }
          });
          if (g.burjAlive && Math.abs(d.x - BURJ_X) < 50) {
            g.burjHealth--;
            if (g.burjHealth <= 0) {
              g.burjAlive = false;
              createExplosion(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200");
            }
          }
        }
      }
    });

    // Update interceptors (player + F-15)
    g.interceptors.forEach((ic) => {
      if (!ic.alive) return;
      ic.trail.push({ x: ic.x, y: ic.y });
      if (ic.trail.length > 15) ic.trail.shift();
      ic.x += ic.vx * dt;
      ic.y += ic.vy * dt;
      if (dist(ic.x, ic.y, ic.targetX, ic.targetY) < 16) {
        ic.alive = false;
        if (ic.fromF15) {
          createExplosion(g, ic.x, ic.y, 30, "#aaccff", false);
        } else {
          createExplosion(g, ic.x, ic.y, 49, COL.interceptor, true);
        }
      }
      // F-15 shots that go off-screen
      if (ic.fromF15 && (ic.x < -50 || ic.x > CANVAS_W + 50 || ic.y < -50 || ic.y > CANVAS_H + 50)) ic.alive = false;
    });

    // Explosion collisions
    g.explosions.forEach((ex) => {
      if (ex.growing) {
        ex.radius += 2 * dt;
        if (ex.radius >= ex.maxRadius) ex.growing = false;
      } else ex.alpha -= 0.03 * dt;
      if (ex.alpha > 0.2) {
        g.missiles.forEach((m) => {
          if (m.alive && dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
            m.alive = false;
            g.score += m.type === "bomb" ? 75 : 50;
            g.stats.missileKills++;
            createExplosion(g, m.x, m.y, 30, "#ffcc00", ex.playerCaused);
          }
        });
        g.drones.forEach((d) => {
          if (!d.alive) return;
          if (!d._hitByExplosions) d._hitByExplosions = new Set();
          if (d._hitByExplosions.has(ex.id)) return;
          if (dist(d.x, d.y, ex.x, ex.y) < ex.radius + 10) {
            d._hitByExplosions.add(ex.id);
            d.health--;
            if (d.health <= 0) {
              d.alive = false;
              g.score += d.subtype === "shahed238" ? 250 : 150;
              g.stats.droneKills++;
              createExplosion(g, d.x, d.y, 60, "#ff8800", ex.playerCaused);
            }
          }
        });
      }
    });

    // F-15s — fast fighter jets that shoot down threats
    g.planes.forEach((p) => {
      if (!p.alive) return;
      p.blinkTimer += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Shoot at nearest threat
      p.fireTimer += dt;
      if (p.fireTimer >= p.fireInterval) {
        let closest = null,
          closestD = 200; // engagement range
        allThreats.forEach((t) => {
          const d2 = dist(p.x, p.y, t.x, t.y);
          if (d2 < closestD) {
            closestD = d2;
            closest = t;
          }
        });
        if (closest) {
          p.fireTimer = 0;
          // Fire air-to-air shot
          const dx = closest.x - p.x,
            dy = closest.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const spd = 8;
          g.interceptors.push({
            x: p.x,
            y: p.y,
            targetX: closest.x,
            targetY: closest.y,
            vx: (dx / len) * spd,
            vy: (dy / len) * spd,
            trail: [],
            alive: true,
            fromF15: true,
          });
        }
      }
      // Player interceptor explosions hit F-15 — penalty
      g.explosions.forEach((ex) => {
        if (ex.playerCaused && ex.alpha > 0.2 && p.alive && dist(p.x, p.y, ex.x, ex.y) < ex.radius + 15) {
          p.alive = false;
          g.score -= 500;
          createExplosion(g, p.x, p.y, 40, "#ff0000");
        }
      });
      // Enemy missile/drone hits F-15
      g.missiles.forEach((m) => {
        if (m.alive && p.alive && dist(m.x, m.y, p.x, p.y) < 20) {
          p.alive = false;
          m.alive = false;
          createExplosion(g, p.x, p.y, 40, "#ff0000");
        }
      });
      if (p.x < -80 || p.x > CANVAS_W + 80) p.alive = false;
    });

    g.particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.05 * dt;
      p.life -= dt;
    });

    // Cleanup
    g.missiles = g.missiles.filter((m) => m.alive);
    g.drones = g.drones.filter((d) => d.alive);
    g.interceptors = g.interceptors.filter((ic) => ic.alive);
    g.explosions = g.explosions.filter((ex) => ex.alpha > 0);
    g.particles = g.particles.filter((p) => p.life > 0);
    g.planes = g.planes.filter((p) => p.alive);
  }

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
      ctx.shadowColor = COL.flare;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3 + Math.sin(f.life * 0.3) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
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
      ctx.shadowColor = COL.burjGlow;
      ctx.shadowBlur = 20 + Math.sin(g.time * 0.03) * 8;
      ctx.strokeStyle = "rgba(68,136,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.shadowBlur = 0;
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
        ctx.shadowColor = "#f00";
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(bx, by - bh - 30, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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
      ctx.shadowColor = "#ff6600";
      ctx.shadowBlur = 8;
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
      ctx.shadowBlur = 0;
      // Cockpit
      ctx.fillStyle = "rgba(100,200,255,0.4)";
      ctx.beginPath();
      ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Nav lights
      if (Math.sin(p.blinkTimer * 0.15) > 0) {
        ctx.fillStyle = "#f00";
        ctx.shadowColor = "#f00";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(-10, -14, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f0";
        ctx.shadowColor = "#0f0";
        ctx.beginPath();
        ctx.arc(-10, 14, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    });

    // Iron Beam lasers
    g.laserBeams.forEach((b) => {
      const alpha = b.life / b.maxLife;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = COL.laser;
      ctx.shadowColor = COL.laser;
      ctx.shadowBlur = 15;
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
      ctx.shadowBlur = 0;
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
        ctx.shadowColor = "#ff6600";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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
        ctx.shadowColor = "#ff4400";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(-6, -2);
        ctx.lineTo(-6 - flameLen, 0);
        ctx.lineTo(-6, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffcc66";
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(-6, -1);
        ctx.lineTo(-6 - flameLen * 0.5, 0);
        ctx.lineTo(-6, 1);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

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
        ctx.shadowColor = "#ff4400";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(-14, -2);
        ctx.lineTo(-14 - exLen, 0);
        ctx.lineTo(-14, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffcc44";
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(-14, -1);
        ctx.lineTo(-14 - exLen * 0.5, 0);
        ctx.lineTo(-14, 1);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
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
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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
      ctx.shadowColor = isF15 ? "#6699ff" : COL.interceptor;
      ctx.shadowBlur = isF15 ? 6 : 10;
      ctx.beginPath();
      ctx.arc(ic.x, ic.y, isF15 ? 2 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
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
      ctx.shadowColor = COL.hornet;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,204,0,0.5)";
      ctx.fillRect(h.x - 5, h.y - 1, 3, 2);
      ctx.fillRect(h.x + 2, h.y - 1, 3, 2);
      ctx.shadowBlur = 0;
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
      ctx.shadowColor = COL.roadrunner;
      ctx.shadowBlur = 10;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.fillRect(-4, -6, 8, 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-2, -8, 4, 3);
      ctx.restore();
      ctx.shadowBlur = 0;
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
      ctx.shadowColor = COL.patriot;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
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
    ctx.shadowColor = COL.hud;
    ctx.shadowBlur = 20;
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.fillText("DUBAI", CANVAS_W / 2, 160);
    ctx.font = "bold 36px 'Courier New', monospace";
    ctx.fillText("MISSILE COMMAND", CANVAS_W / 2, 210);
    ctx.shadowBlur = 0;
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
    ctx.shadowColor = "#ff0000";
    ctx.shadowBlur = 30;
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.fillText("CITY FALLEN", CANVAS_W / 2, 140);
    ctx.shadowBlur = 0;
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
      if (screen === "playing" && gameRef.current) {
        if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
        const dt = Math.min((timestamp - lastTimeRef.current) / (1000 / 60), 3);
        lastTimeRef.current = timestamp;
        update(gameRef.current, dt);
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
    if (showShop) return;
    if (screen === "title") {
      initGame();
      setScreen("playing");
    } else if (screen === "gameover") {
      return;
    } else {
      const g = gameRef.current;
      if (!g) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
      const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
      if (my < GROUND_Y - 20) fireInterceptor(g, mx, my);
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
    const def = UPGRADES[key];
    const lvl = g.upgrades[key];
    if (lvl >= def.maxLevel) return;
    const cost = def.costs[lvl];
    if (g.score < cost) return;
    g.score -= cost;
    g.upgrades[key]++;
    // Register or revive defense site
    const existingSite = g.defenseSites.find((s) => s.key === key);
    if (existingSite) {
      existingSite.alive = true;
    } else {
      const siteDefs = {
        patriot: { x: 50, y: GROUND_Y - 15, hw: 25, hh: 15 },
        flare: { x: 380, y: GROUND_Y - 18, hw: 12, hh: 20 },
        ironBeam: { x: 320, y: GROUND_Y - 15, hw: 10, hh: 15 },
        wildHornets: { x: 150, y: GROUND_Y - 15, hw: 20, hh: 15 },
        roadrunner: { x: 620, y: GROUND_Y - 15, hw: 20, hh: 15 },
      };
      if (key === "phalanx") {
        g.defenseSites.push({ key: "phalanx", x: 720, y: GROUND_Y - 30, alive: true, hw: 10, hh: 15 });
      } else if (siteDefs[key]) {
        const sd = siteDefs[key];
        g.defenseSites.push({ key, x: sd.x, y: sd.y, alive: true, hw: sd.hw, hh: sd.hh });
      }
    }
    setShopData({ score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
  }

  function closeShop() {
    const g = gameRef.current;
    if (!g) return;
    g.wave++;
    g.waveMissiles = 0;
    g.waveTarget = 10 + g.wave * 5;
    g.spawnInterval = Math.max(20, 110 - g.wave * 10);
    g.droneInterval = Math.max(40, 160 - g.wave * 20);
    g.launcherHP = g.launcherHP.map((hp) => (hp > 0 ? 2 : 0));
    g.ammo = g.ammo.map((_, i) => (g.launcherHP[i] > 0 ? 20 + g.wave * 2 : 0));
    g.waveComplete = false;
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
      <div style={{ position: "relative" }}>
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
                initGame();
                setScreen("playing");
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
