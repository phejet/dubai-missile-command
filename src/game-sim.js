import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  COL,
  BURJ_X,
  BURJ_H,
  MAX_PARTICLES,
  LAUNCHERS,
  burjHalfW,
  dist,
  rand,
  randInt,
  pickTarget,
  createExplosion,
  destroyDefenseSite,
  getPhalanxTurrets,
  damageTarget,
  getRng,
} from "./game-logic.js";

// ── UPGRADE DEFINITIONS ──
export const UPGRADES = {
  wildHornets: {
    name: "Wild Hornets",
    icon: "\uD83D\uDC1D",
    desc: "Ukrainian FPV drone swarm. Autonomous kamikaze drones hunt incoming threats.",
    maxLevel: 3,
    costs: [650, 2000, 4950],
    color: COL.hornet,
    statLines: ["1 drone / 4s \u00B7 25 blast", "2 drones / 3s \u00B7 30 blast", "3 drones / 2s \u00B7 40 blast"],
  },
  roadrunner: {
    name: "Anduril Roadrunner",
    icon: "\uD83E\uDD85",
    desc: "AI-guided reusable interceptor. Launches vertically, locks nearest threat.",
    maxLevel: 3,
    costs: [800, 2500, 6000],
    color: COL.roadrunner,
    statLines: [
      "1 interceptor / 5s \u00B7 fast",
      "2 interceptors / 4s \u00B7 faster",
      "3 interceptors / 3s \u00B7 max speed",
    ],
  },
  flare: {
    name: "Decoy Flares",
    icon: "\uD83C\uDF86",
    desc: "Burj launches IR decoys. Incoming missiles retarget to flares and miss.",
    maxLevel: 3,
    costs: [700, 2200, 5500],
    color: COL.flare,
    statLines: [
      "1 flare / 5s \u00B7 lures 1 missile",
      "2 flares / 4s \u00B7 lures 2 each",
      "3 flares / 3s \u00B7 lures 3 each",
    ],
  },
  ironBeam: {
    name: "Iron Beam",
    icon: "\u26A1",
    desc: "High-energy laser defense. Instant beam locks on and burns down incoming projectiles.",
    maxLevel: 3,
    costs: [950, 3000, 7050],
    color: COL.laser,
    statLines: [
      "1 beam \u00B7 60 range \u00B7 slow charge",
      "2 beams \u00B7 80 range \u00B7 medium",
      "3 beams \u00B7 100 range \u00B7 fast",
    ],
  },
  phalanx: {
    name: "Phalanx CIWS",
    icon: "\uD83D\uDD2B",
    desc: "Close-in weapon system. Last-resort rapid-fire autocannon near protected sites.",
    maxLevel: 3,
    costs: [850, 2800, 6500],
    color: COL.phalanx,
    statLines: [
      "1 turret at Burj \u00B7 100 range \u00B7 50% acc",
      "+ east turret \u00B7 130 range \u00B7 60% acc",
      "3 turrets \u00B7 160 range \u00B7 70% acc \u00B7 faster",
    ],
  },
  patriot: {
    name: "Patriot Battery",
    icon: "\uD83D\uDE80",
    desc: "Long-range SAM battery. Massive blast radius, targets highest threats first.",
    maxLevel: 3,
    costs: [1500, 3450, 7900],
    color: COL.patriot,
    statLines: ["1 launch / 8s \u00B7 50 blast", "1 launch / 6s \u00B7 65 blast", "2 launches / 5s \u00B7 80 blast"],
  },
  burjRepair: {
    name: "Burj Repair Kit",
    icon: "\uD83D\uDD27",
    desc: "Emergency structural repair. Restores 1 HP to Burj Khalifa.",
    maxLevel: 3,
    costs: [1500, 2500, 4000],
    color: "#00ffcc",
    statLines: ["+1 Burj HP (1/3)", "+1 Burj HP (2/3)", "+1 Burj HP (3/3)"],
    consumable: true,
  },
  launcherKit: {
    name: "Launcher Upgrade",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Progressive launcher enhancement. Magazine, armor, then double magazine.",
    maxLevel: 3,
    costs: [800, 1800, 3000],
    color: COL.launcherKit,
    statLines: [
      "Extended Mag: +50% ammo per wave",
      "Reinforced: launchers gain +1 HP",
      "Deep Magazine: +100% ammo per wave",
    ],
  },
  emp: {
    name: "EMP Shockwave",
    icon: "\uD83C\uDF00",
    desc: "Tesla coil EMP cannon. Charge up, then press SPACE to unleash a shockwave from Burj.",
    maxLevel: 3,
    costs: [1200, 3200, 7500],
    color: COL.emp,
    statLines: [
      "250 range \u00B7 20s charge \u00B7 1 dmg",
      "400 range \u00B7 15s charge \u00B7 2 dmg",
      "FULL MAP \u00B7 12s charge \u00B7 3 dmg + slow",
    ],
    active: true,
  },
};

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

