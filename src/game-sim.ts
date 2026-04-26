import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  GAMEPLAY_WATERLINE_Y,
  GAMEPLAY_SCENIC_THREAT_FLOOR_Y,
  COL,
  BURJ_X,
  BURJ_H,
  MAX_PARTICLES,
  LAUNCHERS,
  createScenicBuildings,
  getDefenseSitePlacement,
  getGameplayBuildingBounds,
  getGameplayBurjCollisionTop,
  getGameplayBurjHalfW,
  getGameplayLauncherPosition,
  dist,
  rand,
  randInt,
  pickTarget,
  createExplosion,
  destroyDefenseSite,
  getPhalanxTurrets,
  damageTarget,
  getKillReward,
  getMultiKillBonus,
  getRng,
  computeShahed136Path,
  computeShahed238Path,
  ov,
} from "./game-logic.js";
import { createCommander, generateWaveSchedule, advanceSpawnSchedule, isWaveFullySpawned } from "./wave-spawner.js";
import { createEmptyUpgradeLevels, createEmptyUpgradeProgression } from "./game-sim-upgrades.js";
import { buyUpgrade, closeShop, draftPick3 } from "./game-sim-shop.js";
import type {
  GameState,
  Threat,
  Missile,
  Drone,
  BurjDamageKind,
  Interceptor,
  Hornet,
  Roadrunner,
  PatriotMissile,
  Flare,
  SpawnEntry,
} from "./types.js";

function boom(
  g: GameState,
  x: number,
  y: number,
  radius: number,
  color: string,
  playerCaused: boolean,
  onEvent: ((type: string, data?: unknown) => void) | null | undefined,
  initialRadius = 0,
  options: Record<string, unknown> = {},
) {
  createExplosion(g, x, y, radius, color, playerCaused, initialRadius, options);
  if (onEvent) {
    const chainLevel = typeof options.chainLevel === "number" ? options.chainLevel : 0;
    onEvent("sfx", {
      name: "explosion",
      size: radius > 45 ? "large" : radius > 25 ? "medium" : "small",
      chainLevel,
    });
    if (chainLevel >= 1) {
      onEvent("sfx", {
        name: "chainExplosion",
        size: radius > 45 ? "large" : radius > 25 ? "medium" : "small",
        chainLevel,
      });
    }
  }
}

let _burjDecalId = 0;
let _burjDamageFxId = 0;
let _buildingDestroyFxId = 0;

function addBurjImpactDamage(g: GameState, x: number, y: number, kind: BurjDamageKind) {
  const jitterX = rand(-3, 3);
  const jitterY = rand(-8, 8);
  const hitX = x + jitterX * 0.65;
  const hitY = y + jitterY * 0.65;
  g.burjDecals.push({
    id: _burjDecalId++,
    x: x + jitterX,
    y: y + jitterY,
    kind,
    rotation: rand(-0.45, 0.45),
    scale: rand(0.82, 1.14),
  });
  g.burjDamageFx.push({
    id: _burjDamageFxId++,
    x: hitX,
    y: hitY,
    kind,
    life: 1,
    maxLife: 1,
    seed: rand(0, Math.PI * 2),
  });
  g.burjHitFlashTimer = 48;
  g.burjHitFlashMax = 48;
  g.burjHitFlashX = hitX;
  g.burjHitFlashY = hitY;
}

function updateBurjDamageFx(g: GameState): void {
  if (g.burjHitFlashTimer > 0) g.burjHitFlashTimer--;
}

function addBuildingDestroyFx(g: GameState, building: { x: number; w: number; h: number }) {
  g.buildingDestroyFx.push({
    id: _buildingDestroyFxId++,
    x: building.x + building.w / 2,
    y: GROUND_Y - 6 - building.h * 0.45,
    life: 70,
    maxLife: 70,
    seed: rand(0, Math.PI * 2),
    w: building.w,
    h: building.h,
  });
}

function updateBuildingDestroyFx(g: GameState, dt: number): void {
  g.buildingDestroyFx.forEach((fx) => {
    fx.life -= dt;
  });
  g.buildingDestroyFx = g.buildingDestroyFx.filter((fx) => fx.life > 0);
}

export function initGame(): GameState {
  const allBuildings = createScenicBuildings();

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
    launcherFireTick: [0, 0, 0],
    launcherReloadUntilTick: [0, 0, 0],
    missiles: [],
    drones: [],
    interceptors: [],
    explosions: [],
    particles: [],
    planes: [],
    buildings: allBuildings,
    buildingDestroyFx: [],
    burjAlive: true,
    burjHealth: 5,
    burjDecals: [],
    burjDamageFx: [],
    burjHitFlashTimer: 0,
    burjHitFlashMax: 0,
    burjHitFlashX: BURJ_X,
    burjHitFlashY: GROUND_Y - BURJ_H * 0.45,
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
    upgrades: createEmptyUpgradeLevels(),
    ownedUpgradeNodes: new Set(),
    metaProgression: createEmptyUpgradeProgression(),
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
    combo: 1,
    comboToast: null,
    // Spawn commander + schedule
    commander,
    schedule: wave1.schedule,
    scheduleIdx: 0,
    waveTick: 0,
    concurrentCap: wave1.concurrentCap,
    waveTactics: wave1.tactics,
  };

  return g as unknown as GameState;
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function spawnMirv(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
  const startX = rand(100, CANVAS_W - 100);
  const target = pickTarget(g, startX);
  if (!target) return;
  const startY = -20;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const speed = (rand(0.6, 0.9) + g.wave * 0.05) * 2;
  const hp = 1;
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
    splitY: rand(180, 300),
    warheadCount: 5 + Math.min(3, Math.max(0, Math.floor((g.wave - 8) / 3))),
    splitTriggered: false,
    empSlowTimer: 0,
    _hitByExplosions: new Set(),
  });
  if (onEvent) onEvent("sfx", { name: "mirvIncoming" });
}

export function spawnPlane(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
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

export function spawnMissile(g: GameState, overrides?: SpawnEntry["overrides"]) {
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
    targetX: target.x,
    targetY: target.y,
    _hitByExplosions: new Set(),
  });
}

function getSplitCandidateTargets(g: GameState): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  if (g.burjAlive) candidates.push({ x: BURJ_X, y: CITY_Y - BURJ_H * 0.32 });
  for (const site of g.defenseSites) {
    if (site.alive) candidates.push({ x: site.x, y: site.y });
  }
  g.launcherHP.forEach((hp, i) => {
    if (hp > 0) {
      const pos = getGameplayLauncherPosition(i);
      candidates.push({ x: pos.x, y: pos.y });
    }
  });
  return candidates;
}

