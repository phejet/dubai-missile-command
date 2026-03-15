import { useState, useEffect, useRef, useCallback } from "react";

const CANVAS_W = 900;
const CANVAS_H = 640;
const GROUND_Y = 570;
const CITY_Y = GROUND_Y;

const COL = {
  sky1: "#0a0e1a", sky2: "#1a1040", sky3: "#2a1050",
  ground: "#1a1a2e", sand: "#2d2845",
  burj: "#c0c8d8", burjGlow: "#4488ff",
  building: "#1a2040", buildingLit: "#ffdd66",
  missile: "#ff3333", drone: "#ff6600",
  interceptor: "#44ffaa", explosion: "#ffaa00",
  plane: "#ffffff", planeLight: "#ff0000",
  runway: "#445566", text: "#ffffff",
  hud: "#00ffcc", warning: "#ff4444",
  gold: "#ffd700", upgradeBg: "#0c1225",
  panelBg: "#111a30", panelBorder: "#1a3060",
  laser: "#ff2200", ecm: "#aa44ff",
  hornet: "#ffcc00", roadrunner: "#44aaff",
  phalanx: "#ff8844", patriot: "#88ff44",
};

const BUILDINGS_LEFT = [
  [40, 35, 80, 3], [85, 30, 120, 3], [125, 40, 95, 4], [175, 28, 140, 3],
  [210, 45, 110, 4], [265, 32, 70, 3], [305, 38, 130, 3], [350, 42, 100, 4],
];
const BUILDINGS_RIGHT = [];

const BURJ_X = 460;
const BURJ_H = 340;
const AIRPORT_X = 700;
const AIRPORT_Y = GROUND_Y - 8;
const RUNWAY_W = 160;

// Burj half-width at a given y — matches the rendered tapered silhouette
// Rendered shape: spire tip at y=GROUND_Y-BURJ_H-30 (w=0),
// then ±3 at top of tower, tapering to ±15 at base
const BURJ_SHAPE = [[1.0, 3], [0.7, 7], [0.4, 11], [0.15, 13], [0, 15]];
function burjHalfW(py) {
  if (py < GROUND_Y - BURJ_H - 30 || py > GROUND_Y) return 0;
  if (py < GROUND_Y - BURJ_H) return 1; // spire
  const t = (GROUND_Y - py) / BURJ_H; // 1=top, 0=base
  for (let i = 0; i < BURJ_SHAPE.length - 1; i++) {
    const [t0, w0] = BURJ_SHAPE[i], [t1, w1] = BURJ_SHAPE[i + 1];
    if (t <= t0 && t >= t1) return w1 + (t - t1) / (t0 - t1) * (w0 - w1);
  }
  return 15;
}

const LAUNCHERS = [
  { x: 100, y: GROUND_Y - 5 },
  { x: 450, y: GROUND_Y - 5 },
  { x: 800, y: GROUND_Y - 5 },
];

// ── UPGRADE DEFINITIONS ──
const UPGRADES = {
  wildHornets: {
    name: "Wild Hornets",
    icon: "🐝",
    desc: "Ukrainian FPV drone swarm. Autonomous kamikaze drones hunt incoming threats.",
    maxLevel: 3,
    costs: [800, 2000, 5000],
    color: COL.hornet,
    statLines: [
      "1 drone / 4s · 25 blast",
      "2 drones / 3s · 30 blast",
      "3 drones / 2s · 40 blast",
    ],
  },
  roadrunner: {
    name: "Anduril Roadrunner",
    icon: "🦅",
    desc: "AI-guided reusable interceptor. Launches vertically, locks nearest threat.",
    maxLevel: 3,
    costs: [1000, 2500, 6000],
    color: COL.roadrunner,
    statLines: [
      "1 interceptor / 5s · fast",
      "2 interceptors / 4s · faster",
      "3 interceptors / 3s · max speed",
    ],
  },
  ecm: {
    name: "ECM Jammer",
    icon: "📡",
    desc: "Electronic countermeasures. Disrupts guidance — missiles veer off course, drones slow.",
    maxLevel: 3,
    costs: [600, 1500, 4000],
    color: COL.ecm,
    statLines: [
      "10% deflection · small radius",
      "20% deflection · medium radius",
      "35% deflection · full coverage",
    ],
  },
  ironBeam: {
    name: "Iron Beam",
    icon: "⚡",
    desc: "High-energy laser defense. Instant beam locks on and burns down incoming projectiles.",
    maxLevel: 3,
    costs: [1200, 3000, 7000],
    color: COL.laser,
    statLines: [
      "1 beam · 60 range · slow charge",
      "2 beams · 80 range · medium",
      "3 beams · 100 range · fast",
    ],
  },
  phalanx: {
    name: "Phalanx CIWS",
    icon: "🔫",
    desc: "Close-in weapon system. Last-resort rapid-fire autocannon near protected sites.",
    maxLevel: 3,
    costs: [900, 2200, 5500],
    color: COL.phalanx,
    statLines: [
      "1 turret at Burj · 80 range",
      "+ turret at DXB · 100 range",
      "3 turrets · 120 range · faster",
    ],
  },
  patriot: {
    name: "Patriot Battery",
    icon: "🚀",
    desc: "Long-range SAM battery. Massive blast radius, targets highest threats first.",
    maxLevel: 3,
    costs: [1500, 3500, 8000],
    color: COL.patriot,
    statLines: [
      "1 launch / 8s · 50 blast",
      "1 launch / 6s · 65 blast",
      "2 launches / 5s · 80 blast",
    ],
  },
};

function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function lerp(a, b, t) { return a + (b - a) * t; }