function boom(g, x, y, radius, color, playerCaused, onEvent) {
  createExplosion(g, x, y, radius, color, playerCaused);
  if (onEvent) onEvent("sfx", { name: "explosion", size: radius > 45 ? "large" : radius > 25 ? "medium" : "small" });
}

export function initGame() {
  const allBuildings = [...BUILDINGS_LEFT, ...BUILDINGS_RIGHT].map(([x, w, h, win]) => ({
    x,
    w,
    h,
    windows: win,
    alive: true,
  }));

  return {
    state: "playing",
    score: 0,
    wave: 1,
    stats: { missileKills: 0, droneKills: 0, shotsFired: 0 },
    ammo: [11, 11, 11],
    launcherHP: [1, 1, 1],
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
    waveTarget: 12,
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
      burjRepair: 0,
      launcherKit: 0,
      emp: 0,
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
    empCharge: 0,
    empChargeMax: 0,
    empReady: false,
    empRings: [],
    multiKillToast: null,
  };
}

export function spawnPlane(g, onEvent) {
  const _rng = getRng();
  const goRight = _rng() > 0.5;
  g.planes.push({
    x: goRight ? -60 : CANVAS_W + 60,
    y: rand(120, 280),
    vx: goRight ? rand(2.8, 4.0) : rand(-4.0, -2.8),
    vy: 0,
    blinkTimer: 0,
    alive: true,
    fireTimer: 0,
    fireInterval: 25,
    evadeTimer: 0,
  });
  if (onEvent) onEvent("sfx", { name: "planePass" });
}

