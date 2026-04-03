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
  dist,
  rand,
  randInt,
  pickTarget,
  createExplosion,
  destroyDefenseSite,
  getPhalanxTurrets,
  damageTarget,
  getKillReward,
  getAmmoCapacity,
  getMultiKillBonus,
  getRng,
  computeShahed238Path,
  ov,
} from "./game-logic.js";
import { createCommander, generateWaveSchedule, advanceSpawnSchedule, isWaveFullySpawned } from "./wave-spawner.js";

// ── UPGRADE DEFINITIONS ──
export const UPGRADES = {
  wildHornets: {
    name: "Wild Hornets",
    icon: "\uD83D\uDC1D",
    desc: "Ukrainian FPV drone swarm. Fast-response drones thin bombs, drones, and clutter before they become emergencies.",
    maxLevel: 3,
    costs: [532, 2016, 4991],
    color: COL.hornet,
    statLines: [
      "2 drones / 2.5s \u00B7 bomb + drone priority \u00B7 25 blast",
      "3 drones / 2.5s \u00B7 battlefield control \u00B7 30 blast",
      "5 drones / 1.8s \u00B7 swarm control \u00B7 40 blast",
    ],
  },
  roadrunner: {
    name: "Anduril Roadrunner",
    icon: "\uD83E\uDD85",
    desc: "AI-guided reusable interceptor. Precision hunter for MIRVs, jets, bombs, and must-kill threats.",
    maxLevel: 3,
    costs: [805, 2520, 6048],
    color: COL.roadrunner,
    statLines: [
      "1 interceptor / 5s \u00B7 MIRV + jet priority",
      "2 interceptors / 4s \u00B7 precision strikes",
      "3 interceptors / 3s \u00B7 elite threat hunter",
    ],
  },
  flare: {
    name: "Decoy Flares",
    icon: "\uD83C\uDF86",
    desc: "Burj launches IR decoys that scramble guidance systems. Lures missiles, bombs, and drones to self-destruct.",
    maxLevel: 3,
    costs: [707, 2219, 5544],
    color: COL.flare,
    statLines: [
      "4 flares / 4s \u00B7 lures 1 per flare",
      "4 flares / 3s \u00B7 lures 2 per flare",
      "4 flares / 2s \u00B7 lures 3 per flare",
    ],
  },
  ironBeam: {
    name: "Iron Beam",
    icon: "\u26A1",
    desc: "High-energy laser defense. Instant beam locks on and burns down incoming projectiles.",
    maxLevel: 3,
    costs: [1050, 3311, 7777],
    color: COL.laser,
    statLines: [
      "1 beam \u00B7 42 range \u00B7 very slow charge",
      "2 beams \u00B7 56 range \u00B7 slow",
      "3 beams \u00B7 70 range \u00B7 medium",
    ],
  },
  phalanx: {
    name: "Phalanx CIWS",
    icon: "\uD83D\uDD2B",
    desc: "Close-in weapon system. Last-resort rapid-fire autocannon near protected sites.",
    maxLevel: 3,
    costs: [854, 2821, 6552],
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
    desc: "Fast SAM barrage. Prioritizes MIRVs, missiles, and jet drones with homing intercepts.",
    maxLevel: 3,
    costs: [1512, 3479, 7966],
    color: COL.patriot,
    statLines: [
      "2 missiles / 8s \u00B7 MIRV priority \u00B7 56 blast",
      "3 missiles / 6s \u00B7 fast homing \u00B7 72 blast",
      "4 missiles / 5s \u00B7 rapid barrage \u00B7 88 blast",
    ],
  },
  burjRepair: {
    name: "Burj Repair Kit",
    icon: "\uD83D\uDD27",
    desc: "Emergency structural repair. Restores 1 HP to Burj Khalifa.",
    maxLevel: 3,
    costs: [1512, 2520, 4032],
    color: "#00ffcc",
    statLines: ["+1 Burj HP (1/3)", "+1 Burj HP (2/3)", "+1 Burj HP (3/3)"],
    consumable: true,
    disabled: true,
  },
  launcherKit: {
    name: "Launcher Upgrade",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Progressive launcher enhancement. Magazine, armor, then double magazine.",
    maxLevel: 3,
    costs: [805, 1813, 3024],
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
    costs: [1211, 3227, 7560],
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

function boom(g, x, y, radius, color, playerCaused, onEvent, initialRadius = 0, options = {}) {
  createExplosion(g, x, y, radius, color, playerCaused, initialRadius, options);
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

  const commander = createCommander("balanced");
  const wave1 = generateWaveSchedule(1, commander);

  const g = {
    _debugMode: false,
    _showColliders: false,
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
    planeTimer: 0,
    planeInterval: 800,
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
    hornetTimer: 360,
    roadrunnerTimer: 480,
    ironBeamTimer: 360,
    phalanxTimer: 5,
    patriotTimer: 480,
    flareTimer: 240,
    nextFlareId: 1,
    empCharge: 0,
    empChargeMax: 0,
    empReady: false,
    empRings: [],
    multiKillToast: null,
    // Spawn commander + schedule
    commander,
    schedule: wave1.schedule,
    scheduleIdx: 0,
    waveTick: 0,
    concurrentCap: wave1.concurrentCap,
    waveTactics: wave1.tactics,
  };

  return g;
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function spawnMirv(g, onEvent) {
  const startX = rand(100, CANVAS_W - 100);
  const target = pickTarget(g, startX);
  if (!target) return;
  const startY = -20;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const speed = (rand(0.6, 0.9) + g.wave * 0.05) * 2;
  const hp = 3 + Math.floor(g.wave / 4);
  g.missiles.push({
    x: startX,
    y: startY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    accel: 1.012,
    trail: [],
    alive: true,
    type: "mirv",
    health: hp,
    maxHealth: hp,
    splitY: rand(120, 200),
    warheadCount: 5 + Math.min(3, Math.max(0, Math.floor((g.wave - 8) / 3))),
    splitTriggered: false,
    empSlowTimer: 0,
    _hitByExplosions: new Set(),
  });
  if (onEvent) onEvent("sfx", { name: "mirvIncoming" });
}

export function spawnPlane(g, onEvent) {
  const _rng = getRng();
  const goRight = _rng() > 0.5;
  g.planes.push({
    x: goRight ? -60 : CANVAS_W + 60,
    y: rand(80, 200),
    vx: goRight ? rand(5.6, 8.0) : rand(-8.0, -5.6),
    vy: 0,
    blinkTimer: 0,
    alive: true,
    fireTimer: 20,
    fireInterval: 25,
    evadeTimer: 0,
  });
  if (onEvent) onEvent("sfx", { name: "planePass" });
}

export function spawnMissile(g, overrides) {
  const _rng = getRng();
  const speed = (rand(0.5, 1.0) + g.wave * 0.08) * 2;
  const sideMinY = 20,
    sideMaxY = 200;
  const topSpawnY = -10;
  let startX, startY;
  const side = overrides?.side;
  if (side === "left") {
    startX = -10;
    startY = rand(sideMinY, sideMaxY);
  } else if (side === "right") {
    startX = CANVAS_W + 10;
    startY = rand(sideMinY, sideMaxY);
  } else if (side === "top") {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
  } else if (g.wave >= 2 && _rng() < Math.min(0.4, (g.wave - 1) * 0.1)) {
    const fromLeft = _rng() > 0.5;
    startX = fromLeft ? -10 : CANVAS_W + 10;
    startY = rand(sideMinY, sideMaxY);
  } else {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
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
  if (len < 1) return;
  g.missiles.push({
    x: startX,
    y: startY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    accel: 1.003 + g.wave * 0.0006,
    trail: [],
    alive: true,
    type: "missile",
    _hitByExplosions: new Set(),
  });
}

export function spawnDroneOfType(g, subtype, overrides) {
  const _rng = getRng();
  const isJet = subtype === "shahed238";
  const side = overrides?.side;
  const yRange = overrides?.yRange || [80, 250];
  let goingRight;
  if (side === "left") goingRight = true;
  else if (side === "right") goingRight = false;
  else goingRight = _rng() > 0.5;
  const baseSpeed = isJet ? rand(2.5, 3.9) : rand(0.6, 1.2);
  const speed = (baseSpeed + g.wave * 0.05) * 2;
  const health = isJet ? 1 : 1 + Math.floor(g.wave / 3);
  const spawnX = goingRight ? -20 : CANVAS_W + 20;
  const spawnY = rand(yRange[0], yRange[1]);
  const drone = {
    x: spawnX,
    y: spawnY,
    vx: goingRight ? speed : -speed,
    vy: rand(-0.1, 0.3),
    wobble: rand(0, Math.PI * 2),
    alive: true,
    type: "drone",
    subtype,
    health,
    _hitByExplosions: new Set(),
  };
  if (isJet) {
    const estimatedMidX = spawnX + (goingRight ? 1 : -1) * CANVAS_W * 0.4;
    const target = pickTarget(g, estimatedMidX) || { x: BURJ_X, y: CITY_Y };
    const path = computeShahed238Path(spawnX, spawnY, goingRight, speed, target);
    drone.waypoints = path.waypoints;
    drone.pathIndex = 0;
    drone.bombIndices = path.bombIndices;
    drone.bombsDropped = 0;
    drone.diveStartIndex = path.diveStartIndex;
    drone.diveTarget = target;
  }
  g.drones.push(drone);
}

export function spawnDrone(g) {
  const _rng = getRng();
  const jetChance = g.wave >= 3 ? Math.min(1, 0.2 + (g.wave - 3) * 0.16) : 0;
  const isJet = jetChance > 0 && _rng() < jetChance;
  spawnDroneOfType(g, isJet ? "shahed238" : "shahed136");
}

function isSiteAlive(g, key) {
  const site = g.defenseSites.find((s) => s.key === key);
  return !site || site.alive; // no site yet (pre-purchase) = active
}

function isThreatDamaged(t) {
  if (typeof t.health === "number" && typeof t.maxHealth === "number") return t.health < t.maxHealth;
  return !!(t._hitByExplosions && t._hitByExplosions.size > 0);
}

function pickHornetTarget(allThreats, activeHornets, lvl) {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return null;

  const assignmentCounts = new Map();
  activeHornets.forEach((h) => {
    if (h.alive && h.targetRef?.alive) {
      assignmentCounts.set(h.targetRef, (assignmentCounts.get(h.targetRef) || 0) + 1);
    }
  });

  // Prefer unassigned threats — only double up if every threat already has a hornet
  const unassigned = aliveThreats.filter((t) => !assignmentCounts.has(t));
  const pool = unassigned.length > 0 ? unassigned : aliveThreats;

  const scored = pool.map((t) => {
    let priority = 0;
    if (t.type === "bomb") priority = 400;
    else if (t.type === "drone") priority = 300;
    else if (isThreatDamaged(t)) priority = 200;
    else priority = 100;

    if (lvl === 1 && t.type === "drone") priority += 30;
    if (lvl === 1 && t.type === "bomb") priority += 20;

    const assigned = assignmentCounts.get(t) || 0;
    const score = priority - assigned * 75 + Math.min(t.y || 0, 500) * 0.05;
    return { target: t, score, assigned };
  });

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topBand = scored.filter((s) => s.score >= topScore - 25);
  return topBand[randInt(0, topBand.length - 1)].target;
}

function pickHornetRetargetTarget(h, allThreats, activeHornets, lvl) {
  const alive = allThreats.filter((t) => t.alive);
  if (alive.length === 0) return null;

  // Prefer targets in the forward cone first
  const lastTrail = h.trail[h.trail.length - 1];
  if (lastTrail) {
    const dirX = h.x - lastTrail.x;
    const dirY = h.y - lastTrail.y;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen > 0.001) {
      const reach = h.speed * 120;
      const forward = alive.filter((t) => {
        const toX = t.x - h.x;
        const toY = t.y - h.y;
        const d = Math.sqrt(toX * toX + toY * toY);
        if (d > reach) return false;
        return (dirX * toX + dirY * toY) / (dirLen * d) >= 0.5;
      });
      if (forward.length > 0) return pickHornetTarget(forward, activeHornets, lvl);
    }
  }

  // Fallback: pick nearest alive threat regardless of direction
  return pickHornetTarget(alive, activeHornets, lvl);
}

function roadrunnerThreatScore(t) {
  if (!t.alive) return -Infinity;
  if (t.type === "mirv") return 1000 + t.y * 0.2;
  if (t.type === "drone" && t.subtype === "shahed238") return 850 + t.y * 0.15;
  if (t.type === "bomb") return 700 + t.y * 0.25;
  if (t.type === "drone") return 500 + t.y * 0.1;
  return 300 + t.y * 0.35;
}

function pickRoadrunnerTargets(allThreats, activeRoadrunners, count) {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  const reserved = new Set(activeRoadrunners.filter((r) => r.alive && r.targetRef?.alive).map((r) => r.targetRef));
  const picked = [];

  const pickNext = (allowReserved) => {
    const candidates = aliveThreats
      .filter((t) => !picked.includes(t) && (allowReserved || !reserved.has(t)))
      .map((t) => ({ target: t, score: roadrunnerThreatScore(t) }))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.target || null;
  };

  while (picked.length < Math.min(count, aliveThreats.length)) {
    const next = pickNext(false) || pickNext(true);
    if (!next) break;
    picked.push(next);
  }

  return picked;
}

function patriotTargetPriority(t) {
  // MIRVs first (highest priority), then missiles and jet shaheds, then everything else
  if (t.type === "mirv") return 100;
  if (t.type === "mirv_warhead") return 80;
  if (t.type === "missile") return 60;
  if (t.type === "drone" && t.subtype === "shahed238") return 60;
  if (t.type === "bomb") return 50;
  return 10;
}

function pickPatriotTargets(allThreats, count) {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  // Sort by priority (descending), then by Y position (lower = more urgent)
  const sorted = [...aliveThreats].sort((a, b) => patriotTargetPriority(b) - patriotTargetPriority(a) || b.y - a.y);
  return sorted.slice(0, count);
}

function normalizeAngle(angle) {
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function isFlareMissileTarget(m) {
  return m.alive && !m.luredByFlare;
}

function getLiveFlare(g, flareId) {
  if (flareId == null) return null;
  return g.flares.find((f) => f.id === flareId && f.alive) || null;
}

function steerTowardPoint(entity, tx, ty, dt, turnRate) {
  const dx = tx - entity.x;
  const dy = ty - entity.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return len;
  const speed = Math.max(0.001, Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy));
  const currentHeading = Math.atan2(entity.vy, entity.vx);
  const desiredHeading = Math.atan2(dy, dx);
  const headingDelta = normalizeAngle(desiredHeading - currentHeading);
  const maxTurn = turnRate * dt;
  const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
  const nextHeading = currentHeading + appliedTurn;
  entity.vx = Math.cos(nextHeading) * speed;
  entity.vy = Math.sin(nextHeading) * speed;
  return len;
}

function detonateFlareLuredMissile(g, m, onEvent) {
  m.alive = false;
  boom(g, m.x, m.y, 20, COL.flare, false, onEvent, 0, { harmless: true });
  g.stats.missileKills = (g.stats.missileKills || 0) + 1;
}

function launchFlareBurst(g, lvl) {
  const originY = 837;
  // 2 flares to each side of the Burj — near and far anchors
  const offsets = [90, 190];
  for (const side of [-1, 1]) {
    for (const offset of offsets) {
      const anchorX = BURJ_X + side * (offset + rand(-15, 15));
      const originX = BURJ_X + side * rand(8, 18);
      g.flares.push({
        id: g.nextFlareId++,
        x: originX,
        y: originY + rand(-8, 8),
        vx: (anchorX - originX) * 0.028,
        vy: -rand(0.9, 1.7),
        anchorX,
        drag: 0.988,
        life: 180,
        maxLife: 180,
        alive: true,
        luresLeft: lvl,
        hotRadius: 18 + rand(-2, 4),
        trail: [],
      });
    }
  }
}

export function updateAutoSystems(g, dt, allThreats, onEvent) {
  const _rng = getRng();
  // ── WILD HORNETS ──
  // Hornet launching — only if site alive
  if (g.upgrades.wildHornets > 0 && isSiteAlive(g, "wildHornets")) {
    const lvl = g.upgrades.wildHornets;
    const interval = [150, 150, 105][lvl - 1];
    const count = [2, 3, 5][lvl - 1];
    const blastR = [25, 30, 40][lvl - 1];
    g.hornetTimer += dt;
    if (g.hornetTimer >= interval && allThreats.length > 0) {
      g.hornetTimer = 0;
      if (onEvent) onEvent("sfx", { name: "hornetBuzz" });
      for (let i = 0; i < count; i++) {
        const target = pickHornetTarget(allThreats, g.hornets, lvl);
        if (!target) continue;
        g.hornets.push({
          x: rand(100, CANVAS_W - 100),
          y: GROUND_Y - 20,
          targetRef: target,
          speed: rand(4.1, 6.15),
          trail: [],
          alive: true,
          blastRadius: blastR,
          wobble: rand(0, Math.PI * 2),
          life: 600,
        });
      }
    }
  }
  // Hornet in-flight update — always runs so hornets don't freeze when site is destroyed
  g.hornets.forEach((h) => {
    if (!h.alive) return;
    h.life -= dt;
    if (h.life <= 0 || h.x < -60 || h.x > CANVAS_W + 60 || h.y < -60 || h.y > CANVAS_H + 20) {
      h.alive = false;
      boom(g, h.x, h.y, h.blastRadius * 0.5, COL.hornet, false, onEvent, h.blastRadius * 0.2);
      return;
    }
    const t = h.targetRef;
    if (!t || !t.alive) {
      const newT = pickHornetRetargetTarget(
        h,
        allThreats,
        g.hornets.filter((other) => other !== h),
        g.upgrades.wildHornets,
      );
      if (newT) {
        h.targetRef = newT;
      } else {
        // No targets — drift forward, life timer will eventually expire
        h.wobble += 0.15 * dt;
        h.trail.push({ x: h.x, y: h.y });
        if (h.trail.length > 12) h.trail.shift();
        h.y -= h.speed * 0.5 * dt;
        h.x += Math.sin(h.wobble) * 0.8 * dt;
        return;
      }
    }
    h.wobble += 0.15 * dt;
    const dx = h.targetRef.x - h.x;
    const dy = h.targetRef.y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 12) {
      h.alive = false;
      boom(g, h.targetRef.x, h.targetRef.y, h.blastRadius, COL.hornet, false, onEvent, h.blastRadius * 0.5);
      return;
    }
    h.trail.push({ x: h.x, y: h.y });
    if (h.trail.length > 12) h.trail.shift();
    // Lead the target slightly
    const hLeadFrames = d / h.speed;
    const hlx = h.targetRef.x + (h.targetRef.vx || 0) * hLeadFrames * 0.3;
    const hly = h.targetRef.y + (h.targetRef.vy || 0) * hLeadFrames * 0.3;
    const hld = Math.sqrt((hlx - h.x) ** 2 + (hly - h.y) ** 2) || 1;
    h.x += (((hlx - h.x) / hld) * h.speed + Math.sin(h.wobble) * 0.8) * dt;
    h.y += (((hly - h.y) / hld) * h.speed + Math.cos(h.wobble) * 0.5) * dt;
  });
  g.hornets = g.hornets.filter((h) => h.alive);

  // ── ANDURIL ROADRUNNER ──
  // Roadrunner launching — only if site alive
  if (g.upgrades.roadrunner > 0 && isSiteAlive(g, "roadrunner")) {
    const lvl = g.upgrades.roadrunner;
    const interval = [300, 240, 180][lvl - 1];
    const count = [1, 2, 3][lvl - 1];
    const rrSpeed = [8.4, 11.55, 14.7][lvl - 1];
    const rrBlastR = [27, 27, 28][lvl - 1];
    const rrTurnRate = [0.08, 0.11, 0.14][lvl - 1];
    g.roadrunnerTimer += dt;
    if (g.roadrunnerTimer >= interval && allThreats.length > 0) {
      g.roadrunnerTimer = 0;
      const targets = pickRoadrunnerTargets(allThreats, g.roadrunners, count);
      for (let i = 0; i < targets.length; i++) {
        g.roadrunners.push({
          x: BURJ_X + rand(-30, 30),
          y: GROUND_Y - 10,
          targetRef: targets[i],
          speed: rrSpeed,
          trail: [],
          alive: true,
          phase: "launch",
          launchY: GROUND_Y - 80 - rand(0, 40),
          heading: -Math.PI / 2,
          blastRadius: rrBlastR,
          turnRate: rrTurnRate,
          life: 600,
        });
      }
    }
  }
  // Roadrunner in-flight update — always runs so missiles don't freeze when site is destroyed
  g.roadrunners.forEach((r) => {
    if (!r.alive) return;
    r.life -= dt;
    if (r.life <= 0) {
      r.alive = false;
      boom(g, r.x, r.y, r.blastRadius, COL.roadrunner, false, onEvent, 15);
      return;
    }
    r.trail.push({ x: r.x, y: r.y });
    if (r.trail.length > 20) r.trail.shift();
    if (r.phase === "launch") {
      r.y -= r.speed * 0.8 * dt;
      if (r.y <= r.launchY) r.phase = "track";
    } else {
      const t = r.targetRef;
      if (!t || !t.alive) {
        const newT = pickRoadrunnerTargets(
          allThreats,
          g.roadrunners.filter((other) => other !== r),
          1,
        )[0];
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
        boom(g, r.targetRef.x, r.targetRef.y, r.blastRadius, COL.roadrunner, false, onEvent, 15);
        return;
      }
      // Lead the target slightly
      const leadFrames = d / r.speed;
      const lx = r.targetRef.x + (r.targetRef.vx || 0) * leadFrames * 0.3;
      const ly = r.targetRef.y + (r.targetRef.vy || 0) * leadFrames * 0.3;
      const desiredHeading = Math.atan2(ly - r.y, lx - r.x);
      const headingDelta = normalizeAngle(desiredHeading - r.heading);
      const maxTurn = r.turnRate * dt;
      const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
      r.heading = normalizeAngle(r.heading + appliedTurn);
      r.x += Math.cos(r.heading) * r.speed * dt;
      r.y += Math.sin(r.heading) * r.speed * dt;
      if (r.y >= GROUND_Y - 5) {
        r.alive = false;
        boom(g, r.x, GROUND_Y - 5, r.blastRadius, COL.roadrunner, false, onEvent, 15);
        return;
      }
    }
  });
  g.roadrunners = g.roadrunners.filter((r) => r.alive);

  // ── DECOY FLARES ──
  if (g.upgrades.flare > 0 && isSiteAlive(g, "flare")) {
    const lvl = g.upgrades.flare;
    const interval = [240, 180, 120][lvl - 1];
    const lureRange = [145, 165, 185][lvl - 1];
    const flareY = 837;
    const activationRange = ov("upgrade.flareActivationRange", 320);
    const hasThreats =
      g.missiles.some((m) => isFlareMissileTarget(m) && dist(m.x, m.y, BURJ_X, flareY) < activationRange) ||
      g.drones.some((d) => d.alive && !d.luredByFlare && dist(d.x, d.y, BURJ_X, flareY) < activationRange);
    g.flareTimer += dt;
    if (g.flareTimer >= interval && hasThreats) {
      g.flareTimer = 0;
      launchFlareBurst(g, lvl);
    }
    g.flares.forEach((f) => {
      if (!f.alive) return;
      f.trail.push({ x: f.x, y: f.y });
      if (f.trail.length > 10) f.trail.shift();
      f.vx += (f.anchorX - f.x) * 0.0025 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += (f.life > f.maxLife * 0.55 ? 0.008 : 0.018) * dt;
      f.vx *= f.drag ** dt;
      f.life -= dt;
      if (f.life <= 0 || f.y >= GROUND_Y - 10) f.alive = false;
      f.sparkAccum = (f.sparkAccum || 0) + dt;
      if (f.life > 24 && f.sparkAccum >= 4) {
        f.sparkAccum -= 4;
        g.particles.push({
          x: f.x,
          y: f.y,
          vx: rand(-0.7, 0.7),
          vy: rand(0.1, 1.1),
          life: 12,
          maxLife: 12,
          color: COL.flare,
          size: rand(1, 2),
        });
      }
    });
    // Lure missiles once they enter the flare pocket.
    g.missiles.forEach((m) => {
      if (!isFlareMissileTarget(m)) return;
      const nearFlare = g.flares.find(
        (f) => f.alive && f.life > 24 && f.luresLeft > 0 && dist(m.x, m.y, f.x, f.y) < lureRange,
      );
      if (nearFlare) {
        nearFlare.luresLeft--;
        m.luredByFlare = true;
        m.flareTargetId = nearFlare.id;
        m.lureDeathTimer = 180;
        m.accel = 1;
        steerTowardPoint(m, nearFlare.x, nearFlare.y, 8, 0.5);
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
    // Lure drones
    g.drones.forEach((d) => {
      if (!d.alive || d.luredByFlare) return;
      const nearFlare = g.flares.find(
        (f) => f.alive && f.life > 30 && f.luresLeft > 0 && dist(d.x, d.y, f.x, f.y) < lureRange,
      );
      if (nearFlare) {
        nearFlare.luresLeft--;
        d.luredByFlare = true;
        d.lureDeathTimer = 150;
        // Redirect drone toward flare
        const dx = nearFlare.x - d.x,
          dy = nearFlare.y - d.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const spd = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
        d.vx = (dx / len) * spd;
        d.vy = (dy / len) * spd;
        for (let i = 0; i < 5; i++) {
          g.particles.push({
            x: d.x,
            y: d.y,
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
    const range = [175, 224, 294][lvl - 1];
    const chargeTime = [360, 240, 180][lvl - 1];
    g.ironBeamTimer += dt;
    if (g.ironBeamTimer >= chargeTime) {
      const inRange = allThreats
        .filter((t) => t.alive && dist(t.x, t.y, BURJ_X, 959) < range)
        .sort((a, b) => b.y - a.y);
      for (let i = 0; i < Math.min(beamCount, inRange.length); i++) {
        const t = inRange[i];
        g.laserBeams.push({
          x1: BURJ_X,
          y1: 959,
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
  }
  // Decay existing beams even if site is destroyed
  g.laserBeams.forEach((b) => (b.life -= dt));
  g.laserBeams = g.laserBeams.filter((b) => b.life > 0);
  if (g.laserBeams.length === 0 && g._laserHandle) {
    g._laserHandle.stop();
    g._laserHandle = null;
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
  }
  // Decay existing bullets even if site is destroyed
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

  // ── PATRIOT BATTERY ──
  // Patriot launching — only if site alive
  if (g.upgrades.patriot > 0 && isSiteAlive(g, "patriot")) {
    const lvl = g.upgrades.patriot;
    const interval = [480, 360, 300][lvl - 1];
    const count = [2, 3, 4][lvl - 1];
    const blastR = [56, 72, 88][lvl - 1];
    g.patriotTimer += dt;
    if (g.patriotTimer >= interval && allThreats.length > 0) {
      g.patriotTimer = 0;
      if (onEvent) onEvent("sfx", { name: "patriotLaunch" });
      const targets = pickPatriotTargets(allThreats, count);
      for (let i = 0; i < targets.length; i++) {
        g.patriotMissiles.push({
          x: 334 + rand(-10, 10),
          y: 1511,
          targetRef: targets[i],
          speed: rand(14, 17),
          trail: [],
          alive: true,
          blastRadius: blastR,
          wobble: rand(0, Math.PI * 2),
          life: 200,
        });
      }
    }
  }
  // Patriot in-flight update — hornet-style homing
  g.patriotMissiles.forEach((p) => {
    if (!p.alive) return;
    p.life -= dt;
    if (p.life <= 0 || p.x < -60 || p.x > CANVAS_W + 60 || p.y < -60 || p.y > CANVAS_H + 20) {
      p.alive = false;
      boom(g, p.x, p.y, p.blastRadius * 0.5, COL.patriot, false, onEvent, p.blastRadius * 0.2);
      return;
    }
    const t = p.targetRef;
    if (!t || !t.alive) {
      // Prefer threats on current flight path, fall back to any alive threat
      const candidates = pickPatriotTargets(allThreats, 5);
      let best = null;
      const pdx = p.targetRef ? p.targetRef.x - p.x : 0;
      const pdy = p.targetRef ? p.targetRef.y - p.y : -1;
      const pMag = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
      const pnx = pdx / pMag;
      const pny = pdy / pMag;
      for (const c of candidates) {
        const cdx = c.x - p.x;
        const cdy = c.y - p.y;
        const cMag = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
        const dot = (cdx / cMag) * pnx + (cdy / cMag) * pny;
        if (dot > 0.5) {
          best = c;
          break;
        }
      }
      if (!best && candidates.length > 0) best = candidates[0];
      if (best) {
        p.targetRef = best;
      } else {
        // No threats — drift upward, life timer will expire naturally
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 18) p.trail.shift();
        p.y -= p.speed * 0.5 * dt;
        return;
      }
    }
    p.wobble += 0.12 * dt;
    const dx = p.targetRef.x - p.x;
    const dy = p.targetRef.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 15) {
      p.alive = false;
      boom(g, p.targetRef.x, p.targetRef.y, p.blastRadius, COL.patriot, false, onEvent, p.blastRadius * 0.4);
      return;
    }
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 18) p.trail.shift();
    // Lead the target
    const pLeadFrames = d / p.speed;
    const plx = p.targetRef.x + (p.targetRef.vx || 0) * pLeadFrames * 0.4;
    const ply = p.targetRef.y + (p.targetRef.vy || 0) * pLeadFrames * 0.4;
    const pld = Math.sqrt((plx - p.x) ** 2 + (ply - p.y) ** 2) || 1;
    p.x += (((plx - p.x) / pld) * p.speed + Math.sin(p.wobble) * 0.6) * dt;
    p.y += (((ply - p.y) / pld) * p.speed + Math.cos(p.wobble) * 0.4) * dt;
  });
  g.patriotMissiles = g.patriotMissiles.filter((p) => p.alive);

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
          damageTarget(g, t, ring.damage, COL.emp, 20, { noExplosion: true });
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

function updateMissiles(g, dt, onEvent) {
  g.missiles.forEach((m) => {
    if (!m.alive) return;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 30) m.trail.shift();
    if (m.accel) {
      m.vx *= m.accel ** dt;
      m.vy *= m.accel ** dt;
    }
    if (m.luredByFlare) {
      const flareTarget = getLiveFlare(g, m.flareTargetId);
      if (flareTarget) {
        const lureDist = steerTowardPoint(m, flareTarget.x, flareTarget.y, dt, 0.2);
        if (lureDist <= flareTarget.hotRadius) {
          detonateFlareLuredMissile(g, m, onEvent);
          return;
        }
      }
      m.accel = 1;
    }
    const mSlow = m.empSlowTimer > 0 ? ((m.empSlowTimer -= dt), 0.4) : 1;
    m.x += m.vx * dt * mSlow;
    m.y += m.vy * dt * mSlow;
    if (m.luredByFlare) {
      const flareTarget = getLiveFlare(g, m.flareTargetId);
      if (flareTarget && dist(m.x, m.y, flareTarget.x, flareTarget.y) <= flareTarget.hotRadius) {
        detonateFlareLuredMissile(g, m, onEvent);
        return;
      }
    }
    // Lured missiles self-destruct after guidance scramble
    if (m.lureDeathTimer > 0) {
      m.lureDeathTimer -= dt;
      if (m.lureDeathTimer <= 0) {
        detonateFlareLuredMissile(g, m, onEvent);
        return;
      }
    }
    // MIRV split
    if (m.type === "mirv" && !m.splitTriggered && m.y >= m.splitY) {
      m.splitTriggered = true;
      m.alive = false;
      for (let i = 0; i < m.warheadCount; i++) {
        const t = pickTarget(g, m.x);
        if (!t) continue;
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const spd = (rand(0.8, 1.2) + g.wave * 0.06) * 2;
        g.missiles.push({
          x: m.x + rand(-10, 10),
          y: m.y + rand(-5, 5),
          vx: (dx / len) * spd,
          vy: (dy / len) * spd,
          accel: 1.012 + g.wave * 0.0024,
          trail: [],
          alive: true,
          type: "mirv_warhead",
          empSlowTimer: 0,
          _hitByExplosions: new Set(),
        });
      }
      boom(g, m.x, m.y, 35, COL.mirv, false, onEvent, 0, { harmless: true });
      if (onEvent) onEvent("sfx", { name: "mirvSplit" });
      return;
    }
    // Burj collision — hitbox matches 2x scaled visual (burjScale: 2, anchor at GROUND_Y)
    if (
      g.burjAlive &&
      m.alive &&
      m.y >= GROUND_Y - BURJ_H * 2 - 60 &&
      m.y <= GROUND_Y &&
      Math.abs(m.x - BURJ_X) < ((m.y - (GROUND_Y - BURJ_H * 2 - 60)) / (BURJ_H * 2 + 60)) * 32
    ) {
      m.alive = false;
      boom(g, m.x, m.y, 55, "#ff4400", false, onEvent, 30);
      g.shakeTimer = 10;
      g.shakeIntensity = 4;
      if (!g._debugMode) {
        g.burjHealth--;
        if (onEvent) onEvent("sfx", { name: "burjHit" });
        if (g.burjHealth <= 0) {
          g.burjAlive = false;
          boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 90, "#ff2200", false, onEvent, 50);
        }
      }
    }
    // Building collisions — buildings rendered at buildingScale 2x, anchor bottom-center
    if (m.alive) {
      g.buildings.forEach((b) => {
        if (b.alive && m.alive && m.x >= b.x - b.w / 2 && m.x <= b.x + b.w * 1.5 && m.y >= GROUND_Y - b.h * 2) {
          m.alive = false;
          boom(g, m.x, m.y, 40, "#ff4400", false, onEvent, 20);
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
          boom(g, m.x, m.y, 60, "#ff4400", false, onEvent, 30);
          g.shakeTimer = 12;
          g.shakeIntensity = 5;
        }
      });
    }
    // Launcher collision — launchers rendered at launcherScale 3x
    if (m.alive) {
      LAUNCHERS.forEach((l, i) => {
        if (g.launcherHP[i] > 0 && m.alive && Math.abs(m.x - l.x) < 45 && m.y >= l.y - 36) {
          m.alive = false;
          boom(g, m.x, m.y, 50, "#ff4400", false, onEvent, 25);
          g.shakeTimer = 10;
          g.shakeIntensity = 4;
          if (!g._debugMode) {
            g.launcherHP[i]--;
            if (g.launcherHP[i] <= 0) {
              g.ammo[i] = 0;
              if (onEvent) onEvent("sfx", { name: "launcherDestroyed" });
            }
          }
        }
      });
    }
    // Ground impact
    if (m.alive && m.y >= GROUND_Y) {
      m.alive = false;
      boom(g, m.x, GROUND_Y, 50, "#ff4400", false, onEvent, 25);
    }
    if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
  });
}

function updateDrones(g, _rng, dt, onEvent) {
  g.drones.forEach((d) => {
    if (!d.alive) return;
    // Lured drones self-destruct after guidance scramble
    if (d.lureDeathTimer > 0) {
      d.lureDeathTimer -= dt;
      if (d.lureDeathTimer <= 0) {
        d.alive = false;
        boom(g, d.x, d.y, 20, COL.flare, false, onEvent, 0, { harmless: true });
        g.stats.droneKills = (g.stats.droneKills || 0) + 1;
        return;
      }
    }
    if (d.empSlowTimer > 0) d.empSlowTimer -= dt;
    const dSlow = d.empSlowTimer > 0 ? 0.4 : 1;
    d.wobble += 0.05 * dt;
    if (d.subtype === "shahed238") {
      // Follow precomputed Bezier trajectory (skip when lured by flare)
      if (!d.waypoints || d.waypoints.length < 2) {
        d.alive = false;
        return;
      }
      if (d.luredByFlare) {
        d.x += d.vx * dt * dSlow;
        d.y += d.vy * dt * dSlow;
        return;
      }
      const prevX = d.x;
      const prevY = d.y;
      d.pathIndex = Math.min(d.pathIndex + dt * dSlow, d.waypoints.length - 1);
      const i0 = Math.floor(d.pathIndex);
      const frac = d.pathIndex - i0;
      const i1 = Math.min(i0 + 1, d.waypoints.length - 1);
      d.x = d.waypoints[i0].x + (d.waypoints[i1].x - d.waypoints[i0].x) * frac;
      d.y = d.waypoints[i0].y + (d.waypoints[i1].y - d.waypoints[i0].y) * frac;
      d.vx = d.x - prevX;
      d.vy = d.y - prevY;
      if (!d.diving && d.pathIndex >= d.diveStartIndex) d.diving = true;
      // Drop bombs at precomputed path positions
      if (d.bombsDropped < 2 && d.pathIndex >= d.bombIndices[d.bombsDropped]) {
        const bombT = pickTarget(g, d.x);
        if (bombT) {
          g.missiles.push({
            x: d.x,
            y: d.y,
            vx: (bombT.x - d.x) * 0.004,
            vy: rand(2.4, 4.0),
            trail: [],
            alive: true,
            type: "bomb",
            _hitByExplosions: new Set(),
          });
        }
        d.bombsDropped++;
      }
    } else {
      if (!d.diving) {
        d.x += d.vx * dt * dSlow;
        d.y += (d.vy + Math.sin(d.wobble) * 0.3) * dt * dSlow;
        const nearMid = (d.vx > 0 && d.x > CANVAS_W * 0.35) || (d.vx < 0 && d.x < CANVAS_W * 0.65);
        if (nearMid) {
          if (g.wave >= 3 && !d.bombDropped) {
            d.bombDropped = true;
            const bombT = pickTarget(g, d.x);
            if (bombT) {
              const tx = bombT.x;
              g.missiles.push({
                x: d.x,
                y: d.y,
                vx: (tx - d.x) * 0.004,
                vy: rand(2.4, 4.0),
                trail: [],
                alive: true,
                type: "bomb",
                _hitByExplosions: new Set(),
              });
            }
          }
          d.diving = true;
          const diveT = pickTarget(g, d.x);
          d.diveTarget = diveT || { x: BURJ_X, y: CITY_Y };
        }
      } else {
        const dx = d.diveTarget.x - d.x;
        const dy = d.diveTarget.y - d.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) {
          d.alive = false;
        } else {
          if (!d.diveSpeed) d.diveSpeed = Math.max(Math.abs(d.vx), 1.0) * 1.8;
          d.vx = (dx / len) * d.diveSpeed;
          d.vy = (dy / len) * d.diveSpeed;
          d.x += d.vx * dt * dSlow;
          d.y += d.vy * dt * dSlow;
        }
      }
    }
    if (d.x < -60 || d.x > CANVAS_W + 60 || d.y > CANVAS_H + 20) d.alive = false;
    // Burj body collision — hitbox matches 2x scaled visual
    if (
      d.alive &&
      g.burjAlive &&
      d.y >= GROUND_Y - BURJ_H * 2 - 60 &&
      d.y <= GROUND_Y &&
      Math.abs(d.x - BURJ_X) < ((d.y - (GROUND_Y - BURJ_H * 2 - 60)) / (BURJ_H * 2 + 60)) * 32
    ) {
      d.alive = false;
      boom(g, d.x, d.y, 70, "#ff6600", false, onEvent, 40);
      g.shakeTimer = 15;
      g.shakeIntensity = 6;
      if (!g._debugMode) {
        g.burjHealth--;
        if (onEvent) onEvent("sfx", { name: "burjHit" });
        if (g.burjHealth <= 0) {
          g.burjAlive = false;
          boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 90, "#ff2200", false, onEvent, 50);
        }
      }
    }
    // Shahed impact
    if (d.diveTarget && d.alive) {
      const hitTarget = dist(d.x, d.y, d.diveTarget.x, d.diveTarget.y) < 20;
      const hitGround = d.y >= GROUND_Y - 5;
      const pathDone = d.waypoints && d.pathIndex >= d.waypoints.length - 1;
      if (hitTarget || hitGround || pathDone) {
        d.alive = false;
        boom(g, d.x, d.y, 70, "#ff6600", false, onEvent, 40);
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
          if (g.launcherHP[i] > 0 && Math.abs(d.x - l.x) < 90) {
            if (!g._debugMode) {
              g.launcherHP[i]--;
              if (g.launcherHP[i] <= 0) {
                g.ammo[i] = 0;
                if (onEvent) onEvent("sfx", { name: "launcherDestroyed" });
              }
            }
          }
        });
        // Burj damage handled by per-tick body collision above
      }
    }
  });
}

function updateInterceptors(g, dt, onEvent) {
  g.interceptors.forEach((ic) => {
    if (!ic.alive) return;
    ic.trail.push({ x: ic.x, y: ic.y });
    if (ic.trail.length > 15) ic.trail.shift();
    if (!ic.fromF15 && typeof ic.heading === "number") {
      const desiredHeading = Math.atan2(ic.targetY - ic.y, ic.targetX - ic.x);
      const headingDelta = wrapAngle(desiredHeading - ic.heading);
      const maxTurn = (ic.turnRate || 0.22) * dt;
      ic.heading += Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
      if (ic.accel) {
        ic.speed = Math.min(ic.maxSpeed || ic.speed, ic.speed * ic.accel ** dt);
      }
      ic.vx = Math.cos(ic.heading) * ic.speed;
      ic.vy = Math.sin(ic.heading) * ic.speed;
    }
    ic.x += ic.vx * dt;
    ic.y += ic.vy * dt;
    let detonate = false;
    // Scale proximity thresholds with speed so fast interceptors don't skip past targets
    const detonateRadius = 64;
    if (dist(ic.x, ic.y, ic.targetX, ic.targetY) < detonateRadius) {
      detonate = true;
    }
    // Proximity fuse: detonate early if passing close to any threat
    if (!detonate && !ic.fromF15) {
      const fuseRadius = 72;
      for (const m of g.missiles) {
        if (m.alive && dist(ic.x, ic.y, m.x, m.y) < fuseRadius) {
          detonate = true;
          break;
        }
      }
      if (!detonate) {
        for (const d of g.drones) {
          if (d.alive && dist(ic.x, ic.y, d.x, d.y) < fuseRadius) {
            detonate = true;
            break;
          }
        }
      }
    }
    if (detonate) {
      ic.alive = false;
      if (ic.fromF15) {
        boom(g, ic.x, ic.y, 30, "#aaccff", false, onEvent);
      } else {
        boom(g, ic.x, ic.y, 74, COL.interceptor, true, onEvent, 74);
      }
    }
    if (ic.fromF15 && (ic.x < -50 || ic.x > CANVAS_W + 50 || ic.y < -50 || ic.y > CANVAS_H + 50)) ic.alive = false;
  });
}

function updateExplosions(g, dt, onEvent) {
  g.explosions.forEach((ex) => {
    if (ex.growing) {
      ex.radius += (ex.chain ? 4 : 2) * dt;
      if (ex.radius >= ex.maxRadius) ex.growing = false;
    } else ex.alpha -= 0.05 * dt;
    if (ex.ringAlpha > 0) {
      ex.ringRadius += 14 * dt;
      ex.ringAlpha -= 0.25 * dt;
    }
    if (ex.alpha > 0.2 && !ex.harmless) {
      if (!ex.kills) ex.kills = 0;
      // For chain explosions, find the root explosion to aggregate kills
      const rootEx = ex.rootExplosionId != null ? g.explosions.find((e) => e.id === ex.rootExplosionId) || ex : ex;
      const chainOpts = { chain: true, rootExplosionId: rootEx.id };
      g.missiles.forEach((m) => {
        if (!m.alive) return;
        if (m.type === "mirv") {
          if (m._hitByExplosions.has(ex.id)) return;
          if (dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
            m._hitByExplosions.add(ex.id);
            m.health--;
            if (m.health <= 0) {
              m.alive = false;
              g.score += getKillReward(m);
              g.stats.missileKills++;
              rootEx.kills++;
              boom(g, m.x, m.y, 45, COL.mirv, ex.playerCaused, onEvent, 45, chainOpts);
            }
          }
        } else if (dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
          m.alive = false;
          g.score += getKillReward(m);
          g.stats.missileKills++;
          rootEx.kills++;
          boom(g, m.x, m.y, 45, "#ffcc00", ex.playerCaused, onEvent, 45, chainOpts);
        }
      });
      g.drones.forEach((d) => {
        if (!d.alive) return;
        if (d._hitByExplosions.has(ex.id)) return;
        if (dist(d.x, d.y, ex.x, ex.y) < ex.radius + 10) {
          d._hitByExplosions.add(ex.id);
          d.health--;
          if (d.health <= 0) {
            d.alive = false;
            g.score += getKillReward(d);
            g.stats.droneKills++;
            rootEx.kills++;
            boom(g, d.x, d.y, 45, "#ff8800", ex.playerCaused, onEvent, 45, chainOpts);
          }
        }
      });
      // Multi-kill bonus (only check on root explosions)
      if (rootEx === ex && ex.kills >= 2 && !ex.bonusAwarded) {
        ex.bonusAwarded = true;
        const bonus = getMultiKillBonus(ex.kills);
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
        const oldBonus = getMultiKillBonus(prevKills);
        const newBonus = getMultiKillBonus(ex.kills);
        g.score += newBonus - oldBonus;
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.multiKillToast = { label, bonus: newBonus, x: ex.x, y: ex.y, timer: 90 };
      }
    }
    if (ex.kills) ex._lastBonusKills = ex.kills;
  });
}

function updatePlanes(g, dt, allThreats, onEvent) {
  g.planes.forEach((p) => {
    if (!p.alive) return;
    p.blinkTimer += dt;

    // Evasion: bank away from nearby player explosions
    if (p.evadeTimer > 0) {
      p.evadeTimer -= dt;
      if (p.evadeTimer <= 0) {
        p.vy = 0;
        p.evadeTimer = 0;
      }
    } else {
      g.explosions.forEach((ex) => {
        if (ex.playerCaused && ex.growing && p.alive && dist(p.x, p.y, ex.x, ex.y) < 120) {
          p.vy = ex.y > p.y ? -6 : 6;
          p.evadeTimer = 30;
        }
      });
    }

    p.x += p.vx * dt;
    p.y = Math.max(60, Math.min(220, p.y + p.vy * dt));
    p.fireTimer += dt;
    if (p.fireTimer >= p.fireInterval) {
      let closest = null,
        closestD = 350;
      allThreats.forEach((t) => {
        const d2 = dist(p.x, p.y, t.x, t.y);
        if (d2 < closestD) {
          closestD = d2;
          closest = t;
        }
      });
      if (closest) {
        p.fireTimer = 0;
        const spd = 44;
        let aimX = closest.x,
          aimY = closest.y;
        const accelFactor = closest.accel ? closest.accel ** 8 : 1;
        for (let i = 0; i < 6; i++) {
          const d = Math.sqrt((aimX - p.x) ** 2 + (aimY - p.y) ** 2);
          const frames = d / spd;
          aimX = closest.x + (closest.vx || 0) * accelFactor * frames;
          aimY = closest.y + (closest.vy || 0) * accelFactor * frames;
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
    if (p.x < -80 || p.x > CANVAS_W + 80) p.alive = false;
  });
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
        // Draft pick consumes seeded RNG here so replay stays in sync
        if (g._draftMode) {
          g._draftOffers = draftPick3(g);
        }
        if (onEvent) onEvent("shopOpen", { score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
      }
    }
    return;
  }

  // Check wave complete
  if (g.burjAlive && isWaveFullySpawned(g) && g.missiles.length === 0 && g.drones.length === 0) {
    if (g._debugMode) {
      // Loop wave 1 indefinitely — reset spawn schedule
      const wave1 = generateWaveSchedule(1, g.commander);
      g.schedule = wave1.schedule;
      g.scheduleIdx = 0;
      g.waveTick = 0;
      g.concurrentCap = wave1.concurrentCap;
      g.waveTactics = wave1.tactics;
      return;
    }
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

  // Spawning — consume schedule entries
  advanceSpawnSchedule(g, dt, (gameState, type, overrides) => {
    if (type === "missile") spawnMissile(gameState, overrides);
    else if (type === "drone136") spawnDroneOfType(gameState, "shahed136", overrides);
    else if (type === "drone238") spawnDroneOfType(gameState, "shahed238", overrides);
    else if (type === "mirv") spawnMirv(gameState, onEvent);
  });

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
  // Auto-defense systems only target threats visible on screen
  const visibleThreats = allThreats.filter((t) => t.y >= 0);
  updateAutoSystems(g, dt, visibleThreats, onEvent);
  updateMissiles(g, dt, onEvent);
  updateDrones(g, _rng, dt, onEvent);
  updateInterceptors(g, dt, onEvent);
  updateExplosions(g, dt, onEvent);
  updatePlanes(g, dt, allThreats, onEvent);

  g.particles.forEach((p) => {
    if (p.drag) {
      p.vx *= p.drag;
      p.vy *= p.drag;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.gravity ?? 0.05) * dt;
    if (p.angle !== undefined) p.angle += p.spin * dt;
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
      patriot: { x: 334, y: 1511, hw: 38, hh: 24 },
      flare: { x: BURJ_X, y: 837, hw: 8, hh: 10 },
      ironBeam: { x: BURJ_X, y: 959, hw: 10, hh: 15 },
      wildHornets: { x: 206, y: 1511, hw: 30, hh: 24 },
      roadrunner: { x: 678, y: GROUND_Y - 15, hw: 30, hh: 24 },
      launcherKit: { x: 772, y: 1513, hw: 30, hh: 24 },
    };
    if (key === "phalanx") {
      g.defenseSites.push({
        key: "phalanx",
        x: 553,
        y: 1498,
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

const ALL_UPGRADE_KEYS = Object.keys(UPGRADES);

/** Draw 3 unique non-maxed upgrade keys for draft mode using the game's RNG. */
export function draftPick3(g) {
  const rng = getRng();
  const available = ALL_UPGRADE_KEYS.filter((k) => !UPGRADES[k].disabled && g.upgrades[k] < UPGRADES[k].maxLevel);
  if (available.length <= 3) return [...available];
  const pool = [...available];
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

/** Buy an upgrade for free (draft mode). */
export function buyDraftUpgrade(g, key) {
  const def = UPGRADES[key];
  if (!def || g.upgrades[key] >= def.maxLevel) return false;
  const savedCosts = [...def.costs];
  def.costs = [0, 0, 0];
  const ok = buyUpgrade(g, key);
  def.costs = savedCosts;
  return ok;
}

export function closeShop(g) {
  // Auto-repair all destroyed launchers and defense sites (free)
  const baseHP = g.upgrades.launcherKit >= 2 ? 2 : 1;
  for (let i = 0; i < g.launcherHP.length; i++) {
    if (g.launcherHP[i] <= 0) g.launcherHP[i] = baseHP;
  }
  for (const site of g.defenseSites) {
    if (!site.alive) site.alive = true;
  }

  g.wave++;
  const waveData = generateWaveSchedule(g.wave, g.commander);
  g.schedule = waveData.schedule;
  g.scheduleIdx = 0;
  g.waveTick = 0;
  g.concurrentCap = waveData.concurrentCap;
  g.waveTactics = waveData.tactics;
  g.ammo = g.ammo.map((_, i) => (g.launcherHP[i] > 0 ? getAmmoCapacity(g.wave, g.upgrades.launcherKit) : 0));
  g.waveComplete = false;
  g.state = "playing";
}

export function fireEmp(g, onEvent) {
  if (!g.empReady || g.upgrades.emp <= 0) return false;
  const lvl = g.upgrades.emp;
  g.empCharge = 0;
  g.empReady = false;
  g.empRings.push({
    x: 462,
    y: 1047,
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
  if (index < 0 || index >= g.launcherHP.length) return false;
  const cost = repairCost(g.wave);
  if (g.score < cost) return false;
  if (g.launcherHP[index] > 0) return false;
  g.score -= cost;
  const baseHP = g.upgrades.launcherKit >= 2 ? 2 : 1;
  g.launcherHP[index] = baseHP;
  return true;
}

// ── RENDER INTERPOLATION ──
// Snapshot previous positions before each sim tick so the renderer can
// interpolate between the last two ticks for smooth sub-tick movement.

const LERP_ARRAYS_XY = [
  "missiles",
  "drones",
  "interceptors",
  "planes",
  "hornets",
  "roadrunners",
  "patriotMissiles",
  "flares",
  "particles",
];

export function snapshotPositions(g) {
  for (const key of LERP_ARRAYS_XY) {
    const arr = g[key];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      e._px = e.x;
      e._py = e.y;
    }
  }
  // Explosions
  for (let i = 0; i < g.explosions.length; i++) {
    const e = g.explosions[i];
    e._px = e.x;
    e._py = e.y;
  }
  // Phalanx bullets use cx/cy as render position
  for (let i = 0; i < g.phalanxBullets.length; i++) {
    const b = g.phalanxBullets[i];
    if (b.cx !== undefined) {
      b._pcx = b.cx;
      b._pcy = b.cy;
    }
  }
}

export function applyInterpolation(g, alpha) {
  for (const key of LERP_ARRAYS_XY) {
    const arr = g[key];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (e._px === undefined) continue;
      e._ox = e.x;
      e._oy = e.y;
      e.x = e._px + (e.x - e._px) * alpha;
      e.y = e._py + (e.y - e._py) * alpha;
    }
  }
  for (let i = 0; i < g.explosions.length; i++) {
    const e = g.explosions[i];
    if (e._px === undefined) continue;
    e._ox = e.x;
    e._oy = e.y;
    e.x = e._px + (e.x - e._px) * alpha;
    e.y = e._py + (e.y - e._py) * alpha;
  }
  for (let i = 0; i < g.phalanxBullets.length; i++) {
    const b = g.phalanxBullets[i];
    if (b._pcx === undefined) continue;
    b._ocx = b.cx;
    b._ocy = b.cy;
    b.cx = b._pcx + (b.cx - b._pcx) * alpha;
    b.cy = b._pcy + (b.cy - b._pcy) * alpha;
  }
}

export function restorePositions(g) {
  for (const key of LERP_ARRAYS_XY) {
    const arr = g[key];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (e._ox === undefined) continue;
      e.x = e._ox;
      e.y = e._oy;
      e._ox = undefined;
      e._oy = undefined;
    }
  }
  for (let i = 0; i < g.explosions.length; i++) {
    const e = g.explosions[i];
    if (e._ox === undefined) continue;
    e.x = e._ox;
    e.y = e._oy;
    e._ox = undefined;
    e._oy = undefined;
  }
  for (let i = 0; i < g.phalanxBullets.length; i++) {
    const b = g.phalanxBullets[i];
    if (b._ocx === undefined) continue;
    b.cx = b._ocx;
    b.cy = b._ocy;
    b._ocx = undefined;
    b._ocy = undefined;
  }
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
    spawnDroneOfType,
    spawnPlane: (g) => spawnPlane(g, onEvent),
    updateAutoSystems: (g, dt, threats) => updateAutoSystems(g, dt, threats, onEvent),
  };
}