export default function DubaiMissileCommand() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const rafRef = useRef(null);
  const [screen, setScreen] = useState("title");
  const [finalScore, setFinalScore] = useState(0);
  const [finalWave, setFinalWave] = useState(1);
  const [showShop, setShowShop] = useState(false);
  const [shopData, setShopData] = useState(null);
  const [, forceUpdate] = useState(0);

  const initGame = useCallback(() => {
    const allBuildings = [...BUILDINGS_LEFT, ...BUILDINGS_RIGHT].map(([x, w, h, win]) => ({
      x, w, h, windows: win, alive: true, damage: 0,
    }));

    gameRef.current = {
      score: 0, wave: 1, lives: 3,
      ammo: [22, 22, 22],
      missiles: [], drones: [], interceptors: [],
      explosions: [], particles: [], planes: [],
      buildings: allBuildings,
      burjAlive: true, burjHealth: 5,
      airportAlive: true, airportHealth: 3,
      stars: Array.from({ length: 120 }, () => ({
        x: rand(0, CANVAS_W), y: rand(0, CANVAS_H * 0.6),
        size: rand(0.5, 2), twinkle: rand(0, Math.PI * 2),
      })),
      spawnTimer: 0, spawnInterval: 120,
      droneTimer: 0, droneInterval: 300,
      planeTimer: 0, planeInterval: 400,
      waveMissiles: 0, waveTarget: 10,
      waveTransition: 0, waveComplete: false,
      crosshairX: CANVAS_W / 2, crosshairY: CANVAS_H / 2,
      time: 0, shakeTimer: 0, shakeIntensity: 0,
      upgrades: {
        wildHornets: 0, roadrunner: 0, ecm: 0,
        ironBeam: 0, phalanx: 0, patriot: 0,
      },
      hornets: [], roadrunners: [], laserBeams: [],
      phalanxBullets: [], patriotMissiles: [], ecmPulses: [],
      hornetTimer: 0, roadrunnerTimer: 0,
      ironBeamTimer: 0, phalanxTimer: 0,
      patriotTimer: 0, ecmTimer: 0,
    };
    spawnPlane(gameRef.current);
    window.__gameRef = gameRef;
  }, []);

  function spawnPlane(g) {
    if (!g.airportAlive) return;
    const startY = rand(50, 100);
    g.planes.push({
      x: CANVAS_W + 60, y: startY,
      vx: -1, vy: 0, startY,
      blinkTimer: 0, alive: true, landed: false, t: 0,
    });
  }

  function spawnMissile(g) {
    const targets = [];
    g.buildings.forEach(b => { if (b.alive) targets.push({ x: b.x + b.w / 2, y: CITY_Y }); });
    if (g.burjAlive) targets.push({ x: BURJ_X, y: CITY_Y });
    if (g.airportAlive) targets.push({ x: AIRPORT_X + RUNWAY_W / 2, y: AIRPORT_Y });
    if (targets.length === 0) return;
    const target = targets[randInt(0, targets.length - 1)];
    const startX = rand(50, CANVAS_W - 50);
    const speed = rand(0.5, 1.0) + g.wave * 0.08;
    const dx = target.x - startX;
    const dy = target.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    g.missiles.push({
      x: startX, y: -10,
      vx: (dx / len) * speed, vy: (dy / len) * speed,
      trail: [], alive: true, type: "missile", ecmAffected: false,
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
    const health = isJet
      ? 2 + Math.floor(g.wave / 4)
      : 1 + Math.floor(g.wave / 3);
    g.drones.push({
      x: goingRight ? -20 : CANVAS_W + 20,
      y: rand(80, 250),
      vx: goingRight ? speed : -speed,
      vy: rand(-0.1, 0.3),
      wobble: rand(0, Math.PI * 2),
      alive: true, type: "drone",
      subtype: isJet ? "shahed238" : "shahed136",
      health,
      ecmSlowed: false,
    });
  }

  function fireInterceptor(g, targetX, targetY) {
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < LAUNCHERS.length; i++) {
      if (g.ammo[i] <= 0) continue;
      const d = dist(LAUNCHERS[i].x, LAUNCHERS[i].y, targetX, targetY);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx === -1) return;
    g.ammo[bestIdx]--;
    const l = LAUNCHERS[bestIdx];
    const speed = 5;
    const dx = targetX - l.x;
    const dy = targetY - l.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    g.interceptors.push({
      x: l.x, y: l.y, targetX, targetY,
      vx: (dx / len) * speed, vy: (dy / len) * speed,
      trail: [], alive: true,
    });
  }

  function createExplosion(g, x, y, radius, color, playerCaused) {
    g.explosions.push({ x, y, radius: 0, maxRadius: radius, growing: true, alpha: 1, color: color || COL.explosion, playerCaused: !!playerCaused });
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      const sp = rand(1, 4);
      g.particles.push({
        x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
        life: rand(20, 50), maxLife: 50,
        color: Math.random() > 0.5 ? "#ffcc00" : "#ff6600", size: rand(1, 3),
      });
    }
    g.shakeTimer = 8;
    g.shakeIntensity = radius / 10;
  }

  // ── AUTO-DEFENSE SYSTEMS ──
  function updateAutoSystems(g) {
    const allThreats = [...g.missiles.filter(m => m.alive), ...g.drones.filter(d => d.alive)];

    // ── WILD HORNETS ──
    if (g.upgrades.wildHornets > 0) {
      const lvl = g.upgrades.wildHornets;
      const interval = [240, 180, 120][lvl - 1];
      const count = lvl;
      const blastR = [25, 30, 40][lvl - 1];
      g.hornetTimer++;
      if (g.hornetTimer >= interval && allThreats.length > 0) {
        g.hornetTimer = 0;
        for (let i = 0; i < count; i++) {
          const target = allThreats[randInt(0, allThreats.length - 1)];
          if (!target) continue;
          g.hornets.push({
            x: rand(100, CANVAS_W - 100), y: GROUND_Y - 20,
            targetRef: target, speed: rand(3, 4.5),
            trail: [], alive: true, blastRadius: blastR,
            wobble: rand(0, Math.PI * 2),
          });
        }
      }
      g.hornets.forEach(h => {
        if (!h.alive) return;
        const t = h.targetRef;
        if (!t || !t.alive) {
          const newT = allThreats.find(th => th.alive);
          if (newT) h.targetRef = newT; else { h.alive = false; return; }
        }
        h.wobble += 0.15;
        const dx = h.targetRef.x - h.x;
        const dy = h.targetRef.y - h.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 12) { h.alive = false; createExplosion(g, h.x, h.y, h.blastRadius, COL.hornet); return; }
        h.trail.push({ x: h.x, y: h.y });
        if (h.trail.length > 12) h.trail.shift();
        h.x += (dx / d) * h.speed + Math.sin(h.wobble) * 0.8;
        h.y += (dy / d) * h.speed + Math.cos(h.wobble) * 0.5;
      });
      g.hornets = g.hornets.filter(h => h.alive);
    }

    // ── ANDURIL ROADRUNNER ──
    if (g.upgrades.roadrunner > 0) {
      const lvl = g.upgrades.roadrunner;
      const interval = [300, 240, 180][lvl - 1];
      const count = [1, 2, 3][lvl - 1];
      const speed = [4, 5.5, 7][lvl - 1];
      g.roadrunnerTimer++;
      if (g.roadrunnerTimer >= interval && allThreats.length > 0) {
        g.roadrunnerTimer = 0;
        const sorted = [...allThreats].sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(count, sorted.length); i++) {
          g.roadrunners.push({
            x: BURJ_X + rand(-30, 30), y: GROUND_Y - 10,
            targetRef: sorted[i], speed, trail: [], alive: true,
            phase: "launch", launchY: GROUND_Y - 80 - rand(0, 40),
          });
        }
      }
      g.roadrunners.forEach(r => {
        if (!r.alive) return;
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 20) r.trail.shift();
        if (r.phase === "launch") {
          r.y -= speed * 0.8;
          if (r.y <= r.launchY) r.phase = "track";
        } else {
          const t = r.targetRef;
          if (!t || !t.alive) {
            const newT = allThreats.find(th => th.alive);
            if (newT) r.targetRef = newT; else { r.alive = false; return; }
          }
          const dx = r.targetRef.x - r.x;
          const dy = r.targetRef.y - r.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 15) { r.alive = false; createExplosion(g, r.x, r.y, 30, COL.roadrunner); return; }
          r.x += (dx / d) * r.speed;
          r.y += (dy / d) * r.speed;
        }
      });
      g.roadrunners = g.roadrunners.filter(r => r.alive);
    }

    // ── ECM JAMMER ──
    if (g.upgrades.ecm > 0) {
      const lvl = g.upgrades.ecm;
      const chance = [0.10, 0.20, 0.35][lvl - 1];
      const radius = [200, 350, CANVAS_W][lvl - 1];
      g.ecmTimer++;
      if (g.ecmTimer % 30 === 0) {
        g.ecmPulses.push({ x: BURJ_X, y: GROUND_Y - 100, radius: 0, maxRadius: radius, alpha: 0.3 });
      }
      g.missiles.forEach(m => {
        if (!m.alive) return;
        const d = dist(m.x, m.y, BURJ_X, GROUND_Y - 100);
        if (d < radius && !m.ecmAffected && Math.random() < chance * 0.02) {
          m.ecmAffected = true;
          m.vx += rand(-0.8, 0.8);
          m.vy *= rand(0.5, 0.8);
          for (let i = 0; i < 4; i++) {
            g.particles.push({ x: m.x, y: m.y, vx: rand(-2, 2), vy: rand(-2, 2), life: 15, maxLife: 15, color: COL.ecm, size: 1.5 });
          }
        }
      });
      g.drones.forEach(d => {
        if (!d.alive) return;
        const dd = dist(d.x, d.y, BURJ_X, GROUND_Y - 100);
        if (dd < radius && !d.ecmSlowed) { d.ecmSlowed = true; d.vx *= 0.5; }
      });
      g.ecmPulses.forEach(p => { p.radius += 4; p.alpha -= 0.005; });
      g.ecmPulses = g.ecmPulses.filter(p => p.alpha > 0);
    }

    // ── IRON BEAM ──
    if (g.upgrades.ironBeam > 0) {
      const lvl = g.upgrades.ironBeam;
      const beamCount = lvl;
      const range = [250, 320, 420][lvl - 1];
      const chargeTime = [90, 60, 40][lvl - 1];
      g.ironBeamTimer++;
      if (g.ironBeamTimer >= chargeTime) {
        const inRange = allThreats.filter(t =>
          t.alive && dist(t.x, t.y, BURJ_X, GROUND_Y - BURJ_H * 0.6) < range
        ).sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(beamCount, inRange.length); i++) {
          const t = inRange[i];
          g.laserBeams.push({
            x1: BURJ_X, y1: GROUND_Y - BURJ_H * 0.6,
            x2: t.x, y2: t.y, life: 20, maxLife: 20, targetRef: t,
          });
          if (t.type === "drone") {
            t.health -= 2;
            if (t.health <= 0) { t.alive = false; g.score += 150; createExplosion(g, t.x, t.y, 20, COL.laser); }
          } else { t.alive = false; g.score += 50; createExplosion(g, t.x, t.y, 15, COL.laser); }
        }
        if (inRange.length > 0) g.ironBeamTimer = 0;
      }
      g.laserBeams.forEach(b => b.life--);
      g.laserBeams = g.laserBeams.filter(b => b.life > 0);
    }

    // ── PHALANX CIWS ──
    if (g.upgrades.phalanx > 0) {
      const lvl = g.upgrades.phalanx;
      const turrets = [{ x: BURJ_X, y: GROUND_Y - 30 }];
      if (lvl >= 2) turrets.push({ x: AIRPORT_X + 40, y: AIRPORT_Y - 30 });
      if (lvl >= 3) turrets.push({ x: 200, y: GROUND_Y - 30 });
      const range = [80, 100, 120][lvl - 1];
      const fireRate = lvl >= 3 ? 3 : 5;
      g.phalanxTimer++;
      if (g.phalanxTimer >= fireRate) {
        g.phalanxTimer = 0;
        turrets.forEach(turret => {
          const close = allThreats.filter(t =>
            t.alive && dist(t.x, t.y, turret.x, turret.y) < range
          ).sort((a, b) => dist(a.x, a.y, turret.x, turret.y) - dist(b.x, b.y, turret.x, turret.y));
          if (close.length > 0) {
            const t = close[0];
            g.phalanxBullets.push({
              x: turret.x, y: turret.y,
              tx: t.x + rand(-5, 5), ty: t.y + rand(-5, 5),
              life: 8, hit: Math.random() < 0.35, targetRef: t,
            });
          }
        });
      }
      g.phalanxBullets.forEach(b => {
        b.life--;
        const progress = 1 - b.life / 8;
        b.cx = lerp(b.x, b.tx, progress);
        b.cy = lerp(b.y, b.ty, progress);
        if (b.life <= 0 && b.hit && b.targetRef.alive) {
          if (b.targetRef.type === "drone") {
            b.targetRef.health--;
            if (b.targetRef.health <= 0) { b.targetRef.alive = false; g.score += 150; createExplosion(g, b.targetRef.x, b.targetRef.y, 15, COL.phalanx); }
          } else { b.targetRef.alive = false; g.score += 50; createExplosion(g, b.targetRef.x, b.targetRef.y, 12, COL.phalanx); }
        }
      });
      g.phalanxBullets = g.phalanxBullets.filter(b => b.life > 0);
    }

    // ── PATRIOT BATTERY ──
    if (g.upgrades.patriot > 0) {
      const lvl = g.upgrades.patriot;
      const interval = [480, 360, 300][lvl - 1];
      const count = lvl >= 3 ? 2 : 1;
      const blastR = [50, 65, 80][lvl - 1];
      g.patriotTimer++;
      if (g.patriotTimer >= interval && allThreats.length > 0) {
        g.patriotTimer = 0;
        const sorted = [...allThreats].sort((a, b) => b.y - a.y);
        for (let i = 0; i < Math.min(count, sorted.length); i++) {
          g.patriotMissiles.push({
            x: 50, y: GROUND_Y - 20,
            targetRef: sorted[i], speed: 3.5,
            trail: [], alive: true, blastRadius: blastR,
            phase: "launch", launchY: rand(100, 250),
          });
        }
      }
      g.patriotMissiles.forEach(p => {
        if (!p.alive) return;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 25) p.trail.shift();
        if (p.phase === "launch") {
          p.y -= 3;
          if (p.y <= p.launchY) p.phase = "track";
        } else {
          const t = p.targetRef;
          if (!t || !t.alive) {
            const newT = allThreats.find(th => th.alive);
            if (newT) p.targetRef = newT; else { p.alive = false; return; }
          }
          const dx = p.targetRef.x - p.x;
          const dy = p.targetRef.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 20) { p.alive = false; createExplosion(g, p.x, p.y, p.blastRadius, COL.patriot); return; }
          p.x += (dx / d) * p.speed;
          p.y += (dy / d) * p.speed;
        }
      });
      g.patriotMissiles = g.patriotMissiles.filter(p => p.alive);
    }
  }

  function update(g) {
    g.time++;
    if (g.shakeTimer > 0) g.shakeTimer--;
    if (g.waveComplete) return;

    // Check wave complete
    if (g.waveMissiles >= g.waveTarget && g.missiles.length === 0 && g.drones.length === 0) {
      g.waveComplete = true;
      g.score += 500 * g.wave;
      setTimeout(() => {
        setShopData({ score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
        setShowShop(true);
      }, 600);
      return;
    }

    // Spawning
    if (g.waveMissiles < g.waveTarget) {
      g.spawnTimer++;
      if (g.spawnTimer >= g.spawnInterval) {
        g.spawnTimer = 0;
        const count = Math.min(1 + Math.floor(g.wave / 2), g.waveTarget - g.waveMissiles);
        for (let i = 0; i < Math.min(count, 3); i++) spawnMissile(g);
      }
    }
    g.droneTimer++;
    if (g.droneTimer >= g.droneInterval && g.waveMissiles < g.waveTarget) { g.droneTimer = 0; spawnDrone(g); }
    g.planeTimer++;
    if (g.planeTimer >= g.planeInterval && g.airportAlive) { g.planeTimer = 0; spawnPlane(g); }

    updateAutoSystems(g);

    // Update missiles
    g.missiles.forEach(m => {
      if (!m.alive) return;
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 30) m.trail.shift();
      m.x += m.vx; m.y += m.vy;
      // Burj collision — matches rendered tapered shape
      if (g.burjAlive && m.alive && m.y >= GROUND_Y - BURJ_H - 30 && m.y <= GROUND_Y && Math.abs(m.x - BURJ_X) < burjHalfW(m.y)) {
        m.alive = false;
        createExplosion(g, m.x, m.y, 30, "#ff4400");
        g.shakeTimer = 10; g.shakeIntensity = 4;
        g.burjHealth--;
        if (g.burjHealth <= 0) { g.burjAlive = false; createExplosion(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200"); }
      }
      // Building collisions
      if (m.alive) {
        g.buildings.forEach(b => {
          if (b.alive && m.alive && m.x >= b.x && m.x <= b.x + b.w && m.y >= GROUND_Y - b.h) {
            m.alive = false;
            createExplosion(g, m.x, m.y, 20, "#ff4400");
            b.damage++; if (b.damage >= 2) b.alive = false;
          }
        });
      }
      // Ground impact
      if (m.alive && m.y >= GROUND_Y) {
        m.alive = false;
        createExplosion(g, m.x, GROUND_Y, 25, "#ff4400");
        if (g.airportAlive && m.x >= AIRPORT_X - 10 && m.x <= AIRPORT_X + RUNWAY_W + 10) {
          g.airportHealth--;
          if (g.airportHealth <= 0) { g.airportAlive = false; createExplosion(g, AIRPORT_X + RUNWAY_W / 2, AIRPORT_Y, 50, "#ff4400"); }
        }
      }
      if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
    });

    // Update drones (Shaheds)
    g.drones.forEach(d => {
      if (!d.alive) return;
      d.wobble += 0.05;
      if (d.subtype === "shahed238") {
        // Jet Shahed — dives toward a target after crossing ~40% of screen
        if (!d.diving && ((d.vx > 0 && d.x > CANVAS_W * 0.3) || (d.vx < 0 && d.x < CANVAS_W * 0.7))) {
          if (Math.random() < 0.02) {
            d.diving = true;
            const targets = [];
            g.buildings.forEach(b => { if (b.alive) targets.push({ x: b.x + b.w / 2, y: CITY_Y }); });
            if (g.burjAlive) targets.push({ x: BURJ_X, y: CITY_Y });
            if (g.airportAlive) targets.push({ x: AIRPORT_X + RUNWAY_W / 2, y: AIRPORT_Y });
            if (targets.length > 0) {
              const t = targets[randInt(0, targets.length - 1)];
              d.diveTarget = t;
            }
          }
        }
        if (d.diving && d.diveTarget) {
          const dx = d.diveTarget.x - d.x;
          const dy = d.diveTarget.y - d.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const diveSpeed = Math.abs(d.vx) * 1.2;
          d.vx = (dx / len) * diveSpeed;
          d.vy = (dy / len) * diveSpeed;
          d.x += d.vx; d.y += d.vy;
        } else {
          d.x += d.vx; d.y += d.vy + Math.sin(d.wobble) * 0.15;
        }
      } else {
        // Prop Shahed-136 — cruises, drops 1 bomb, then dives to Burj
        if (!d.diving) {
          d.x += d.vx; d.y += d.vy + Math.sin(d.wobble) * 0.3;
          // Drop bomb and begin dive near mid-screen
          const nearMid = (d.vx > 0 && d.x > CANVAS_W * 0.35) || (d.vx < 0 && d.x < CANVAS_W * 0.65);
          if (!d.bombDropped && nearMid) {
            d.bombDropped = true;
            const targets = [];
            g.buildings.forEach(b => { if (b.alive) targets.push(b.x + b.w / 2); });
            if (g.burjAlive) targets.push(BURJ_X);
            if (targets.length > 0) {
              const tx = targets[randInt(0, targets.length - 1)];
              g.missiles.push({
                x: d.x, y: d.y, vx: (tx - d.x) * 0.002, vy: rand(1.2, 2.0),
                trail: [], alive: true, type: "bomb", ecmAffected: false,
              });
            }
            // Immediately begin kamikaze dive toward Burj
            d.diving = true;
            if (g.burjAlive) {
              d.diveTarget = { x: BURJ_X, y: CITY_Y - BURJ_H * 0.3 };
            } else {
              // Pick a random surviving building
              const alive = [];
              g.buildings.forEach(b => { if (b.alive) alive.push({ x: b.x + b.w / 2, y: CITY_Y }); });
              if (g.airportAlive) alive.push({ x: AIRPORT_X + RUNWAY_W / 2, y: AIRPORT_Y });
              d.diveTarget = alive.length > 0 ? alive[randInt(0, alive.length - 1)] : { x: BURJ_X, y: CITY_Y };
            }
          }
        } else {
          // Diving
          const dx = d.diveTarget.x - d.x;
          const dy = d.diveTarget.y - d.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const diveSpeed = Math.max(Math.abs(d.vx), 1.0) * 1.1;
          d.vx = (dx / len) * diveSpeed;
          d.vy = (dy / len) * diveSpeed;
          d.x += d.vx; d.y += d.vy;
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
          g.shakeTimer = 15; g.shakeIntensity = 6;
          g.buildings.forEach(b => {
            if (b.alive && Math.abs(d.x - (b.x + b.w / 2)) < b.w / 2 + 30) {
              b.damage++; if (b.damage >= 2) b.alive = false;
            }
          });
          if (g.burjAlive && Math.abs(d.x - BURJ_X) < 50) { g.burjHealth--; if (g.burjHealth <= 0) { g.burjAlive = false; createExplosion(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200"); } }
          if (g.airportAlive && Math.abs(d.x - (AIRPORT_X + RUNWAY_W / 2)) < RUNWAY_W / 2 + 20) { g.airportHealth--; if (g.airportHealth <= 0) { g.airportAlive = false; createExplosion(g, AIRPORT_X + RUNWAY_W / 2, AIRPORT_Y, 50, "#ff4400"); } }
        }
      }
    });

    // Update player interceptors
    g.interceptors.forEach(ic => {
      if (!ic.alive) return;
      ic.trail.push({ x: ic.x, y: ic.y });
      if (ic.trail.length > 15) ic.trail.shift();
      ic.x += ic.vx; ic.y += ic.vy;
      if (dist(ic.x, ic.y, ic.targetX, ic.targetY) < 16) {
        ic.alive = false;
        createExplosion(g, ic.x, ic.y, 49, COL.interceptor, true);
      }
    });

    // Explosion collisions
    g.explosions.forEach(ex => {
      if (ex.growing) { ex.radius += 2; if (ex.radius >= ex.maxRadius) ex.growing = false; }
      else ex.alpha -= 0.03;
      if (ex.alpha > 0.2) {
        g.missiles.forEach(m => {
          if (m.alive && dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
            m.alive = false; g.score += m.type === "bomb" ? 75 : 50;
            createExplosion(g, m.x, m.y, 30, "#ffcc00", ex.playerCaused);
          }
        });
        g.drones.forEach(d => {
          if (d.alive && dist(d.x, d.y, ex.x, ex.y) < ex.radius + 10) {
            d.health--;
            if (d.health <= 0) { d.alive = false; g.score += d.subtype === "shahed238" ? 250 : 150; createExplosion(g, d.x, d.y, 60, "#ff8800", ex.playerCaused); }
          }
        });
      }
    });

    // Planes — landing at DXB
    // Flight path: enter right at altitude → fly left → smooth U-turn → long glide to runway
    g.planes.forEach(p => {
      if (!p.alive || p.landed) return;
      p.blinkTimer++;
      // Progress along path using a parametric approach
      if (!p.t) p.t = 0;
      p.t += 0.0012;
      const t = Math.min(p.t, 1);
      // Bezier: enter right → cruise left past city → loop far left & descend → approach runway from left
      const p0x = CANVAS_W + 60, p0y = p.startY || 70;
      const p1x = 200,            p1y = 50;         // cruise left at altitude
      const p2x = -100,           p2y = AIRPORT_Y;  // far left, at runway height
      const p3x = AIRPORT_X + 20, p3y = AIRPORT_Y;  // runway
      // Cubic bezier
      const u = 1 - t;
      const newX = u*u*u*p0x + 3*u*u*t*p1x + 3*u*t*t*p2x + t*t*t*p3x;
      const newY = u*u*u*p0y + 3*u*u*t*p1y + 3*u*t*t*p2y + t*t*t*p3y;
      p.vx = newX - p.x;
      p.vy = newY - p.y;
      p.x = newX;
      p.y = newY;
      // Only vulnerable when on approach (below y=250)
      if (p.y > 250) {
        // Enemy missile/drone hits plane — no bonus, plane destroyed
        g.missiles.forEach(m => {
          if (m.alive && p.alive && dist(m.x, m.y, p.x, p.y) < 20) {
            p.alive = false; m.alive = false;
            createExplosion(g, p.x, p.y, 40, "#ff0000");
          }
        });
        // Player interceptor explosions hit plane — penalty
        g.explosions.forEach(ex => {
          if (ex.playerCaused && ex.alpha > 0.2 && p.alive && dist(p.x, p.y, ex.x, ex.y) < ex.radius + 15) {
            p.alive = false;
            g.score -= 500;
            createExplosion(g, p.x, p.y, 40, "#ff0000");
          }
        });
      }
      // Successful landing
      if (p.alive && dist(p.x, p.y, AIRPORT_X + RUNWAY_W / 2, AIRPORT_Y) < 30) {
        p.landed = true;
        g.score += 300;
        for (let i = 0; i < 6; i++) {
          g.particles.push({ x: p.x, y: p.y, vx: rand(-1, 1), vy: rand(-2, -0.5), life: 30, maxLife: 30, color: COL.gold, size: 2 });
        }
      }
      if (p.x < -80 || p.x > CANVAS_W + 80 || p.y > CANVAS_H + 50) p.alive = false;
    });

    g.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--; });

    // Cleanup
    g.missiles = g.missiles.filter(m => m.alive);
    g.drones = g.drones.filter(d => d.alive);
    g.interceptors = g.interceptors.filter(ic => ic.alive);
    g.explosions = g.explosions.filter(ex => ex.alpha > 0);
    g.particles = g.particles.filter(p => p.life > 0);
    g.planes = g.planes.filter(p => p.alive && p.x > -80 && p.x < CANVAS_W + 80);

    // Game over — Burj destroyed
    if (!g.burjAlive) {
      setFinalScore(g.score); setFinalWave(g.wave); setScreen("gameover");
    }
  }

  // ── DRAWING ──
  function drawGame(ctx, g) {
    let sx = 0, sy = 0;
    if (g.shakeTimer > 0) {
      sx = (Math.random() - 0.5) * g.shakeIntensity * 2;
      sy = (Math.random() - 0.5) * g.shakeIntensity * 2;
    }
    ctx.save(); ctx.translate(sx, sy);

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    skyGrad.addColorStop(0, COL.sky1); skyGrad.addColorStop(0.4, COL.sky2);
    skyGrad.addColorStop(0.7, COL.sky3); skyGrad.addColorStop(1, COL.ground);
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    g.stars.forEach(s => {
      ctx.globalAlpha = 0.4 + 0.6 * Math.sin(g.time * 0.02 + s.twinkle);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Moon
    ctx.fillStyle = "#ffe8b0";
    ctx.beginPath(); ctx.arc(780, 60, 25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.sky1;
    ctx.beginPath(); ctx.arc(788, 55, 22, 0, Math.PI * 2); ctx.fill();

    // ECM pulses
    g.ecmPulses.forEach(p => {
      ctx.globalAlpha = p.alpha * 0.15;
      ctx.strokeStyle = COL.ecm; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Ground
    ctx.fillStyle = COL.sand; ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 20);
    groundGrad.addColorStop(0, "#3a3060"); groundGrad.addColorStop(1, COL.sand);
    ctx.fillStyle = groundGrad; ctx.fillRect(0, GROUND_Y, CANVAS_W, 20);

    // Buildings
    g.buildings.forEach(b => {
      if (!b.alive) { ctx.fillStyle = "#333"; ctx.fillRect(b.x, CITY_Y - 8, b.w, 8); return; }
      const bTop = CITY_Y - b.h;
      const bGrad = ctx.createLinearGradient(b.x, bTop, b.x + b.w, CITY_Y);
      bGrad.addColorStop(0, "#1a2545"); bGrad.addColorStop(1, "#0d1525");
      ctx.fillStyle = bGrad; ctx.fillRect(b.x, bTop, b.w, b.h);
      ctx.strokeStyle = "rgba(80,120,200,0.15)"; ctx.lineWidth = 1; ctx.strokeRect(b.x, bTop, b.w, b.h);
      const winW = 4, winH = 5, gap = 8, cols = b.windows;
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
      if (b.damage > 0) { ctx.fillStyle = "rgba(255,50,0,0.3)"; ctx.fillRect(b.x, bTop, b.w, b.h); }
    });

    // Burj Khalifa
    if (g.burjAlive) {
      const bx = BURJ_X, by = CITY_Y, bh = BURJ_H;
      ctx.save();
      const burjGrad = ctx.createLinearGradient(bx - 11, by - bh, bx + 11, by);
      burjGrad.addColorStop(0, "#d0d8e8"); burjGrad.addColorStop(0.5, "#a0a8c0"); burjGrad.addColorStop(1, "#707888");
      ctx.fillStyle = burjGrad;
      ctx.beginPath();
      ctx.moveTo(bx, by - bh - 30);
      ctx.lineTo(bx - 3, by - bh); ctx.lineTo(bx - 7, by - bh * 0.7);
      ctx.lineTo(bx - 11, by - bh * 0.4); ctx.lineTo(bx - 13, by - bh * 0.15);
      ctx.lineTo(bx - 15, by); ctx.lineTo(bx + 15, by);
      ctx.lineTo(bx + 13, by - bh * 0.15); ctx.lineTo(bx + 11, by - bh * 0.4);
      ctx.lineTo(bx + 7, by - bh * 0.7); ctx.lineTo(bx + 3, by - bh);
      ctx.closePath(); ctx.fill();
      ctx.shadowColor = COL.burjGlow; ctx.shadowBlur = 20 + Math.sin(g.time * 0.03) * 8;
      ctx.strokeStyle = "rgba(68,136,255,0.4)"; ctx.lineWidth = 1; ctx.stroke(); ctx.shadowBlur = 0;
      for (let i = 0; i < 15; i++) {
        const ly = by - bh * 0.1 - (bh * 0.8) * (i / 15);
        const lw = 8 * (1 - i / 20);
        if (Math.sin(g.time * 0.05 + i * 0.5) > 0) {
          ctx.fillStyle = `rgba(68,136,255,${0.3 + Math.sin(g.time * 0.05 + i) * 0.2})`;
          ctx.fillRect(bx - lw, ly, lw * 2, 2);
        }
      }
      if (Math.sin(g.time * 0.1) > 0.5) {
        ctx.fillStyle = "#f00"; ctx.shadowColor = "#f00"; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.arc(bx, by - bh - 30, 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      if (g.upgrades.ironBeam > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(g.time * 0.08);
        ctx.fillStyle = `rgba(255,34,0,${pulse * 0.6})`;
        ctx.beginPath(); ctx.arc(bx, by - bh * 0.6, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      const hpW = 40, hpH = 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW, hpH);
      ctx.fillStyle = g.burjHealth > 2 ? "#44ff88" : g.burjHealth > 1 ? "#ffaa00" : "#ff3333";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW * (g.burjHealth / 5), hpH);
    } else {
      ctx.fillStyle = "#444";
      for (let i = 0; i < 8; i++) ctx.fillRect(BURJ_X - 15 + i * 4, CITY_Y - 10 - Math.random() * 20, 5, 10 + Math.random() * 15);
    }

    // Airport
    if (g.airportAlive) {
      ctx.fillStyle = "#334455"; ctx.fillRect(AIRPORT_X, AIRPORT_Y, RUNWAY_W, 6);
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 8; i++) ctx.fillRect(AIRPORT_X + 10 + i * 19, AIRPORT_Y + 2, 10, 2);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = (g.time * 0.1 + i * 0.5) % 2 < 1 ? "#44ff44" : "#226622";
        ctx.beginPath(); ctx.arc(AIRPORT_X + i * (RUNWAY_W / 9), AIRPORT_Y - 2, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#1a2540"; ctx.fillRect(AIRPORT_X + 20, AIRPORT_Y - 25, 80, 25);
      ctx.fillStyle = "#2a4070"; ctx.fillRect(AIRPORT_X + 22, AIRPORT_Y - 23, 76, 10);
      ctx.fillStyle = "#2a3555"; ctx.fillRect(AIRPORT_X + RUNWAY_W - 20, AIRPORT_Y - 40, 12, 40);
      ctx.fillStyle = "#4488aa"; ctx.fillRect(AIRPORT_X + RUNWAY_W - 24, AIRPORT_Y - 48, 20, 10);
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 8px monospace"; ctx.fillText("DXB", AIRPORT_X + 50, AIRPORT_Y - 6);
      const ahpW = 30;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(AIRPORT_X + RUNWAY_W / 2 - ahpW / 2, AIRPORT_Y - 55, ahpW, 4);
      ctx.fillStyle = g.airportHealth > 1 ? "#44ff88" : "#ff3333";
      ctx.fillRect(AIRPORT_X + RUNWAY_W / 2 - ahpW / 2, AIRPORT_Y - 55, ahpW * (g.airportHealth / 3), 4);
    } else {
      ctx.fillStyle = "#333"; ctx.fillRect(AIRPORT_X, AIRPORT_Y, RUNWAY_W, 6);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(255,${100 + Math.random() * 100},0,${0.3 + Math.random() * 0.3})`;
        ctx.beginPath(); ctx.arc(AIRPORT_X + 30 + i * 25, AIRPORT_Y - 10 - Math.random() * 15, 5 + Math.random() * 8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Planes
    g.planes.forEach(p => {
      if (!p.alive && !p.landed) return;
      if (p.landed) {
        // Parked on runway — small static plane
        ctx.save(); ctx.translate(p.x, AIRPORT_Y - 4);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#aabbcc";
        ctx.beginPath(); ctx.ellipse(0, 0, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        return;
      }
      ctx.save(); ctx.translate(p.x, p.y);
      // Rotate to match flight direction
      const angle = Math.atan2(p.vy, p.vx);
      ctx.rotate(angle);
      // Fuselage
      ctx.fillStyle = "#dde4ee";
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Nose
      ctx.fillStyle = "#bbccdd";
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(28, -1); ctx.lineTo(28, 1); ctx.closePath(); ctx.fill();
      // Wings
      ctx.fillStyle = "#ccd4e0";
      ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(-8, -14); ctx.lineTo(4, -2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2, 2); ctx.lineTo(-8, 14); ctx.lineTo(4, 2); ctx.closePath(); ctx.fill();
      // Tail
      ctx.fillStyle = "#aabbcc";
      ctx.beginPath(); ctx.moveTo(-18, -2); ctx.lineTo(-24, -10); ctx.lineTo(-14, -2); ctx.closePath(); ctx.fill();
      // Landing lights — brighter as plane gets closer to runway
      const landDist = dist(p.x, p.y, AIRPORT_X + RUNWAY_W / 2, AIRPORT_Y);
      const lightAlpha = Math.min(1, 300 / Math.max(landDist, 1));
      ctx.fillStyle = `rgba(255,255,200,${lightAlpha})`; ctx.shadowColor = "#ffffcc"; ctx.shadowBlur = 8 * lightAlpha;
      ctx.beginPath(); ctx.arc(26, 0, 2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      // Nav lights
      if (Math.sin(p.blinkTimer * 0.15) > 0) {
        ctx.fillStyle = "#f00"; ctx.shadowColor = "#f00"; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(-6, -12, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0f0"; ctx.shadowColor = "#0f0";
        ctx.beginPath(); ctx.arc(-6, 12, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.restore();
    });

    // Iron Beam lasers
    g.laserBeams.forEach(b => {
      const alpha = b.life / b.maxLife;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = COL.laser; ctx.shadowColor = COL.laser; ctx.shadowBlur = 15; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    // Phalanx bullets
    g.phalanxBullets.forEach(b => {
      if (b.cx === undefined) return;
      ctx.fillStyle = COL.phalanx; ctx.globalAlpha = 0.8;
      ctx.fillRect(b.cx - 1, b.cy - 1, 2, 2);
      ctx.strokeStyle = "rgba(255,136,68,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.cx, b.cy); ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Missiles
    g.missiles.forEach(m => {
      const angle = Math.atan2(m.vy, m.vx);

      if (m.type === "bomb") {
        // Bomb trail
        ctx.beginPath();
        m.trail.forEach((t, i) => {
          ctx.strokeStyle = `rgba(255,100,0,${i / m.trail.length * 0.6})`;
          ctx.lineWidth = 1.5;
          if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
        });
        if (m.trail.length > 1) ctx.stroke();
        ctx.fillStyle = "#ff8800"; ctx.shadowColor = "#ff6600"; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2); ctx.fill();
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
          ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
        });
        // Hot inner trail
        for (let i = Math.max(0, m.trail.length - 6); i < m.trail.length; i++) {
          const a = ((i - (m.trail.length - 6)) / 6) * 0.6;
          ctx.fillStyle = `rgba(255,200,80,${a})`;
          ctx.beginPath(); ctx.arc(m.trail[i].x, m.trail[i].y, 1.5, 0, Math.PI * 2); ctx.fill();
        }

        ctx.translate(m.x, m.y);
        ctx.rotate(angle);

        // Missile body
        ctx.fillStyle = "#889098";
        ctx.beginPath();
        ctx.moveTo(8, 0);         // nose tip
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
        ctx.beginPath(); ctx.moveTo(-6, -2.5); ctx.lineTo(-9, -6); ctx.lineTo(-4, -2.5); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-6, 2.5); ctx.lineTo(-9, 6); ctx.lineTo(-4, 2.5); ctx.closePath(); ctx.fill();

        // Rocket flame
        const flameLen = 4 + Math.random() * 6;
        ctx.fillStyle = "#ff6633"; ctx.shadowColor = "#ff4400"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-6 - flameLen, 0); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#ffcc66"; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(-6 - flameLen * 0.5, 0); ctx.lineTo(-6, 1); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
      }

      if (m.ecmAffected) {
        ctx.fillStyle = COL.ecm; ctx.globalAlpha = 0.6;
        ctx.fillRect(m.x - 4, m.y - 4, 8, 8); ctx.globalAlpha = 1;
      }
    });

    // Drones (Shaheds)
    g.drones.forEach(d => {
      ctx.save(); ctx.translate(d.x, d.y);
      const facing = d.vx > 0 ? 1 : -1;
      if (d.diving) {
        const angle = Math.atan2(d.vy, d.vx);
        ctx.rotate(angle);
      } else {
        ctx.scale(facing, 1);
      }

      if (d.subtype === "shahed238") {
        // Jet Shahed-238 — sleek delta wing, larger
        ctx.fillStyle = d.ecmSlowed ? "#3a3a55" : "#4a4a5a";
        // Fuselage
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -3); ctx.lineTo(-14, 0); ctx.lineTo(-10, 3); ctx.closePath(); ctx.fill();
        // Delta wings
        ctx.fillStyle = d.ecmSlowed ? "#2a2a40" : "#3a3a4a";
        ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(-8, -14); ctx.lineTo(-12, -2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(-8, 14); ctx.lineTo(-12, 2); ctx.closePath(); ctx.fill();
        // Jet exhaust
        const exLen = 6 + Math.random() * 8;
        ctx.fillStyle = "#ff6600"; ctx.shadowColor = "#ff4400"; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-14 - exLen, 0); ctx.lineTo(-14, 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#ffcc44"; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.moveTo(-14, -1); ctx.lineTo(-14 - exLen * 0.5, 0); ctx.lineTo(-14, 1); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        // Dive warning indicator
        if (d.diving) {
          ctx.strokeStyle = "#ff2200"; ctx.globalAlpha = 0.5 + Math.sin(g.time * 0.3) * 0.3;
          ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else {
        // Prop Shahed-136 — stubby delta with pusher prop
        ctx.fillStyle = d.ecmSlowed ? "#3a3a55" : "#555566";
        // Fuselage
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -2.5); ctx.lineTo(-10, 0); ctx.lineTo(-8, 2.5); ctx.closePath(); ctx.fill();
        // Short delta wings
        ctx.fillStyle = "#444455";
        ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(-6, -10); ctx.lineTo(-8, -2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(-6, 10); ctx.lineTo(-8, 2); ctx.closePath(); ctx.fill();
        // Pusher propeller (rear spinning prop)
        const pa = g.time * 0.8;
        ctx.strokeStyle = "#aaa"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-10 - Math.cos(pa) * 5, -Math.sin(pa) * 5);
        ctx.lineTo(-10 + Math.cos(pa) * 5, Math.sin(pa) * 5);
        ctx.stroke();
      }

      if (d.ecmSlowed) {
        ctx.strokeStyle = COL.ecm; ctx.globalAlpha = 0.4 + Math.sin(g.time * 0.2) * 0.2;
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      // Blinking nav light
      if (Math.sin(g.time * 0.15) > 0) {
        ctx.fillStyle = d.subtype === "shahed238" ? "#ff2200" : "#ff4400";
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.restore();
    });

    // Player interceptors
    g.interceptors.forEach(ic => {
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(68,255,170,${i / ic.trail.length * 0.8})`;
        ctx.lineWidth = 2;
        if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
      });
      if (ic.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.interceptor; ctx.shadowColor = COL.interceptor; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(ic.x, ic.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    });

    // Wild Hornets
    g.hornets.forEach(h => {
      ctx.beginPath();
      h.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(255,204,0,${i / h.trail.length * 0.6})`;
        ctx.lineWidth = 1.5;
        if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
      });
      if (h.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.hornet; ctx.shadowColor = COL.hornet; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,204,0,0.5)";
      ctx.fillRect(h.x - 5, h.y - 1, 3, 2);
      ctx.fillRect(h.x + 2, h.y - 1, 3, 2);
      ctx.shadowBlur = 0;
    });

    // Roadrunners
    g.roadrunners.forEach(r => {
      ctx.beginPath();
      r.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(68,170,255,${i / r.trail.length * 0.7})`;
        ctx.lineWidth = 2;
        if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
      });
      if (r.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.roadrunner; ctx.shadowColor = COL.roadrunner; ctx.shadowBlur = 10;
      ctx.save(); ctx.translate(r.x, r.y);
      ctx.fillRect(-4, -6, 8, 12);
      ctx.fillStyle = "#fff"; ctx.fillRect(-2, -8, 4, 3);
      ctx.restore(); ctx.shadowBlur = 0;
    });

    // Patriot missiles
    g.patriotMissiles.forEach(p => {
      ctx.beginPath();
      p.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(136,255,68,${i / p.trail.length * 0.7})`;
        ctx.lineWidth = 2.5;
        if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
      });
      if (p.trail.length > 1) ctx.stroke();
      ctx.fillStyle = COL.patriot; ctx.shadowColor = COL.patriot; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    });

    // Explosions
    g.explosions.forEach(ex => {
      ctx.globalAlpha = ex.alpha;
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, ex.radius);
      grad.addColorStop(0, "#fff"); grad.addColorStop(0.3, ex.color); grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Particles
    g.particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Launchers
    LAUNCHERS.forEach((l, i) => {
      ctx.fillStyle = "#2a3a50"; ctx.fillRect(l.x - 12, l.y - 8, 24, 12);
      ctx.fillStyle = "#3a4a60"; ctx.fillRect(l.x - 8, l.y - 12, 16, 8);
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(l.x - 15, l.y + 8, 30, 5);
      const ammoMax = 20 + g.wave * 2;
      const ammoRatio = g.ammo[i] / ammoMax;
      ctx.fillStyle = ammoRatio > 0.3 ? COL.hud : COL.warning;
      ctx.fillRect(l.x - 15, l.y + 8, 30 * ammoRatio, 5);
      const angle = Math.atan2(g.crosshairY - l.y, g.crosshairX - l.x);
      ctx.save(); ctx.translate(l.x, l.y - 8);
      ctx.rotate(Math.min(-0.2, Math.max(angle, -Math.PI + 0.2)));
      ctx.fillStyle = "#4a5a70"; ctx.fillRect(0, -2, 18, 4); ctx.restore();
    });

    // Phalanx turrets
    if (g.upgrades.phalanx > 0) {
      const turrets = [{ x: BURJ_X, y: GROUND_Y - 30 }];
      if (g.upgrades.phalanx >= 2) turrets.push({ x: AIRPORT_X + 40, y: AIRPORT_Y - 30 });
      if (g.upgrades.phalanx >= 3) turrets.push({ x: 200, y: GROUND_Y - 30 });
      turrets.forEach(t => {
        ctx.fillStyle = "#556677"; ctx.fillRect(t.x - 6, t.y, 12, 10);
        ctx.fillStyle = "#778899"; ctx.fillRect(t.x - 4, t.y - 6, 8, 8);
        ctx.save(); ctx.translate(t.x, t.y - 4);
        ctx.rotate(g.time * 0.3);
        ctx.fillStyle = "#99aabb"; ctx.fillRect(-1, -8, 2, 8);
        ctx.restore();
        ctx.fillStyle = "rgba(255,136,68,0.6)"; ctx.font = "7px monospace";
        ctx.fillText("CIWS", t.x - 10, t.y + 18);
      });
    }

    // Patriot launcher
    if (g.upgrades.patriot > 0) {
      ctx.fillStyle = "#3a4a30"; ctx.fillRect(30, GROUND_Y - 15, 40, 15);
      ctx.fillStyle = "#5a6a50"; ctx.fillRect(35, GROUND_Y - 25, 10, 12);
      ctx.fillRect(50, GROUND_Y - 22, 10, 10);
      ctx.fillStyle = "rgba(136,255,68,0.6)"; ctx.font = "7px monospace";
      ctx.fillText("PAC-3", 30, GROUND_Y + 10);
    }

    // ECM dish
    if (g.upgrades.ecm > 0) {
      ctx.fillStyle = "#3a3055"; ctx.fillRect(BURJ_X - 25, GROUND_Y - 18, 8, 18);
      ctx.fillStyle = COL.ecm;
      ctx.globalAlpha = 0.5 + Math.sin(g.time * 0.1) * 0.3;
      ctx.beginPath(); ctx.arc(BURJ_X - 21, GROUND_Y - 22, 8, -Math.PI * 0.8, Math.PI * 0.8); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = "7px monospace"; ctx.fillText("ECM", BURJ_X - 32, GROUND_Y + 10);
    }

    // Crosshair
    if (!showShop) {
      const cx = g.crosshairX, cy = g.crosshairY;
      ctx.strokeStyle = "rgba(0,255,200,0.7)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy);
      ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6);
      ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18);
      ctx.stroke();
    }

    ctx.restore();

    // HUD
    ctx.fillStyle = "rgba(0,10,20,0.7)"; ctx.fillRect(0, 0, CANVAS_W, 36);
    ctx.strokeStyle = "rgba(0,255,200,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(CANVAS_W, 36); ctx.stroke();
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.fillStyle = COL.gold; ctx.fillText(`$ ${g.score}`, 15, 23);
    ctx.fillStyle = COL.hud; ctx.fillText(`WAVE ${g.wave}`, 130, 23);
    ctx.fillStyle = g.burjAlive ? "#44ff88" : "#ff4444";
    ctx.fillText(`BURJ:${g.burjAlive ? "OK" : "XX"}`, 240, 23);
    ctx.fillStyle = g.airportAlive ? "#44ff88" : "#ff4444";
    ctx.fillText(`DXB:${g.airportAlive ? "OK" : "XX"}`, 360, 23);
    ctx.fillStyle = COL.hud; ctx.fillText(`AMMO ${g.ammo[0]}|${g.ammo[1]}|${g.ammo[2]}`, 470, 23);

    // Wave progress bar
    const wpX = 650, wpW = 120, wpH = 8, wpY = 14;
    const waveProgress = Math.min(g.waveMissiles / g.waveTarget, 1);
    const threatsLeft = g.missiles.filter(m => m.alive).length + g.drones.filter(d => d.alive).length;
    ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = waveProgress >= 1 ? "#44ff88" : COL.hud;
    ctx.fillRect(wpX, wpY, wpW * waveProgress, wpH);
    ctx.strokeStyle = "rgba(0,255,200,0.3)"; ctx.strokeRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = "#aabbcc"; ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(waveProgress >= 1 ? `CLEAR ${threatsLeft}` : `${g.waveMissiles}/${g.waveTarget}`, wpX + wpW + 6, wpY + 7);
    ctx.font = "bold 12px 'Courier New', monospace";

    // Active upgrades in HUD
    const activeUpgrades = Object.entries(g.upgrades).filter(([, v]) => v > 0);
    if (activeUpgrades.length > 0) {
      let ux = 640;
      activeUpgrades.forEach(([key, lvl]) => {
        const def = UPGRADES[key];
        ctx.fillStyle = def.color; ctx.globalAlpha = 0.9;
        ctx.font = "11px monospace"; ctx.fillText(`${def.icon}${lvl}`, ux, 23);
        ux += 38;
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawTitle(ctx) {
    const t = performance.now() / 1000;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    skyGrad.addColorStop(0, "#050810"); skyGrad.addColorStop(0.5, "#0a1030"); skyGrad.addColorStop(1, "#151030");
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(0,255,200,0.02)";
    for (let y = 0; y < CANVAS_H; y += 3) ctx.fillRect(0, y + (t * 20) % 3, CANVAS_W, 1);
    ctx.textAlign = "center";
    ctx.fillStyle = COL.hud; ctx.shadowColor = COL.hud; ctx.shadowBlur = 20;
    ctx.font = "bold 48px 'Courier New', monospace"; ctx.fillText("DUBAI", CANVAS_W / 2, 160);
    ctx.font = "bold 36px 'Courier New', monospace"; ctx.fillText("MISSILE COMMAND", CANVAS_W / 2, 210);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ff6644"; ctx.font = "14px 'Courier New', monospace";
    ctx.fillText("DEFEND THE CITY  ★  PROTECT THE SKIES", CANVAS_W / 2, 250);
    // Burj silhouette
    ctx.fillStyle = "rgba(0,255,200,0.08)";
    ctx.beginPath(); ctx.moveTo(CANVAS_W / 2, 280); ctx.lineTo(CANVAS_W / 2 - 3, 320);
    ctx.lineTo(CANVAS_W / 2 - 8, 380); ctx.lineTo(CANVAS_W / 2 - 12, 480);
    ctx.lineTo(CANVAS_W / 2 + 12, 480); ctx.lineTo(CANVAS_W / 2 + 8, 380);
    ctx.lineTo(CANVAS_W / 2 + 3, 320); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#8899aa"; ctx.font = "13px 'Courier New', monospace";
    ctx.fillText("CLICK TO LAUNCH INTERCEPTORS", CANVAS_W / 2, 360);
    ctx.fillText("DESTROY MISSILES & DRONES", CANVAS_W / 2, 380);
    ctx.fillText("EARN SCORE TO BUY AUTOMATED DEFENSES", CANVAS_W / 2, 400);
    ctx.fillText("PROTECT BURJ KHALIFA & DXB AIRPORT", CANVAS_W / 2, 420);
    // Upgrade preview
    ctx.fillStyle = "#556677"; ctx.font = "11px 'Courier New', monospace";
    ctx.fillText("🐝 Wild Hornets  🦅 Roadrunner  📡 ECM  ⚡ Iron Beam  🔫 Phalanx  🚀 Patriot", CANVAS_W / 2, 460);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText("[ CLICK TO START ]", CANVAS_W / 2, 520);
    ctx.textAlign = "left";
  }

  function drawGameOver(ctx) {
    const t = performance.now() / 1000;
    ctx.fillStyle = "#080008"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(255,0,0,${Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * CANVAS_W, Math.random() * CANVAS_H, 2, 2);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = COL.warning; ctx.shadowColor = "#ff0000"; ctx.shadowBlur = 30;
    ctx.font = "bold 44px 'Courier New', monospace"; ctx.fillText("CITY FALLEN", CANVAS_W / 2, 200);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#aaa"; ctx.font = "18px 'Courier New', monospace";
    ctx.fillText(`FINAL SCORE: ${finalScore}`, CANVAS_W / 2, 280);
    ctx.fillText(`WAVES SURVIVED: ${finalWave}`, CANVAS_W / 2, 310);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.font = "bold 16px 'Courier New', monospace";
    ctx.fillText("[ CLICK TO RETRY ]", CANVAS_W / 2, 420);
    ctx.textAlign = "left";
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    function loop() {
      if (screen === "playing" && gameRef.current) {
        update(gameRef.current);
        drawGame(ctx, gameRef.current);
      } else if (screen === "title") { drawTitle(ctx); }
      else if (screen === "gameover") { drawGameOver(ctx); }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen, finalScore, finalWave, showShop]);

  function handleCanvasClick(e) {
    if (showShop) return;
    if (screen === "title") { initGame(); setScreen("playing"); }
    else if (screen === "gameover") { initGame(); setScreen("playing"); }
    else {
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
    const g = gameRef.current; if (!g) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    g.crosshairX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    g.crosshairY = (e.clientY - rect.top) * (CANVAS_H / rect.height);
  }

  function buyUpgrade(key) {
    const g = gameRef.current; if (!g) return;
    const def = UPGRADES[key];
    const lvl = g.upgrades[key];
    if (lvl >= def.maxLevel) return;
    const cost = def.costs[lvl];
    if (g.score < cost) return;
    g.score -= cost;
    g.upgrades[key]++;
    setShopData({ score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
    forceUpdate(n => n + 1);
  }

  function closeShop() {
    const g = gameRef.current; if (!g) return;
    g.wave++;
    g.waveMissiles = 0;
    g.waveTarget = 10 + g.wave * 5;
    g.spawnInterval = Math.max(20, 110 - g.wave * 10);
    g.droneInterval = Math.max(60, 250 - g.wave * 25);
    g.ammo = g.ammo.map(() => 20 + g.wave * 2);
    g.waveComplete = false;
    setShowShop(false); setShopData(null);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#050810",
      fontFamily: "'Courier New', monospace", padding: "10px",
    }}>
      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onClick={handleCanvasClick} onMouseMove={handleMouseMove}
          style={{
            cursor: screen === "playing" && !showShop ? "none" : "pointer",
            border: "1px solid rgba(0,255,200,0.2)", borderRadius: "4px",
            maxWidth: "100%", boxShadow: "0 0 40px rgba(0,100,200,0.15)",
            filter: showShop ? "brightness(0.3) blur(2px)" : "none",
            transition: "filter 0.3s",
          }}
        />

        {/* UPGRADE SHOP */}
        {showShop && shopData && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", zIndex: 10,
          }}>
            <div style={{
              background: "rgba(8,14,30,0.97)", border: "1px solid rgba(0,255,200,0.3)",
              borderRadius: "8px", padding: "18px 22px", maxWidth: "860px", width: "96%",
              boxShadow: "0 0 60px rgba(0,100,200,0.2), inset 0 0 30px rgba(0,20,40,0.5)",
            }}>
              <div style={{ textAlign: "center", marginBottom: "14px" }}>
                <div style={{ color: COL.hud, fontSize: "18px", fontWeight: "bold", letterSpacing: "3px" }}>
                  ⬡ DEFENSE SYSTEMS MARKET ⬡
                </div>
                <div style={{ color: "#667788", fontSize: "11px", marginTop: "3px" }}>
                  WAVE {shopData.wave} COMPLETE — UPGRADE YOUR DEFENSES
                </div>
                <div style={{
                  color: COL.gold, fontSize: "16px", fontWeight: "bold", marginTop: "6px",
                  textShadow: "0 0 10px rgba(255,215,0,0.5)",
                }}>
                  BUDGET: $ {shopData.score}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "14px" }}>
                {Object.entries(UPGRADES).map(([key, def]) => {
                  const lvl = shopData.upgrades[key];
                  const maxed = lvl >= def.maxLevel;
                  const cost = maxed ? null : def.costs[lvl];
                  const canAfford = cost !== null && shopData.score >= cost;

                  return (
                    <div key={key} style={{
                      background: COL.panelBg,
                      border: `1px solid ${maxed ? "rgba(0,255,200,0.3)" : canAfford ? def.color + "66" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: "6px", padding: "11px",
                      opacity: maxed ? 0.7 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                        <span style={{ fontSize: "20px" }}>{def.icon}</span>
                        <div>
                          <div style={{ color: def.color, fontSize: "11px", fontWeight: "bold", letterSpacing: "1px" }}>
                            {def.name.toUpperCase()}
                          </div>
                          <div style={{ display: "flex", gap: "3px", marginTop: "2px" }}>
                            {Array.from({ length: def.maxLevel }, (_, i) => (
                              <div key={i} style={{
                                width: "7px", height: "7px", borderRadius: "50%",
                                background: i < lvl ? def.color : "rgba(255,255,255,0.1)",
                                border: `1px solid ${i < lvl ? def.color : "rgba(255,255,255,0.15)"}`,
                                boxShadow: i < lvl ? `0 0 4px ${def.color}` : "none",
                              }} />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div style={{ color: "#778899", fontSize: "9.5px", lineHeight: "1.4", marginBottom: "7px", minHeight: "26px" }}>
                        {def.desc}
                      </div>
                      {!maxed && (
                        <div style={{
                          color: def.color, fontSize: "9px", opacity: 0.8,
                          marginBottom: "7px", padding: "3px 5px",
                          background: "rgba(0,0,0,0.3)", borderRadius: "3px",
                        }}>
                          LVL {lvl + 1}: {def.statLines[lvl]}
                        </div>
                      )}
                      <button onClick={() => buyUpgrade(key)} disabled={maxed || !canAfford}
                        style={{
                          width: "100%", padding: "5px 0",
                          background: maxed ? "rgba(0,255,200,0.1)" : canAfford ? `${def.color}22` : "rgba(255,255,255,0.03)",
                          border: `1px solid ${maxed ? "rgba(0,255,200,0.3)" : canAfford ? def.color : "rgba(255,255,255,0.1)"}`,
                          borderRadius: "4px",
                          color: maxed ? COL.hud : canAfford ? def.color : "#444",
                          fontSize: "10px", fontWeight: "bold", fontFamily: "'Courier New', monospace",
                          cursor: maxed || !canAfford ? "default" : "pointer", letterSpacing: "1px",
                        }}
                        onMouseEnter={e => { if (!maxed && canAfford) { e.target.style.background = `${def.color}44`; e.target.style.boxShadow = `0 0 12px ${def.color}33`; } }}
                        onMouseLeave={e => { e.target.style.background = maxed ? "rgba(0,255,200,0.1)" : canAfford ? `${def.color}22` : "rgba(255,255,255,0.03)"; e.target.style.boxShadow = "none"; }}
                      >
                        {maxed ? "✓ MAXED" : canAfford ? `UPGRADE — $${cost}` : `$${cost} NEEDED`}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div style={{ textAlign: "center" }}>
                <button onClick={closeShop}
                  style={{
                    padding: "9px 36px", background: "rgba(0,255,200,0.12)",
                    border: "1px solid rgba(0,255,200,0.5)", borderRadius: "4px",
                    color: COL.hud, fontSize: "13px", fontWeight: "bold",
                    fontFamily: "'Courier New', monospace", cursor: "pointer", letterSpacing: "3px",
                  }}
                  onMouseEnter={e => { e.target.style.background = "rgba(0,255,200,0.25)"; e.target.style.boxShadow = "0 0 20px rgba(0,255,200,0.2)"; }}
                  onMouseLeave={e => { e.target.style.background = "rgba(0,255,200,0.12)"; e.target.style.boxShadow = "none"; }}
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