export function spawnMissile(g) {
  const _rng = getRng();
  const speed = rand(0.5, 1.0) + g.wave * 0.08;
  let startX, startY;
  if (g.wave >= 2 && _rng() < Math.min(0.4, (g.wave - 1) * 0.1)) {
    const fromLeft = _rng() > 0.5;
    startX = fromLeft ? -10 : CANVAS_W + 10;
    startY = rand(20, 200);
  } else {
    startX = rand(50, CANVAS_W - 50);
    startY = -10;
  }
  const target = pickTarget(g, startX);
  if (!target) return;
  if (Math.abs(startX - target.x) < 200 && startY < 0) {
    startX = target.x + (_rng() > 0.5 ? 1 : -1) * rand(300, 500);
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

export function spawnDrone(g) {
  const _rng = getRng();
  const goingRight = _rng() > 0.5;
  const jetChance = Math.max(0, (g.wave - 3) * 0.15);
  const isJet = g.wave >= 4 && _rng() < jetChance;
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

function isSiteAlive(g, key) {
  const site = g.defenseSites.find((s) => s.key === key);
  return !site || site.alive; // no site yet (pre-purchase) = active
}

export function updateAutoSystems(g, dt, allThreats, onEvent) {
  const _rng = getRng();
  // ── WILD HORNETS ──
  if (g.upgrades.wildHornets > 0 && isSiteAlive(g, "wildHornets")) {
    const lvl = g.upgrades.wildHornets;
    const interval = [240, 180, 120][lvl - 1];
    const count = lvl;
    const blastR = [25, 30, 40][lvl - 1];
    g.hornetTimer += dt;
    if (g.hornetTimer >= interval && allThreats.length > 0) {
      g.hornetTimer = 0;
      if (onEvent) onEvent("sfx", { name: "hornetBuzz" });
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
        boom(g, h.x, h.y, h.blastRadius, COL.hornet, false, onEvent);
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
  if (g.upgrades.roadrunner > 0 && isSiteAlive(g, "roadrunner")) {
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
          boom(g, r.x, r.y, 30, COL.roadrunner, false, onEvent);
          return;
        }
        r.x += (dx / d) * r.speed * dt;
        r.y += (dy / d) * r.speed * dt;
      }
    });
    g.roadrunners = g.roadrunners.filter((r) => r.alive);
  }

  // ── DECOY FLARES ──
  if (g.upgrades.flare > 0 && isSiteAlive(g, "flare")) {
    const lvl = g.upgrades.flare;
    const interval = [300, 240, 180][lvl - 1];
    const count = lvl;
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
          luresLeft: lvl,
        });
      }
    }
    g.flares.forEach((f) => {
      if (!f.alive) return;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 0.015 * dt;
      f.vx *= 0.99 ** dt;
      f.life -= dt;
      if (f.life <= 0) f.alive = false;
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
    g.missiles.forEach((m) => {
      if (!m.alive || m.luredByFlare) return;
      const nearFlare = g.flares.find(
        (f) => f.alive && f.life > 30 && f.luresLeft > 0 && dist(m.x, m.y, f.x, f.y) < 200,
      );
      if (nearFlare) {
        nearFlare.luresLeft--;
        m.luredByFlare = true;
        const dx = nearFlare.x - m.x,
          dy = nearFlare.y - m.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
        m.vx = (dx / len) * spd;
        m.vy = (dy / len) * spd;
        m.accel = 1;
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
  if (g.upgrades.ironBeam > 0 && isSiteAlive(g, "ironBeam")) {
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
      if (inRange.length > 0) {
        g.ironBeamTimer = 0;
        if (!g._laserHandle) {
          if (onEvent) onEvent("sfx", { name: "laserBeam" });
          g._laserHandle = { stop() {} };
        }
      }
    }
    g.laserBeams.forEach((b) => (b.life -= dt));
    g.laserBeams = g.laserBeams.filter((b) => b.life > 0);
    if (g.laserBeams.length === 0 && g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
  }

  // ── PHALANX CIWS ──
  if (g.upgrades.phalanx > 0 && isSiteAlive(g, "phalanx")) {
    const lvl = g.upgrades.phalanx;
    const turrets = getPhalanxTurrets(lvl);
    const range = [100, 130, 160][lvl - 1];
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
            hit: _rng() < [0.5, 0.6, 0.7][lvl - 1],
            targetRef: t,
          });
        }
      });
    }
    g.phalanxBullets.forEach((b) => {
      b.life -= dt;
      const progress = 1 - b.life / 8;
      b.cx = b.x + (b.tx - b.x) * progress;
      b.cy = b.y + (b.ty - b.y) * progress;
      if (b.life <= 0 && b.hit && b.targetRef.alive) {
        damageTarget(g, b.targetRef, 1, COL.phalanx, b.targetRef.type === "drone" ? 15 : 12);
      }
    });
    g.phalanxBullets = g.phalanxBullets.filter((b) => b.life > 0);
  }

  // ── PATRIOT BATTERY ──
  if (g.upgrades.patriot > 0 && isSiteAlive(g, "patriot")) {
    const lvl = g.upgrades.patriot;
    const interval = [480, 360, 300][lvl - 1];
    const count = lvl >= 3 ? 2 : 1;
    const blastR = [50, 65, 80][lvl - 1];
    g.patriotTimer += dt;
    if (g.patriotTimer >= interval && allThreats.length > 0) {
      g.patriotTimer = 0;
      if (onEvent) onEvent("sfx", { name: "patriotLaunch" });
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
          boom(g, p.x, p.y, p.blastRadius, COL.patriot, false, onEvent);
          return;
        }
        p.x += (dx / d) * p.speed * dt;
        p.y += (dy / d) * p.speed * dt;
      }
    });
    g.patriotMissiles = g.patriotMissiles.filter((p) => p.alive);
  }

  // ── EMP SHOCKWAVE ── (charging is handled in update() before waveComplete check)
  if (g.empRings.length > 0) {
    // Update active rings
    g.empRings.forEach((ring) => {
      ring.radius += 5 * dt;
      if (ring.radius > ring.maxRadius) {
        ring.alive = false;
        return;
      }
      ring.alpha = 1 - ring.radius / ring.maxRadius;
      // Damage threats in the ring band
      const bandInner = ring.radius - 15;
      const bandOuter = ring.radius + 15;
      allThreats.forEach((t) => {
        if (!t.alive || ring.hitSet.has(t)) return;
        const d = dist(t.x, t.y, ring.x, ring.y);
        if (d >= bandInner && d <= bandOuter) {
          ring.hitSet.add(t);
          if (t.type === "drone") {
            t.health -= ring.damage;
            if (t.health <= 0) {
              t.alive = false;
              g.score += t.subtype === "shahed238" ? 250 : 150;
              g.stats.droneKills++;
            }
          } else {
            t.alive = false;
            g.score += t.type === "bomb" ? 75 : 50;
            g.stats.missileKills++;
          }
          // Violet spark particles — big burst
          const sparkCount = Math.min(15, MAX_PARTICLES - g.particles.length);
          for (let i = 0; i < sparkCount; i++) {
            const angle = rand(0, Math.PI * 2);
            const sp = rand(2, 7);
            g.particles.push({
              x: t.x,
              y: t.y,
              vx: Math.cos(angle) * sp,
              vy: Math.sin(angle) * sp,
              life: rand(20, 50),
              maxLife: 50,
              color: _rng() > 0.4 ? "#cc44ff" : _rng() > 0.5 ? "#aa66ff" : "#ffffff",
              size: rand(1.5, 4),
            });
          }
          // L3 slow effect on survivors
          if (ring.applySlow && t.alive) {
            t.empSlowTimer = 120;
          }
        }
      });
    });
    g.empRings = g.empRings.filter((r) => r.alive);
  }
}