function pickSplitTargetsWide(
  g: GameState,
  extraCount: number,
  originalTargetX: number,
): Array<{ x: number; y: number }> {
  const candidates = getSplitCandidateTargets(g);
  if (candidates.length === 0 || extraCount <= 0) return [];
  const unique = candidates.filter((c, idx) => candidates.findIndex((o) => o.x === c.x && o.y === c.y) === idx);
  const picked: Array<{ x: number; y: number }> = [];
  const anchors = [originalTargetX];

  while (picked.length < Math.min(extraCount, unique.length)) {
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const c of unique) {
      if (picked.includes(c)) continue;
      const spacing = Math.min(...anchors.map((x) => Math.abs(c.x - x)));
      if (spacing > bestScore) {
        best = c;
        bestScore = spacing;
      }
    }
    if (!best) break;
    picked.push(best);
    anchors.push(best.x);
  }
  return picked;
}

export function spawnStackedMissile(g: GameState, stackCount: 2 | 3, overrides?: SpawnEntry["overrides"]) {
  const _rng = getRng();
  const speed = (rand(0.5, 1.0) + g.wave * 0.08) * 2;
  const sideMinY = 20;
  const sideMaxY = 200;
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
    type: stackCount === 2 ? "stack2" : "stack3",
    splitTriggered: false,
    splitAfterDist: len * 0.2,
    travelDist: 0,
    targetX: target.x,
    targetY: target.y,
    _hitByExplosions: new Set(),
  });
}

export function spawnDroneOfType(
  g: GameState,
  subtype: "shahed136" | "shahed238",
  overrides?: SpawnEntry["overrides"],
) {
  const _rng = getRng();
  const isJet = subtype === "shahed238";
  const side = overrides?.side;
  const yRange = overrides?.yRange || (isJet ? [80, 250] : [55, 320]);
  let goingRight;
  if (side === "left") goingRight = true;
  else if (side === "right") goingRight = false;
  else goingRight = _rng() > 0.5;
  const baseSpeed = isJet ? rand(2.5, 3.9) : rand(0.6, 1.2);
  const speed = (baseSpeed + g.wave * 0.05) * 2;
  const health = 1;
  const spawnX = goingRight ? -20 : CANVAS_W + 20;
  const spawnY = rand(yRange[0], yRange[1]);
  const drone: Drone = {
    x: spawnX,
    y: spawnY,
    vx: goingRight ? speed : -speed,
    vy: rand(-0.1, 0.3),
    trail: [],
    wobble: rand(0, Math.PI * 2),
    alive: true,
    type: "drone",
    subtype,
    health,
    collisionRadius: isJet ? 10 : 30,
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
  } else {
    const estimatedMidX = spawnX + (goingRight ? 1 : -1) * CANVAS_W * rand(0.28, 0.42);
    const target = pickTarget(g, estimatedMidX) || { x: BURJ_X, y: CITY_Y };
    const path = computeShahed136Path(spawnX, spawnY, goingRight, speed, target);
    drone.waypoints = path.waypoints;
    drone.pathIndex = 0;
    drone.bombIndices = path.bombIndices;
    drone.bombsDropped = 0;
    drone.diveStartIndex = path.diveStartIndex;
    drone.diveTarget = target;
  }
  g.drones.push(drone);
}

export function spawnDrone(g: GameState) {
  const _rng = getRng();
  const jetChance = g.wave >= 3 ? Math.min(1, 0.2 + (g.wave - 3) * 0.16) : 0;
  const isJet = jetChance > 0 && _rng() < jetChance;
  spawnDroneOfType(g, isJet ? "shahed238" : "shahed136", undefined);
}

function isSiteAlive(g: GameState, key: string): boolean {
  const site = g.defenseSites.find((s) => s.key === key);
  return !site || site.alive; // no site yet (pre-purchase) = active
}

function isThreatDamaged(t: Threat): boolean {
  const maxH = (t as Missile).maxHealth;
  if (typeof t.health === "number" && typeof maxH === "number") return t.health < maxH;
  return !!(t._hitByExplosions && t._hitByExplosions.size > 0);
}

function getNearestThreatDistance(target: Threat, picked: readonly Threat[]): number {
  if (picked.length === 0) return Infinity;
  return picked.reduce((minDist, other) => Math.min(minDist, dist(target.x, target.y, other.x, other.y)), Infinity);
}

function getSpreadBonus(target: Threat, picked: readonly Threat[], cap: number, scale: number): number {
  const nearest = getNearestThreatDistance(target, picked);
  if (!Number.isFinite(nearest)) return 0;
  return Math.min(nearest, cap) * scale;
}

function getHornetAssignmentCounts(activeHornets: Hornet[]): Map<Threat, number> {
  const assignmentCounts = new Map<Threat, number>();
  activeHornets.forEach((h) => {
    if (h.alive && h.targetRef?.alive) {
      assignmentCounts.set(h.targetRef, (assignmentCounts.get(h.targetRef) || 0) + 1);
    }
  });
  return assignmentCounts;
}

function hornetTargetScore(target: Threat, lvl: number, assignedCount: number): number {
  let priority = 0;
  if (target.type === "bomb") priority = 400;
  else if (target.type === "drone") priority = 300;
  else if (isThreatDamaged(target)) priority = 200;
  else priority = 100;

  if (lvl === 1 && target.type === "drone") priority += 30;
  if (lvl === 1 && target.type === "bomb") priority += 20;

  return priority - assignedCount * 75 + Math.min(target.y || 0, 500) * 0.05;
}

function pickHornetTarget(
  allThreats: Threat[],
  activeHornets: Hornet[],
  lvl: number,
  blockedTargets: ReadonlySet<Threat> = new Set(),
): Threat | null {
  const aliveThreats = allThreats.filter((t) => t.alive && !blockedTargets.has(t));
  if (aliveThreats.length === 0) return null;

  const assignmentCounts = getHornetAssignmentCounts(activeHornets);
  const spreadTargets = activeHornets
    .filter((h) => h.alive && h.targetRef?.alive && !blockedTargets.has(h.targetRef))
    .map((h) => h.targetRef!);

  // Prefer unassigned threats — only double up if every threat already has a hornet
  const unassigned = aliveThreats.filter((t) => !assignmentCounts.has(t));
  const pool = unassigned.length > 0 ? unassigned : aliveThreats;

  const scored = pool.map((t: Threat) => {
    const assigned = assignmentCounts.get(t) || 0;
    const score = hornetTargetScore(t, lvl, assigned) + getSpreadBonus(t, spreadTargets, 340, 0.16);
    return { target: t, score, assigned };
  });

  scored.sort(
    (a: { target: Threat; score: number; assigned: number }, b: { target: Threat; score: number; assigned: number }) =>
      b.score - a.score,
  );
  const topScore = scored[0].score;
  const topBand = scored.filter((s: { target: Threat; score: number; assigned: number }) => s.score >= topScore - 25);
  return topBand[randInt(0, topBand.length - 1)].target;
}