export function update(g, dt, onEvent) {
  const _rng = getRng();
  g.time += dt;
  if (g.shakeTimer > 0) g.shakeTimer -= dt;
  if (g.waveClearedTimer > 0) g.waveClearedTimer -= dt;
  if (g.multiKillToast && g.multiKillToast.timer > 0) {
    g.multiKillToast.timer -= dt;
    if (g.multiKillToast.timer <= 0) g.multiKillToast = null;
  }

  // Game over — Burj destroyed
  if (!g.burjAlive && !g.gameOverTimer) {
    g.gameOverTimer = 60;
    if (g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
    if (onEvent) onEvent("sfx", { name: "gameOver" });
  }
  if (g.gameOverTimer > 0) {
    g.gameOverTimer -= dt;
    if (g.gameOverTimer <= 0) {
      g.state = "gameover";
      if (onEvent) onEvent("gameOver", { score: g.score, wave: g.wave, stats: { ...g.stats } });
    }
    return;
  }

  // EMP charges even between waves
  if (g.upgrades.emp > 0 && !g.empReady) {
    g.empCharge = Math.min(g.empCharge + dt, g.empChargeMax);
    if (g.empCharge >= g.empChargeMax) g.empReady = true;
  }

  if (g.waveComplete) {
    if (g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
    if (g.waveClearedTimer <= 0 && !g.shopOpened) {
      g.shopOpened = true;
      if (g.burjAlive) {
        g.state = "shop";
        if (onEvent) onEvent("shopOpen", { score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
      }
    }
    return;
  }

  // Check wave complete
  if (g.burjAlive && g.waveMissiles >= g.waveTarget && g.missiles.length === 0 && g.drones.length === 0) {
    g.waveComplete = true;
    g.shopOpened = false;
    g.waveClearedTimer = 120;
    g.score += 250 * g.wave;
    if (onEvent) {
      onEvent("sfx", { name: "waveCleared" });
      onEvent("waveComplete", { score: g.score, wave: g.wave });
    }
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
  // F-15 incoming warning ~2 seconds before arrival
  if (!g.planeWarned && g.planeTimer >= g.planeInterval - 120) {
    g.planeWarned = true;
    if (onEvent) onEvent("sfx", { name: "planeIncoming" });
  }
  if (g.planeTimer >= g.planeInterval) {
    g.planeTimer = 0;
    g.planeWarned = false;
    spawnPlane(g, onEvent);
  }

  const allThreats = [...g.missiles.filter((m) => m.alive), ...g.drones.filter((d) => d.alive)];
  updateAutoSystems(g, dt, allThreats, onEvent);

  // Update missiles
  g.missiles.forEach((m) => {
    if (!m.alive) return;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 30) m.trail.shift();
    if (m.accel) {
      m.vx *= m.accel ** dt;
      m.vy *= m.accel ** dt;
    }
    const mSlow = m.empSlowTimer > 0 ? ((m.empSlowTimer -= dt), 0.4) : 1;
    m.x += m.vx * dt * mSlow;
    m.y += m.vy * dt * mSlow;
    // Burj collision
    if (
      g.burjAlive &&
      m.alive &&
      m.y >= GROUND_Y - BURJ_H - 30 &&
      m.y <= GROUND_Y &&
      Math.abs(m.x - BURJ_X) < burjHalfW(m.y)
    ) {
      m.alive = false;
      boom(g, m.x, m.y, 30, "#ff4400", false, onEvent);
      g.shakeTimer = 10;
      g.shakeIntensity = 4;
      g.burjHealth--;
      if (onEvent) onEvent("sfx", { name: "burjHit" });
      if (g.burjHealth <= 0) {
        g.burjAlive = false;
        boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200", false, onEvent);
      }
    }
    // Building collisions
    if (m.alive) {
      g.buildings.forEach((b) => {
        if (b.alive && m.alive && m.x >= b.x && m.x <= b.x + b.w && m.y >= GROUND_Y - b.h) {
          m.alive = false;
          boom(g, m.x, m.y, 20, "#ff4400", false, onEvent);
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
          boom(g, m.x, m.y, 35, "#ff4400", false, onEvent);
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
          boom(g, m.x, m.y, 25, "#ff4400", false, onEvent);
          g.shakeTimer = 10;
          g.shakeIntensity = 4;
          if (g.launcherHP[i] <= 0) {
            g.ammo[i] = 0;
            if (onEvent) onEvent("sfx", { name: "launcherDestroyed" });
          }
        }
      });
    }
    // Ground impact
    if (m.alive && m.y >= GROUND_Y) {
      m.alive = false;
      boom(g, m.x, GROUND_Y, 25, "#ff4400", false, onEvent);
    }
    if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
  });

  // Update drones (Shaheds)
  g.drones.forEach((d) => {
    if (!d.alive) return;
    if (d.empSlowTimer > 0) d.empSlowTimer -= dt;
    const dSlow = d.empSlowTimer > 0 ? 0.4 : 1;
    d.wobble += 0.05 * dt;
    if (d.subtype === "shahed238") {
      if (!d.diving && ((d.vx > 0 && d.x > CANVAS_W * 0.3) || (d.vx < 0 && d.x < CANVAS_W * 0.7))) {
        if (_rng() < 0.02 * dt) {
          d.diving = true;
          const t = pickTarget(g, d.x);
          d.diveTarget = t || { x: BURJ_X, y: CITY_Y };
        }
      }
      if (d.diving && d.diveTarget) {
        const dx = d.diveTarget.x - d.x;
        const dy = d.diveTarget.y - d.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const diveSpeed = Math.abs(d.vx) * 1.2;
        d.vx = (dx / len) * diveSpeed;
        d.vy = (dy / len) * diveSpeed;
        d.x += d.vx * dt * dSlow;
        d.y += d.vy * dt * dSlow;
      } else {
        d.x += d.vx * dt * dSlow;
        d.y += (d.vy + Math.sin(d.wobble) * 0.15) * dt * dSlow;
      }
    } else {
      if (!d.diving) {
        d.x += d.vx * dt * dSlow;
        d.y += (d.vy + Math.sin(d.wobble) * 0.3) * dt * dSlow;
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
          d.diving = true;
          const diveT = pickTarget(g, d.x);
          d.diveTarget = diveT || { x: BURJ_X, y: CITY_Y };
        }
      } else {
        const dx = d.diveTarget.x - d.x;
        const dy = d.diveTarget.y - d.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const diveSpeed = Math.max(Math.abs(d.vx), 1.0) * 1.1;
        d.vx = (dx / len) * diveSpeed;
        d.vy = (dy / len) * diveSpeed;
        d.x += d.vx * dt * dSlow;
        d.y += d.vy * dt * dSlow;
      }
    }
    if (d.x < -60 || d.x > CANVAS_W + 60 || d.y > CANVAS_H + 20) d.alive = false;
    // Shahed impact
    if (d.diving && d.diveTarget && d.alive) {
      const hitTarget = dist(d.x, d.y, d.diveTarget.x, d.diveTarget.y) < 20;
      const hitGround = d.y >= GROUND_Y - 5;
      if (hitTarget || hitGround) {
        d.alive = false;
        boom(g, d.x, d.y, 40, "#ff6600", false, onEvent);
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
            if (g.launcherHP[i] <= 0) {
              g.ammo[i] = 0;
              if (onEvent) onEvent("sfx", { name: "launcherDestroyed" });
            }
          }
        });
        if (g.burjAlive && Math.abs(d.x - BURJ_X) < 50) {
          g.burjHealth--;
          if (onEvent) onEvent("sfx", { name: "burjHit" });
          if (g.burjHealth <= 0) {
            g.burjAlive = false;
            boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 60, "#ff2200", false, onEvent);
          }
        }
      }
    }
  });

  // Update interceptors
  g.interceptors.forEach((ic) => {
    if (!ic.alive) return;
    ic.trail.push({ x: ic.x, y: ic.y });
    if (ic.trail.length > 15) ic.trail.shift();
    ic.x += ic.vx * dt;
    ic.y += ic.vy * dt;
    if (dist(ic.x, ic.y, ic.targetX, ic.targetY) < 16) {
      ic.alive = false;
      if (ic.fromF15) {
        boom(g, ic.x, ic.y, 30, "#aaccff", false, onEvent);
      } else {
        boom(g, ic.x, ic.y, 49, COL.interceptor, true, onEvent);
      }
    }
    if (ic.fromF15 && (ic.x < -50 || ic.x > CANVAS_W + 50 || ic.y < -50 || ic.y > CANVAS_H + 50)) ic.alive = false;
  });

  // Explosion collisions
  g.explosions.forEach((ex) => {
    if (ex.growing) {
      ex.radius += 2 * dt;
      if (ex.radius >= ex.maxRadius) ex.growing = false;
    } else ex.alpha -= 0.03 * dt;
    if (ex.alpha > 0.2) {
      if (!ex.kills) ex.kills = 0;
      g.missiles.forEach((m) => {
        if (m.alive && dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
          m.alive = false;
          g.score += m.type === "bomb" ? 75 : 50;
          g.stats.missileKills++;
          ex.kills++;
          boom(g, m.x, m.y, 30, "#ffcc00", ex.playerCaused, onEvent);
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
            ex.kills++;
            boom(g, d.x, d.y, 60, "#ff8800", ex.playerCaused, onEvent);
          }
        }
      });
      // Multi-kill bonus
      if (ex.kills >= 2 && !ex.bonusAwarded) {
        ex.bonusAwarded = true;
        const bonus = ex.kills === 2 ? 100 : ex.kills === 3 ? 250 : 500;
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.score += bonus;
        g.multiKillToast = { label, bonus, x: ex.x, y: ex.y, timer: 90 };
        if (onEvent) onEvent("sfx", { name: "multiKill" });
      }
    }
    // Check again at end of frame — explosion may have gotten more kills while still growing
    if (ex.bonusAwarded && ex.kills > (ex._lastBonusKills || 0)) {
      const prevKills = ex._lastBonusKills || 2;
      if (ex.kills > prevKills) {
        // Upgrade the bonus
        const oldBonus = prevKills === 2 ? 100 : prevKills === 3 ? 250 : 500;
        const newBonus = ex.kills === 2 ? 100 : ex.kills === 3 ? 250 : 500;
        g.score += newBonus - oldBonus;
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.multiKillToast = { label, bonus: newBonus, x: ex.x, y: ex.y, timer: 90 };
      }
    }
    if (ex.kills) ex._lastBonusKills = ex.kills;
  });

  // F-15s
  g.planes.forEach((p) => {
    if (!p.alive) return;
    p.blinkTimer += dt;

    // Evasion: bank away from nearby player explosions
    if (p.evadeTimer > 0) {
      p.evadeTimer -= dt;
      if (p.evadeTimer <= 0) {
        p.vy = 0; // return to level flight
        p.evadeTimer = 0;
      }
    } else {
      g.explosions.forEach((ex) => {
        if (ex.playerCaused && ex.growing && p.alive && dist(p.x, p.y, ex.x, ex.y) < 120) {
          // Bank away from explosion
          p.vy = ex.y > p.y ? -3 : 3;
          p.evadeTimer = 30;
        }
      });
    }

    p.x += p.vx * dt;
    p.y = Math.max(60, Math.min(320, p.y + p.vy * dt));
    p.fireTimer += dt;
    if (p.fireTimer >= p.fireInterval) {
      let closest = null,
        closestD = 200;
      allThreats.forEach((t) => {
        const d2 = dist(p.x, p.y, t.x, t.y);
        if (d2 < closestD) {
          closestD = d2;
          closest = t;
        }
      });
      if (closest) {
        p.fireTimer = 0;
        const spd = 8;
        // Lead the target: estimate where it will be when interceptor arrives
        let aimX = closest.x, aimY = closest.y;
        for (let i = 0; i < 4; i++) {
          const d = Math.sqrt((aimX - p.x) ** 2 + (aimY - p.y) ** 2);
          const frames = d / spd;
          aimX = closest.x + (closest.vx || 0) * frames;
          aimY = closest.y + (closest.vy || 0) * frames;
        }
        const dx = aimX - p.x,
          dy = aimY - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        g.interceptors.push({
          x: p.x,
          y: p.y,
          targetX: aimX,
          targetY: aimY,
          vx: (dx / len) * spd,
          vy: (dy / len) * spd,
          trail: [],
          alive: true,
          fromF15: true,
        });
      }
    }
    // Only direct interceptor hits kill F-15s (not splash damage)
    g.interceptors.forEach((ic) => {
      if (!ic.alive || ic.fromF15) return;
      if (p.alive && dist(ic.x, ic.y, p.x, p.y) < 18) {
        ic.alive = false;
        p.alive = false;
        g.score -= 500;
        boom(g, p.x, p.y, 40, "#ff0000", false, onEvent);
      }
    });
    // Missiles pass through F-15s — only player interceptors can shoot them down
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

export function buyUpgrade(g, key) {
  const def = UPGRADES[key];
  if (!def) return false;
  const lvl = g.upgrades[key];
  if (lvl >= def.maxLevel) return false;
  const cost = def.costs[lvl];
  if (g.score < cost) return false;
  g.score -= cost;
  g.upgrades[key]++;
  // Consumable: Burj Repair Kit
  if (key === "burjRepair") {
    g.burjHealth = Math.min(5, g.burjHealth + 1);
    if (g.burjHealth > 0) g.burjAlive = true;
    return true;
  }
  // Reinforced upgrade (launcherKit L2): set alive launchers to 2 HP
  if (key === "launcherKit" && g.upgrades.launcherKit >= 2) {
    for (let i = 0; i < g.launcherHP.length; i++) {
      if (g.launcherHP[i] > 0) g.launcherHP[i] = 2;
    }
  }
  // Register or revive defense site
  const existingSite = g.defenseSites.find((s) => s.key === key);
  if (existingSite) {
    existingSite.alive = true;
    existingSite.savedLevel = g.upgrades[key];
  } else {
    const siteDefs = {
      patriot: { x: 50, y: GROUND_Y - 15, hw: 25, hh: 15 },
      flare: { x: 380, y: GROUND_Y - 18, hw: 12, hh: 20 },
      ironBeam: { x: 320, y: GROUND_Y - 15, hw: 10, hh: 15 },
      wildHornets: { x: 150, y: GROUND_Y - 15, hw: 20, hh: 15 },
      roadrunner: { x: 620, y: GROUND_Y - 15, hw: 20, hh: 15 },
      launcherKit: { x: 770, y: GROUND_Y - 15, hw: 20, hh: 15 },
    };
    if (key === "phalanx") {
      g.defenseSites.push({
        key: "phalanx",
        x: 720,
        y: GROUND_Y - 30,
        alive: true,
        hw: 10,
        hh: 15,
        savedLevel: g.upgrades[key],
      });
    } else if (siteDefs[key]) {
      const sd = siteDefs[key];
      g.defenseSites.push({ key, x: sd.x, y: sd.y, alive: true, hw: sd.hw, hh: sd.hh, savedLevel: g.upgrades[key] });
    }
  }
  // Set EMP charge rate on purchase/upgrade
  if (key === "emp") {
    g.empChargeMax = [1200, 900, 720][g.upgrades.emp - 1];
    g.empCharge = g.empChargeMax;
    g.empReady = true;
  }
  return true;
}

export function closeShop(g) {
  g.wave++;
  g.waveMissiles = 0;
  g.waveTarget = 8 + g.wave * 4;
  g.spawnInterval = Math.max(25, 120 - g.wave * 8);
  g.droneInterval = Math.max(40, 160 - g.wave * 20);
  const baseAmmo = 12 + g.wave * 1;
  const ammoMultiplier = g.upgrades.launcherKit >= 3 ? 2 : g.upgrades.launcherKit >= 1 ? 1.5 : 1;
  g.ammo = g.ammo.map((_, i) => (g.launcherHP[i] > 0 ? Math.round(baseAmmo * ammoMultiplier) : 0));
  g.waveComplete = false;
  g.state = "playing";
}

export function fireEmp(g, onEvent) {
  if (!g.empReady || g.upgrades.emp <= 0) return false;
  const lvl = g.upgrades.emp;
  g.empCharge = 0;
  g.empReady = false;
  g.empRings.push({
    x: BURJ_X,
    y: GROUND_Y - BURJ_H * 0.5,
    radius: 0,
    maxRadius: [250, 400, 550][lvl - 1],
    damage: lvl,
    applySlow: lvl >= 3,
    hitSet: new Set(),
    alive: true,
    alpha: 1,
  });
  g.shakeTimer = 6;
  g.shakeIntensity = 3;
  if (onEvent) onEvent("sfx", { name: "empBlast" });
  return true;
}

export function repairCost(wave) {
  return 200 + 50 * wave;
}

export function repairSite(g, siteKey) {
  const cost = repairCost(g.wave);
  if (g.score < cost) return false;
  const site = g.defenseSites.find((s) => s.key === siteKey && !s.alive);
  if (!site) return false;
  g.score -= cost;
  site.alive = true;
  return true;
}

export function repairLauncher(g, index) {
  const cost = repairCost(g.wave);
  if (g.score < cost) return false;
  if (g.launcherHP[index] > 0) return false;
  g.score -= cost;
  const baseHP = g.upgrades.launcherKit >= 2 ? 2 : 1;
  g.launcherHP[index] = baseHP;
  return true;
}

export function createGameSim(options = {}) {
  const onEvent = options.onEvent || (() => {});
  return {
    initGame,
    update: (g, dt) => update(g, dt, onEvent),
    buyUpgrade,
    closeShop,
    spawnMissile,
    spawnDrone,
    spawnPlane: (g) => spawnPlane(g, onEvent),
    updateAutoSystems: (g, dt, threats) => updateAutoSystems(g, dt, threats, onEvent),
  };
}