function pickHornetLaunchTargets(allThreats: Threat[], activeHornets: Hornet[], lvl: number, count: number): Threat[] {
  const aliveThreats = allThreats.filter((t) => t.alive);
  const assignmentCounts = getHornetAssignmentCounts(activeHornets);
  const activeTargets = Array.from(assignmentCounts.keys());
  const picked: Threat[] = [];
  while (picked.length < Math.min(count, aliveThreats.length)) {
    const available = aliveThreats.filter((t) => !picked.includes(t));
    if (available.length === 0) break;
    const unassigned = available.filter((t) => !assignmentCounts.has(t));
    const pool = unassigned.length > 0 ? unassigned : available;
    const scored = pool
      .map((target) => ({
        target,
        score:
          hornetTargetScore(target, lvl, assignmentCounts.get(target) || 0) +
          getSpreadBonus(target, [...activeTargets, ...picked], 340, 0.16),
      }))
      .sort((a, b) => b.score - a.score);
    const next = scored[0]?.target ?? null;
    if (!next) break;
    picked.push(next);
  }
  return picked;
}

function pickHornetRetargetTarget(
  h: Hornet,
  allThreats: Threat[],
  activeHornets: Hornet[],
  lvl: number,
): Threat | null {
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
      const forward = alive.filter((t: Threat) => {
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

function roadrunnerThreatScore(t: Threat): number {
  if (!t.alive) return -Infinity;
  if (t.type === "mirv") return 1000 + t.y * 0.2;
  if (t.type === "stack3") return 900 + t.y * 0.18;
  if (t.type === "stack2") return 760 + t.y * 0.18;
  if (t.type === "drone" && t.subtype === "shahed238") return 850 + t.y * 0.15;
  if (t.type === "bomb") return 700 + t.y * 0.25;
  if (t.type === "drone") return 500 + t.y * 0.1;
  return 300 + t.y * 0.35;
}

function pickRoadrunnerTargets(allThreats: Threat[], activeRoadrunners: Roadrunner[], count: number): Threat[] {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  const reserved = new Set<Threat>(
    activeRoadrunners.filter((r) => r.alive && r.targetRef?.alive).map((r) => r.targetRef!),
  );
  const spreadTargets = Array.from(reserved);
  const picked: Threat[] = [];

  const pickNext = (allowReserved: boolean): Threat | null => {
    const candidates = aliveThreats
      .filter((t: Threat) => !picked.includes(t) && (allowReserved || !reserved.has(t)))
      .map((t: Threat) => ({
        target: t,
        score: roadrunnerThreatScore(t) + getSpreadBonus(t, [...spreadTargets, ...picked], 320, 0.18),
      }))
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

function patriotTargetPriority(t: Threat): number {
  // MIRVs first (highest priority), then missiles and jet shaheds, then everything else
  if (t.type === "mirv") return 100;
  if (t.type === "stack3") return 88;
  if (t.type === "mirv_warhead") return 80;
  if (t.type === "stack2") return 72;
  if (t.type === "missile") return 60;
  if (t.type === "drone" && t.subtype === "shahed238") return 60;
  if (t.type === "bomb") return 50;
  return 10;
}

function pickPatriotTargets(allThreats: Threat[], activePatriots: PatriotMissile[], count: number): Threat[] {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  const reserved = new Set<Threat>(
    activePatriots.filter((p) => p.alive && p.targetRef?.alive).map((p) => p.targetRef!),
  );
  const spreadTargets = Array.from(reserved);
  const picked: Threat[] = [];

  const pickNext = (allowReserved: boolean): Threat | null => {
    const sorted = [...aliveThreats]
      .filter((t) => !picked.includes(t) && (allowReserved || !reserved.has(t)))
      .map((t) => ({
        target: t,
        score: patriotTargetPriority(t) * 10 + t.y * 0.1 + getSpreadBonus(t, [...spreadTargets, ...picked], 360, 0.16),
      }))
      .sort((a, b) => b.score - a.score);
    return sorted[0]?.target ?? null;
  };

  while (picked.length < Math.min(count, aliveThreats.length)) {
    const next = pickNext(false) || pickNext(true);
    if (!next) break;
    picked.push(next);
  }

  return picked;
}

function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function isFlareMissileTarget(m: Missile): boolean {
  return m.alive && !m.luredByFlare;
}

function getLiveFlare(g: GameState, flareId: number | null | undefined): Flare | null {
  if (flareId == null) return null;
  return g.flares.find((f) => f.id === flareId && f.alive) || null;
}

function steerTowardPoint(
  entity: { x: number; y: number; vx: number; vy: number },
  tx: number,
  ty: number,
  dt: number,
  turnRate: number,
): number {
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

function detonateFlare(
  g: GameState,
  flare: Flare,
  onEvent: ((type: string, data?: unknown) => void) | null | undefined,
) {
  flare.alive = false;
  boom(g, flare.x, flare.y, 65, COL.flare, true, onEvent, 15);
}

function launchFlareBurst(g: GameState, lvl: number) {
  const originY = 837;
  // Near flare: low angle, stays lower; Far flare: ~45 degrees, climbs higher
  const slots = [
    { offset: 110, vyFn: () => -rand(1.0, 1.6) }, // near — shallow arc
    { offset: 230, vyFn: (vx: number) => -(Math.abs(vx) * rand(0.9, 1.1)) }, // far — ~45 degrees
  ];
  for (const side of [-1, 1]) {
    for (const { offset, vyFn } of slots) {
      const anchorX = BURJ_X + side * (offset + rand(-15, 15));
      const originX = BURJ_X + side * rand(8, 18);
      const vx = (anchorX - originX) * 0.028;
      g.flares.push({
        id: g.nextFlareId++,
        x: originX,
        y: originY + rand(-8, 8),
        vx,
        vy: vyFn(vx),
        anchorX,
        drag: 0.988,
        life: 220,
        maxLife: 220,
        alive: true,
        luresLeft: lvl,
        hotRadius: 22 + rand(-2, 4),
        trail: [],
      });
    }
  }
}

export function updateAutoSystems(
  g: GameState,
  dt: number,
  allThreats: Threat[],
  onEvent?: ((type: string, data?: unknown) => void) | null,
) {
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
      const hornetSite = getDefenseSitePlacement("wildHornets");
      const targets = pickHornetLaunchTargets(allThreats, g.hornets, lvl, count);
      for (let i = 0; i < targets.length; i++) {
        g.hornets.push({
          x: (hornetSite?.x ?? 206) + rand(-12, 12),
          y: (hornetSite?.y ?? GROUND_Y) - 20,
          targetRef: targets[i],
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
  g.hornets.forEach((h: Hornet) => {
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
    const hTarget = h.targetRef!;
    const dx = hTarget.x - h.x;
    const dy = hTarget.y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 12) {
      h.alive = false;
      boom(g, hTarget.x, hTarget.y, h.blastRadius, COL.hornet, false, onEvent, h.blastRadius * 0.5);
      return;
    }
    h.trail.push({ x: h.x, y: h.y });
    if (h.trail.length > 12) h.trail.shift();
    // Lead the target slightly
    const hLeadFrames = d / h.speed;
    const hlx = hTarget.x + (hTarget.vx || 0) * hLeadFrames * 0.3;
    const hly = hTarget.y + (hTarget.vy || 0) * hLeadFrames * 0.3;
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
      const roadrunnerSite = getDefenseSitePlacement("roadrunner");
      for (let i = 0; i < targets.length; i++) {
        g.roadrunners.push({
          x: (roadrunnerSite?.x ?? 678) + rand(-15, 15),
          y: (roadrunnerSite?.y ?? GROUND_Y) - 10,
          targetRef: targets[i],
          speed: rrSpeed,
          trail: [],
          alive: true,
          phase: "launch",
          launchY: (roadrunnerSite?.y ?? GROUND_Y) - 70 - rand(0, 40),
          heading: -Math.PI / 2,
          blastRadius: rrBlastR,
          turnRate: rrTurnRate,
          life: 600,
        });
      }
    }
  }
  // Roadrunner in-flight update — always runs so missiles don't freeze when site is destroyed
  g.roadrunners.forEach((r: Roadrunner) => {
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
      if (r.y <= (r.launchY ?? -Infinity)) r.phase = "track";
    } else {
      const t = r.targetRef;
      if (!t || !t.alive) {
        const newT = pickRoadrunnerTargets(
          allThreats,
          g.roadrunners.filter((other: Roadrunner) => other !== r),
          1,
        )[0];
        if (newT) r.targetRef = newT;
        else {
          r.alive = false;
          return;
        }
      }
      const rTarget = r.targetRef!;
      const dx = rTarget.x - r.x;
      const dy = rTarget.y - r.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 15) {
        r.alive = false;
        boom(g, rTarget.x, rTarget.y, r.blastRadius, COL.roadrunner, false, onEvent, 15);
        return;
      }
      // Lead the target slightly
      const leadFrames = d / r.speed;
      const lx = rTarget.x + (rTarget.vx || 0) * leadFrames * 0.3;
      const ly = rTarget.y + (rTarget.vy || 0) * leadFrames * 0.3;
      const desiredHeading = Math.atan2(ly - r.y, lx - r.x);
      const headingDelta = normalizeAngle(desiredHeading - r.heading);
      const maxTurn = (r.turnRate ?? 0.08) * dt;
      const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
      r.heading = normalizeAngle(r.heading + appliedTurn);
      r.x += Math.cos(r.heading) * r.speed * dt;
      r.y += Math.sin(r.heading) * r.speed * dt;
      if (r.y >= GAMEPLAY_WATERLINE_Y) {
        r.alive = false;
        boom(g, r.x, GAMEPLAY_WATERLINE_Y, r.blastRadius, COL.roadrunner, false, onEvent, 15);
        return;
      }
    }
  });
  g.roadrunners = g.roadrunners.filter((r) => r.alive);

  // ── DECOY FLARES ──
  if (g.upgrades.flare > 0) {
    const lvl = g.upgrades.flare;
    const lureRange = [145, 165, 185][lvl - 1];
    // Launch new burst only while site is alive
    if (isSiteAlive(g, "flare")) {
      const interval = [240, 180, 120][lvl - 1];
      const flareFocusY = GROUND_Y - BURJ_H - 30;
      const activationRange = ov("upgrade.flareActivationRange", 320);
      const hasThreats =
        g.missiles.some((m) => isFlareMissileTarget(m) && dist(m.x, m.y, BURJ_X, flareFocusY) < activationRange) ||
        g.drones.some((d) => d.alive && !d.luredByFlare && dist(d.x, d.y, BURJ_X, flareFocusY) < activationRange);
      g.flareTimer += dt;
      if (g.flareTimer >= interval && hasThreats) {
        g.flareTimer = 0;
        launchFlareBurst(g, lvl);
      }
    }
    // Update and expire in-flight flares regardless of site status
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
        d.flareTargetId = nearFlare.id;
        d.lureDeathTimer = 200;
        // Initial redirect toward flare
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
    const range = [219, 280, 368][lvl - 1];
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
  g.laserBeams.forEach((b) => {
    if (b.life !== undefined) b.life -= dt;
  });
  g.laserBeams = g.laserBeams.filter((b) => (b.life ?? 0) > 0);
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
            alive: true,
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
    b.cx = b.x + ((b.tx ?? b.x) - b.x) * progress;
    b.cy = b.y + ((b.ty ?? b.y) - b.y) * progress;
    if (b.life <= 0 && b.hit && b.targetRef?.alive) {
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
      const targets = pickPatriotTargets(allThreats, g.patriotMissiles, count);
      const patriotSite = getDefenseSitePlacement("patriot");
      for (let i = 0; i < targets.length; i++) {
        g.patriotMissiles.push({
          x: (patriotSite?.x ?? 334) + rand(-10, 10),
          y: (patriotSite?.y ?? GROUND_Y) - 3,
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
  g.patriotMissiles.forEach((p: PatriotMissile) => {
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
      const candidates = pickPatriotTargets(
        allThreats,
        g.patriotMissiles.filter((other: PatriotMissile) => other !== p),
        1,
      );
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
    p.wobble = (p.wobble ?? 0) + 0.12 * dt;
    const pTarget = p.targetRef!;
    const dx = pTarget.x - p.x;
    const dy = pTarget.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 15) {
      p.alive = false;
      boom(g, pTarget.x, pTarget.y, p.blastRadius, COL.patriot, false, onEvent, p.blastRadius * 0.4);
      return;
    }
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 18) p.trail.shift();
    // Lead the target
    const pLeadFrames = d / p.speed;
    const plx = pTarget.x + (pTarget.vx || 0) * pLeadFrames * 0.4;
    const ply = pTarget.y + (pTarget.vy || 0) * pLeadFrames * 0.4;
    const pld = Math.sqrt((plx - p.x) ** 2 + (ply - p.y) ** 2) || 1;
    p.x += (((plx - p.x) / pld) * p.speed + Math.sin(p.wobble) * 0.6) * dt;
    p.y += (((ply - p.y) / pld) * p.speed + Math.cos(p.wobble) * 0.4) * dt;
  });
  g.patriotMissiles = g.patriotMissiles.filter((p) => p.alive);

  // ── EMP SHOCKWAVE ── (charging is handled in update() before waveComplete check)
  if (g.empRings.length > 0) {
    // Update active rings
    g.empRings.forEach((ring) => {
      ring.radius += 10 * dt;
      if (ring.radius > ring.maxRadius) {
        ring.alive = false;
        return;
      }
      ring.alpha = 1 - ring.radius / ring.maxRadius;
      // Damage threats in the ring band
      const bandInner = ring.radius - 15;
      const bandOuter = ring.radius + 15;
      allThreats.forEach((t) => {
        if (!t.alive || ring.hitSet?.has(t)) return;
        const d = dist(t.x, t.y, ring.x, ring.y);
        if (d >= bandInner && d <= bandOuter) {
          ring.hitSet?.add(t);
          damageTarget(g, t, ring.damage ?? 1, COL.emp, 20, { noExplosion: true });
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

function updateMissiles(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
  g.missiles.forEach((m: Missile) => {
    if (!m.alive) return;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 21) m.trail.shift();
    if (m.accel) {
      m.vx *= m.accel ** dt;
      m.vy *= m.accel ** dt;
    }
    if (m.luredByFlare) {
      const flareTarget = getLiveFlare(g, m.flareTargetId);
      if (flareTarget) {
        const lureDist = steerTowardPoint(m, flareTarget.x, flareTarget.y, dt, 0.2);
        if (lureDist <= flareTarget.hotRadius) {
          m.alive = false;
          g.stats.missileKills = (g.stats.missileKills || 0) + 1;
          detonateFlare(g, flareTarget, onEvent);
          return;
        }
      } else {
        // Flare already exploded — missile lost guidance, harmless self-destruct
        m.alive = false;
        g.stats.missileKills = (g.stats.missileKills || 0) + 1;
        boom(g, m.x, m.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
        return;
      }
    }
    const mSlow = (m.empSlowTimer ?? 0) > 0 ? ((m.empSlowTimer = (m.empSlowTimer ?? 0) - dt), 0.4) : 1;
    const stepX = m.vx * dt * mSlow;
    const stepY = m.vy * dt * mSlow;
    m.x += stepX;
    m.y += stepY;
    if (m.type === "stack2" || m.type === "stack3") {
      m.travelDist = (m.travelDist ?? 0) + Math.sqrt(stepX * stepX + stepY * stepY);
    }
    if (m.luredByFlare) {
      const flareTarget = getLiveFlare(g, m.flareTargetId);
      if (flareTarget && dist(m.x, m.y, flareTarget.x, flareTarget.y) <= flareTarget.hotRadius) {
        m.alive = false;
        g.stats.missileKills = (g.stats.missileKills || 0) + 1;
        detonateFlare(g, flareTarget, onEvent);
        return;
      }
    }
    // MIRV split
    if (m.type === "mirv" && !m.splitTriggered && m.y >= (m.splitY ?? Infinity)) {
      m.splitTriggered = true;
      m.alive = false;
      for (let i = 0; i < (m.warheadCount ?? 0); i++) {
        const t = pickTarget(g, m.x);
        if (!t) continue;
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const spd = (rand(0.8, 1.2) + g.wave * 0.06) * 1;
        g.missiles.push({
          x: m.x + rand(-20, 20),
          y: m.y + rand(-10, 10),
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
    if (
      (m.type === "stack2" || m.type === "stack3") &&
      !m.splitTriggered &&
      (m.travelDist ?? 0) >= (m.splitAfterDist ?? Infinity)
    ) {
      m.splitTriggered = true;
      const totalCount = m.type === "stack3" ? 3 : 2;
      const extraTargets = pickSplitTargetsWide(g, totalCount - 1, m.targetX ?? m.x);
      const baseSpeed = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      m.type = "stack_child";
      m.trail = [];
      for (let i = 0; i < extraTargets.length; i++) {
        const t = extraTargets[i];
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        const offsetMag = (i - (extraTargets.length - 1) / 2) * 8;
        const nx = -dy / len;
        const ny = dx / len;
        g.missiles.push({
          x: m.x + nx * offsetMag,
          y: m.y + ny * offsetMag,
          vx: (dx / len) * baseSpeed,
          vy: (dy / len) * baseSpeed,
          accel: m.accel,
          trail: [],
          alive: true,
          type: "stack_child",
          targetX: t.x,
          targetY: t.y,
          empSlowTimer: 0,
          _hitByExplosions: new Set(),
        });
      }
      boom(g, m.x, m.y, 18, "#ffb36b", false, onEvent, 0, { harmless: true });
      if (onEvent) onEvent("sfx", { name: "mirvSplit" });
    }
    const burjTop = getGameplayBurjCollisionTop(2);
    // Burj collision — hitbox matches the shared scenic Burj placement
    if (
      g.burjAlive &&
      m.alive &&
      m.y >= burjTop &&
      m.y <= GAMEPLAY_SCENIC_THREAT_FLOOR_Y &&
      Math.abs(m.x - BURJ_X) <= getGameplayBurjHalfW(m.y, 2)
    ) {
      m.alive = false;
      boom(g, m.x, m.y, 55, "#ff4400", false, onEvent, 30);
      g.shakeTimer = 10;
      g.shakeIntensity = 4;
      if (!g._debugMode) {
        addBurjImpactDamage(g, m.x, m.y, "missile");
        g.burjHealth--;
        if (onEvent) onEvent("sfx", { name: "burjHit" });
        if (g.burjHealth <= 0) {
          g.burjAlive = false;
          boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 90, "#ff2200", false, onEvent, 50);
        }
      }
    }
    // Building collisions — match the shared title-style tower geometry
    if (m.alive) {
      g.buildings.forEach((b) => {
        if (!b.alive || !m.alive) return;
        const bounds = getGameplayBuildingBounds(b);
        if (m.x >= bounds.left && m.x <= bounds.right && m.y >= bounds.top && m.y <= bounds.bottom) {
          m.alive = false;
          boom(g, m.x, m.y, 40, "#ff4400", false, onEvent, 20);
          b.alive = false;
          addBuildingDestroyFx(g, b);
        }
      });
    }
    // Defense site collisions
    if (m.alive) {
      g.defenseSites.forEach((site) => {
        if (
          site.alive &&
          m.alive &&
          Math.abs(m.x - site.x) < (site.hw ?? 0) &&
          Math.abs(m.y - site.y) < (site.hh ?? 0)
        ) {
          m.alive = false;
          destroyDefenseSite(g, site);
          boom(g, m.x, m.y, 60, "#ff4400", false, onEvent, 30);
          g.shakeTimer = 12;
          g.shakeIntensity = 5;
        }
      });
    }
    // Launcher collision — use the scenic launcher anchor
    if (m.alive) {
      LAUNCHERS.forEach((_, i) => {
        const l = getGameplayLauncherPosition(i);
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
    if (m.alive && m.y >= GAMEPLAY_WATERLINE_Y) {
      m.alive = false;
      boom(g, m.x, GAMEPLAY_WATERLINE_Y, 50, "#ff4400", false, onEvent, 25);
    }
    if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
  });
}

function updateDrones(
  g: GameState,
  _rng: () => number,
  dt: number,
  onEvent?: ((type: string, data?: unknown) => void) | null,
) {
  g.drones.forEach((d: Drone) => {
    if (!d.alive) return;
    d.trail ??= [];
    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > (d.subtype === "shahed238" ? 13 : 10)) d.trail.shift();
    // Lured drones steer toward flare and detonate it on contact
    if (d.luredByFlare) {
      const flareTarget = getLiveFlare(g, d.flareTargetId);
      if (flareTarget) {
        steerTowardPoint(d, flareTarget.x, flareTarget.y, dt, 0.15);
        if (dist(d.x, d.y, flareTarget.x, flareTarget.y) <= flareTarget.hotRadius) {
          d.alive = false;
          g.stats.droneKills = (g.stats.droneKills || 0) + 1;
          detonateFlare(g, flareTarget, onEvent);
          return;
        }
      } else {
        // Flare already exploded — lost guidance, harmless self-destruct
        d.alive = false;
        g.stats.droneKills = (g.stats.droneKills || 0) + 1;
        boom(g, d.x, d.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
        return;
      }
      if ((d.lureDeathTimer ?? 0) > 0) {
        d.lureDeathTimer = (d.lureDeathTimer ?? 0) - dt;
        if ((d.lureDeathTimer ?? 0) <= 0) {
          d.alive = false;
          g.stats.droneKills = (g.stats.droneKills || 0) + 1;
          boom(g, d.x, d.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
          return;
        }
      }
    }
    if ((d.empSlowTimer ?? 0) > 0) d.empSlowTimer = (d.empSlowTimer ?? 0) - dt;
    const dSlow = (d.empSlowTimer ?? 0) > 0 ? 0.4 : 1;
    d.wobble += 0.05 * dt;
    if (d.waypoints && d.waypoints.length >= 2) {
      // Follow precomputed trajectory (skip when lured by flare)
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
      const pathSpeed = d.subtype === "shahed136" && (d.pathIndex ?? 0) >= (d.diveStartIndex ?? Infinity) ? 1.18 : 1;
      d.pathIndex = Math.min((d.pathIndex ?? 0) + dt * dSlow * pathSpeed, d.waypoints.length - 1);
      const i0 = Math.floor(d.pathIndex);
      const frac = d.pathIndex - i0;
      const i1 = Math.min(i0 + 1, d.waypoints.length - 1);
      d.x = d.waypoints[i0].x + (d.waypoints[i1].x - d.waypoints[i0].x) * frac;
      d.y = d.waypoints[i0].y + (d.waypoints[i1].y - d.waypoints[i0].y) * frac;
      d.vx = d.x - prevX;
      d.vy = d.y - prevY;
      if (!d.diving && d.pathIndex >= (d.diveStartIndex ?? Infinity)) d.diving = true;
      // Drop bombs at precomputed path positions
      if (
        (d.bombsDropped ?? 0) < (d.bombIndices?.length ?? 0) &&
        d.pathIndex >= (d.bombIndices ?? [])[d.bombsDropped ?? 0]
      ) {
        const bombT = pickTarget(g, d.x);
        if (bombT) {
          g.missiles.push({
            x: d.x,
            y: d.y,
            vx: (bombT.x - d.x) * 0.004,
            vy: rand(2.4, 4.0),
            accel: 1,
            trail: [],
            alive: true,
            type: "bomb",
            _hitByExplosions: new Set(),
          });
        }
        d.bombsDropped = (d.bombsDropped ?? 0) + 1;
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
                accel: 1,
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
        const dx = d.diveTarget!.x - d.x;
        const dy = d.diveTarget!.y - d.y;
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
    const burjTop = getGameplayBurjCollisionTop(2);
    // Burj body collision — match the shared scenic Burj placement
    if (
      d.alive &&
      g.burjAlive &&
      d.y >= burjTop &&
      d.y <= GAMEPLAY_SCENIC_THREAT_FLOOR_Y &&
      Math.abs(d.x - BURJ_X) <= getGameplayBurjHalfW(d.y, 2)
    ) {
      d.alive = false;
      boom(g, d.x, d.y, 70, "#ff6600", false, onEvent, 40);
      g.shakeTimer = 15;
      g.shakeIntensity = 6;
      if (!g._debugMode) {
        addBurjImpactDamage(g, d.x, d.y, "drone");
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
      const hitGround = d.y >= GAMEPLAY_WATERLINE_Y;
      const pathDone = d.waypoints && (d.pathIndex ?? 0) >= d.waypoints.length - 1;
      if (hitTarget || hitGround || pathDone) {
        const impactY = hitTarget ? d.y : Math.min(d.y, GAMEPLAY_WATERLINE_Y);
        d.alive = false;
        boom(g, d.x, impactY, 70, "#ff6600", false, onEvent, 40);
        g.shakeTimer = 15;
        g.shakeIntensity = 6;
        g.buildings.forEach((b) => {
          const bounds = getGameplayBuildingBounds(b);
          if (b.alive && d.x >= bounds.left - 30 && d.x <= bounds.right + 30 && d.y >= bounds.top - 20) {
            b.alive = false;
            addBuildingDestroyFx(g, b);
          }
        });
        g.defenseSites.forEach((site) => {
          if (
            site.alive &&
            Math.abs(d.x - site.x) < (site.hw ?? 0) + 20 &&
            Math.abs(d.y - site.y) < (site.hh ?? 0) + 20
          ) {
            destroyDefenseSite(g, site);
          }
        });
        LAUNCHERS.forEach((_, i) => {
          const l = getGameplayLauncherPosition(i);
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

function updateInterceptors(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
  g.interceptors.forEach((ic: Interceptor) => {
    if (!ic.alive) return;
    ic.trail.push({ x: ic.x, y: ic.y });
    if (ic.trail.length > 15) ic.trail.shift();
    if (!ic.fromF15 && typeof ic.heading === "number") {
      const desiredHeading = Math.atan2(ic.targetY - ic.y, ic.targetX - ic.x);
      const headingDelta = wrapAngle(desiredHeading - ic.heading);
      const maxTurn = (ic.turnRate || 0.22) * dt;
      ic.heading += Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
      if (ic.accel) {
        ic.speed = Math.min(ic.maxSpeed ?? ic.speed ?? 0, (ic.speed ?? 0) * ic.accel ** dt);
      }
      ic.vx = Math.cos(ic.heading) * (ic.speed ?? 0);
      ic.vy = Math.sin(ic.heading) * (ic.speed ?? 0);
    }
    ic.x += ic.vx * dt;
    ic.y += ic.vy * dt;
    let detonate = false;
    // Scale proximity thresholds with speed so fast interceptors don't skip past targets
    const detonateRadius = 40;
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
        boom(g, ic.x, ic.y, 60, COL.interceptor, true, onEvent, 60);
      }
    }
    if (ic.fromF15 && (ic.x < -50 || ic.x > CANVAS_W + 50 || ic.y < -50 || ic.y > CANVAS_H + 50)) ic.alive = false;
  });
}

function updateExplosions(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
  g.explosions.forEach((ex) => {
    if (ex.growing) {
      ex.radius += (ex.chain ? 4 + (ex.chainLevel ?? 0) * 0.85 : 2) * dt;
      if (ex.radius >= ex.maxRadius) ex.growing = false;
    } else ex.alpha -= 0.05 * dt;
    if (ex.ringAlpha > 0) {
      ex.ringRadius += (14 + (ex.chainLevel ?? 0) * 2.8 + (ex.heroPulse ?? 0) * 1.8) * dt;
      ex.ringAlpha -= (0.25 + (ex.chainLevel ?? 0) * 0.02) * dt;
    }
    if ((ex.heroPulse ?? 0) > 0) ex.heroPulse = Math.max(0, (ex.heroPulse ?? 0) - 0.06 * dt);
    if ((ex.linkAlpha ?? 0) > 0) ex.linkAlpha = Math.max(0, (ex.linkAlpha ?? 0) - 0.09 * dt);
    if (ex.alpha > 0.2 && !ex.harmless) {
      if (!ex.kills) ex.kills = 0;
      // For chain explosions, find the root explosion to aggregate kills
      const rootEx = ex.rootExplosionId != null ? g.explosions.find((e) => e.id === ex.rootExplosionId) || ex : ex;
      g.missiles.forEach((m) => {
        if (!m.alive) return;
        if (m.type === "mirv") {
          if (m._hitByExplosions?.has(ex.id)) return;
          if (dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
            m._hitByExplosions?.add(ex.id);
            m.health = (m.health ?? 1) - 1;
            if ((m.health ?? 0) <= 0) {
              m.alive = false;
              g.score += getKillReward(m) * g.combo;
              g.stats.missileKills++;
              rootEx.kills = (rootEx.kills ?? 0) + 1;
              rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
              boom(g, m.x, m.y, 45, COL.mirv, ex.playerCaused, onEvent, 45, {
                chain: true,
                chainLevel: (ex.chainLevel ?? 0) + 1,
                rootExplosionId: rootEx.id,
                linkFromX: ex.x,
                linkFromY: ex.y,
                linkAlpha: 1,
                visualType: "missile",
              });
            }
          }
        } else if (dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
          m.alive = false;
          g.score += getKillReward(m) * g.combo;
          g.stats.missileKills++;
          rootEx.kills = (rootEx.kills ?? 0) + 1;
          rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
          boom(g, m.x, m.y, 45, "#ffcc00", ex.playerCaused, onEvent, 45, {
            chain: true,
            chainLevel: (ex.chainLevel ?? 0) + 1,
            rootExplosionId: rootEx.id,
            linkFromX: ex.x,
            linkFromY: ex.y,
            linkAlpha: 1,
            visualType: "missile",
          });
        }
      });
      g.drones.forEach((d) => {
        if (!d.alive) return;
        if (dist(d.x, d.y, ex.x, ex.y) < ex.radius + d.collisionRadius) {
          d.health--;
          if (d.health <= 0) {
            d.alive = false;
            g.score += getKillReward(d) * g.combo;
            g.stats.droneKills++;
            rootEx.kills = (rootEx.kills ?? 0) + 1;
            rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
            boom(g, d.x, d.y, 45, "#ff8800", ex.playerCaused, onEvent, 45, {
              chain: true,
              chainLevel: (ex.chainLevel ?? 0) + 1,
              rootExplosionId: rootEx.id,
              linkFromX: ex.x,
              linkFromY: ex.y,
              linkAlpha: 1,
              visualType: "drone",
            });
          }
        }
      });
      // Multi-kill bonus (only check on root explosions)
      if (rootEx === ex && (ex.kills ?? 0) >= 2 && !ex.bonusAwarded) {
        ex.bonusAwarded = true;
        const bonus = getMultiKillBonus(ex.kills ?? 0);
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.score += bonus;
        g.multiKillToast = { label, bonus, kills: ex.kills, x: ex.x, y: ex.y, timer: 90, pulse: 1 };
        ex.heroPulse = Math.max(ex.heroPulse ?? 0, 1.2);
        g.shakeTimer = Math.max(g.shakeTimer, 10 + (ex.kills ?? 0) * 2);
        g.shakeIntensity = Math.max(g.shakeIntensity, 4 + (ex.kills ?? 0));
        if (onEvent) onEvent("sfx", { name: "multiKill" });
      }
    }
    // Check again at end of frame — explosion may have gotten more kills while still growing
    if (ex.bonusAwarded && (ex.kills ?? 0) > (ex._lastBonusKills || 0)) {
      const prevKills = ex._lastBonusKills || 2;
      if ((ex.kills ?? 0) > prevKills) {
        const oldBonus = getMultiKillBonus(prevKills);
        const newBonus = getMultiKillBonus(ex.kills ?? 0);
        g.score += newBonus - oldBonus;
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.multiKillToast = { label, bonus: newBonus, kills: ex.kills, x: ex.x, y: ex.y, timer: 90, pulse: 1 };
        ex.heroPulse = Math.max(ex.heroPulse ?? 0, 1.25);
        g.shakeTimer = Math.max(g.shakeTimer, 10 + (ex.kills ?? 0) * 2);
        g.shakeIntensity = Math.max(g.shakeIntensity, 4 + (ex.kills ?? 0));
        if (onEvent) onEvent("sfx", { name: "multiKill" });
      }
    }
    if (ex.kills) ex._lastBonusKills = ex.kills;
  });
}

function updatePlanes(
  g: GameState,
  dt: number,
  allThreats: Threat[],
  onEvent?: ((type: string, data?: unknown) => void) | null,
) {
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
      let closest: Threat | null = null,
        closestD = 350;
      allThreats.forEach((t) => {
        const d2 = dist(p.x, p.y, t.x, t.y);
        if (d2 < closestD) {
          closestD = d2;
          closest = t;
        }
      });
      if (closest) {
        const closestT = closest as Threat;
        p.fireTimer = 0;
        const spd = 44;
        let aimX = closestT.x,
          aimY = closestT.y;
        const accelFactor = (closestT as Missile).accel ? (closestT as Missile).accel ** 8 : 1;
        for (let i = 0; i < 6; i++) {
          const d = Math.sqrt((aimX - p.x) ** 2 + (aimY - p.y) ** 2);
          const frames = d / spd;
          aimX = closestT.x + (closestT.vx || 0) * accelFactor * frames;
          aimY = closestT.y + (closestT.vy || 0) * accelFactor * frames;
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

export function update(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
  const _rng = getRng();
  g.time += dt;
  if (g.shakeTimer > 0) g.shakeTimer -= dt;
  if ((g.waveClearedTimer ?? 0) > 0) g.waveClearedTimer = (g.waveClearedTimer ?? 0) - dt;
  if (g.multiKillToast && g.multiKillToast.timer > 0) {
    g.multiKillToast.timer -= dt;
    if ((g.multiKillToast.pulse ?? 0) > 0) {
      g.multiKillToast.pulse = Math.max(0, (g.multiKillToast.pulse ?? 0) - 0.08 * dt);
    }
    if (g.multiKillToast.timer <= 0) g.multiKillToast = null;
  }
  if (g.comboToast) {
    g.comboToast.timer -= dt;
    g.comboToast.pulse = Math.max(0, g.comboToast.pulse - 0.06 * dt);
    if (g.comboToast.timer <= 0) g.comboToast = null;
  }
  updateBurjDamageFx(g);
  updateBuildingDestroyFx(g, dt);

  // Game over — Burj destroyed
  if (!g.burjAlive && !g.gameOverTimer) {
    g.gameOverTimer = 60;
    if (g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
    if (onEvent) onEvent("sfx", { name: "gameOver" });
  }
  if ((g.gameOverTimer ?? 0) > 0) {
    g.gameOverTimer = (g.gameOverTimer ?? 0) - dt;
    if ((g.gameOverTimer ?? 0) <= 0) {
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
    if ((g.waveClearedTimer ?? 0) <= 0) {
      // Emit bonus screen event once, then wait for it to finish before opening shop
      if (!g._bonusScreenStarted) {
        g._bonusScreenStarted = true;
        if (g.burjAlive && onEvent) {
          onEvent("waveBonusStart", {
            wave: g.wave,
            buildings: g.buildings.filter((b) => b.alive).length,
            savedAmmo: 0,
            missileKills: g.stats.missileKills - (g._waveStartMissileKills ?? 0),
            droneKills: g.stats.droneKills - (g._waveStartDroneKills ?? 0),
          });
        } else {
          g._bonusScreenDone = true;
        }
      }
      if (!g.shopOpened && g._bonusScreenDone) {
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
    const gs = gameState as GameState;
    if (type === "missile") spawnMissile(gs, overrides);
    else if (type === "stack2") spawnStackedMissile(gs, 2, overrides);
    else if (type === "stack3") spawnStackedMissile(gs, 3, overrides);
    else if (type === "drone136") spawnDroneOfType(gs, "shahed136", overrides);
    else if (type === "drone238") spawnDroneOfType(gs, "shahed238", overrides);
    else if (type === "mirv") spawnMirv(gs, onEvent);
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
    if (p.angle !== undefined) p.angle += (p.spin ?? 0) * dt;
    p.life -= dt;
  });

  // Combo: check dying player-caused root explosions
  g.explosions.forEach((ex) => {
    if (ex.alpha <= 0 && ex.playerCaused && ex.rootExplosionId === null) {
      if ((ex.kills ?? 0) >= 1) {
        const next = Math.min(10, g.combo + 1);
        if (next > g.combo) {
          g.comboToast = { multiplier: next, timer: 70, x: ex.x, y: ex.y - 20, pulse: 1 };
        }
        g.combo = next;
      } else {
        g.combo = 1;
      }
    }
  });

  // Cleanup
  g.missiles = g.missiles.filter((m) => m.alive);
  g.drones = g.drones.filter((d) => d.alive);
  g.interceptors = g.interceptors.filter((ic) => ic.alive);
  g.explosions = g.explosions.filter((ex) => ex.alpha > 0);
  g.particles = g.particles.filter((p) => p.life > 0);
  g.planes = g.planes.filter((p) => p.alive);
}

export function fireEmp(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
  if (!g.empReady || g.upgrades.emp <= 0) return false;
  const lvl = g.upgrades.emp;
  g.empCharge = 0;
  g.empReady = false;
  g.empRings.push({
    x: 462,
    y: 1047,
    radius: 0,
    maxRadius: [650, 1040, 1430][lvl - 1],
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

// ── RENDER INTERPOLATION ──
// Snapshot previous positions before each sim tick. The renderer reads these
// snapshots with the current state and interpolates without mutating sim state.

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

export function snapshotPositions(g: GameState) {
  const gAny = g as unknown as Record<string, Array<{ x: number; y: number; _px?: number; _py?: number }>>;
  for (const key of LERP_ARRAYS_XY) {
    const arr = gAny[key];
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

export function createGameSim(options: { onEvent?: ((type: string, data?: unknown) => void) | null } = {}) {
  const onEvent = options.onEvent || (() => {});
  return {
    initGame,
    update: (g: GameState, dt: number) => update(g, dt, onEvent),
    buyUpgrade,
    closeShop,
    spawnMissile,
    spawnDrone,
    spawnDroneOfType,
    spawnPlane: (g: GameState) => spawnPlane(g, onEvent),
    updateAutoSystems: (g: GameState, dt: number, threats: Threat[]) => updateAutoSystems(g, dt, threats, onEvent),
  };
}

export { buyUpgrade, buyDraftUpgrade, closeShop, draftPick3, repairLauncher, repairSite } from "./game-sim-shop.js";
