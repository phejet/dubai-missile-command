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
  applyShake,
  getShahed136LevelFlightYRange,
  getGameplayLauncherPosition,
  dist,
  rand,
  randInt,
  pickTarget,
  pickBuildingTarget,
  createExplosion,
  destroyDefenseSite,
  getPhalanxTurrets,
  damageTarget,
  createEmptyGameStats,
  cloneDestroyedByTypeStats,
  getDestroyedByTypeDelta,
  normalizeGameStats,
  recordThreatDestroyed,
  getKillReward,
  getMultiKillBonus,
  getRng,
  computeShahed136Path,
  computeShahed136StraightPath,
  computeShahed238Path,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  INTERCEPTOR_TAP_FUSE_RADIUS,
  IRON_BEAM_EMITTER_Y,
  IRON_BEAM_RANGE,
  IRON_BEAM_CHARGE_TIME,
  IRON_BEAM_FIRE_WINDOW,
  hitsBurjBody,
  isBurjDiveTarget,
  isBurjImpactTarget,
  predictBurjImpactTicks,
  syncFireChargeForTick,
} from "./game-logic";
import { createCommander, generateWaveSchedule, advanceSpawnSchedule, isWaveFullySpawned } from "./wave-spawner";
import { createEmptyUpgradeLevels, createEmptyUpgradeProgression } from "./game-sim-upgrades";
import {
  buyUpgrade,
  closeShop,
  draftPick3,
  getActiveHornetSiteKeys,
  HORNET_SITE_CAPACITY,
  syncHornetSitesForOwnership,
} from "./game-sim-shop";
import { createFireChargeState } from "./player-fire-limiter";
import type {
  GameState,
  Threat,
  Missile,
  Drone,
  BurjDamageKind,
  Interceptor,
  Hornet,
  HornetSiteKey,
  Roadrunner,
  SpawnEntry,
  Shahed136Variant,
  SimEventSink,
} from "./types";
import { shahed136HasBomb, shahed136HasDive } from "./types";
import { updateBurjFireParticles } from "./game-sim-burj-fire";
import { empScrubScale, fireEmp, updateEmpRings, updateEmpVisualFx } from "./game-sim-emp";
import { fireFlareSalvo, updateFlares } from "./game-sim-flare";
import { updatePatriotSystem } from "./game-sim-patriot";

export { updateBurjFireParticles };
export { fireEmp };
export { fireFlareSalvo };

function boom(
  g: GameState,
  x: number,
  y: number,
  radius: number,
  color: string,
  playerCaused: boolean,
  onEvent: SimEventSink | null | undefined,
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

function isThreatDoomedByActiveExplosion(g: GameState, target: Threat): boolean {
  for (const ex of g.explosions) {
    if (ex.harmless || ex.alpha <= 0.2) continue;
    if (target.type === "drone") {
      if (dist(target.x, target.y, ex.x, ex.y) < ex.radius + target.collisionRadius) {
        return target.health <= 1;
      }
    } else if (dist(target.x, target.y, ex.x, ex.y) < ex.radius) {
      if (target.type === "mirv") {
        if (target._hitByExplosions?.has(ex.id)) continue;
        return (target.health ?? 1) <= 1;
      }
      return true;
    }
  }
  return false;
}

const BURJ_INVULN_TICKS = 30;

function addBurjImpactDamage(g: GameState, x: number, y: number, kind: BurjDamageKind) {
  const jitterX = rand(-3, 3);
  const jitterY = rand(-8, 8);
  const hitX = x + jitterX * 0.65;
  const hitY = y + jitterY * 0.65;
  g.burjDecals.push({
    id: g.nextBurjDecalId++,
    x: x + jitterX,
    y: y + jitterY,
    kind,
    rotation: rand(-0.45, 0.45),
    scale: rand(0.82, 1.14),
  });
  g.burjDamageFx.push({
    id: g.nextBurjDamageFxId++,
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

function applyBurjHitDamage(
  g: GameState,
  x: number,
  y: number,
  kind: BurjDamageKind,
  onEvent?: SimEventSink | null,
): void {
  if (g._debugMode || !g.burjAlive) return;
  if (g.burjInvulnTimer > 0) return;
  addBurjImpactDamage(g, x, y, kind);
  g.burjHealth = Math.max(0, g.burjHealth - 1);
  g.burjInvulnTimer = BURJ_INVULN_TICKS;
  if (onEvent) onEvent("sfx", { name: "burjHit" });
  if (g.burjHealth > 0) {
    // Survived the hit — impact-point blast, game continues. Game over only at 0 HP.
    boom(g, x, y, 60, "#ff5500", false, onEvent, 30);
    return;
  }
  g.burjAlive = false;
  boom(g, BURJ_X, CITY_Y - BURJ_H / 2, 90, "#ff2200", false, onEvent, 50);
  if (!g.gameOverTimer) {
    g.gameOverTimer = 60;
    if (g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
    if (onEvent) onEvent("sfx", { name: "gameOver" });
  }
}

function updateBurjDamageFx(g: GameState): void {
  if (g.burjHitFlashTimer > 0) g.burjHitFlashTimer--;
  if (g.burjInvulnTimer > 0) g.burjInvulnTimer--;
}

function addBuildingDestroyFx(g: GameState, building: { x: number; w: number; h: number }) {
  g.buildingDestroyFx.push({
    id: g.nextBuildingDestroyFxId++,
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
    stats: createEmptyGameStats(),
    ammo: [11, 11],
    launcherHP: [1, 1],
    fireChargeState: createFireChargeState(),
    launcherFireTick: [0, 0],
    missiles: [],
    drones: [],
    interceptors: [],
    explosions: [],
    particles: [],
    planes: [],
    buildings: allBuildings,
    buildingDestroyFx: [],
    burjAlive: true,
    burjHealth: 7,
    burjDecals: [],
    burjDamageFx: [],
    burjHitFlashTimer: 0,
    burjHitFlashMax: 0,
    burjHitFlashX: BURJ_X,
    burjHitFlashY: GROUND_Y - BURJ_H * 0.45,
    burjInvulnTimer: 0,
    stars: Array.from({ length: 120 }, () => ({
      x: rand(0, CANVAS_W),
      y: rand(0, CANVAS_H * 0.6),
      size: rand(0.5, 2),
      twinkle: rand(0, Math.PI * 2),
    })),
    waveComplete: false,
    crosshairX: CANVAS_W / 2,
    crosshairY: CANVAS_H / 2,
    time: 0,
    shakeTimer: 0,
    shakeIntensity: 0,
    shakePeakTimer: 0,
    upgrades: createEmptyUpgradeLevels(),
    ownedUpgradeNodes: new Set(),
    metaProgression: createEmptyUpgradeProgression(),
    defenseSites: [],
    hornets: [],
    roadrunners: [],
    laserBeams: [],
    phalanxBullets: [],
    patriotMissiles: [],
    patriotLaunchQueue: [],
    flares: [],
    hornetSites: [],
    roadrunnerAmmo: 0,
    roadrunnerReloadTimer: 0,
    roadrunnerLaunchCooldown: 0,
    ironBeamTimer: 360,
    phalanxTimer: 5,
    patriotTimer: 480,
    patriotReserveShots: 0,
    patriotHoldTimer: 0,
    patriotFollowupTimer: 0,
    nextFlareId: 1,
    nextExplosionId: 0,
    nextEmpFxId: 0,
    nextBurjDecalId: 0,
    nextBurjDamageFxId: 0,
    nextBuildingDestroyFxId: 0,
    flareReadyThisWave: false,
    flareSalvoQueue: [],
    empReadyThisWave: false,
    empRings: [],
    empArcs: [],
    empBurstFlashes: [],
    empLauncherFlares: [],
    empGlitchTimer: 0,
    empGlitchMax: 0,
    empZoomTimer: 0,
    empZoomMax: 0,
    empScrubTicks: 0,
    f15ReadyThisWave: false,
    f15ReturnTimer: 0,
    f15ReturnGoRight: false,
    multiKillToast: null,
    combo: 1,
    _waveMaxCombo: 1,
    _waveStartMissileKills: 0,
    _waveStartDroneKills: 0,
    _waveStartDestroyedByType: createEmptyGameStats().destroyedByType,
    _waveStartMultiShots: 0,
    _waveStartScore: 0,
    _waveStartTick: 0,
    _waveSummaries: [],
    _waveSummaryRecorded: false,
    comboToast: null,
    // Spawn commander + schedule
    commander,
    schedule: wave1.schedule,
    scheduleIdx: 0,
    waveTick: 0,
    concurrentCap: wave1.concurrentCap,
    waveTactics: wave1.tactics,
  };

  const game = g as unknown as GameState;
  syncFireChargeForTick(game, 0);
  return game;
}

function recordWaveSummary(g: GameState): void {
  if (g._waveSummaryRecorded) return;
  const stats = normalizeGameStats(g.stats);
  const summary = {
    wave: g.wave,
    scoreEarned: Math.max(0, g.score - (g._waveStartScore ?? 0)),
    missileKills: stats.missileKills - (g._waveStartMissileKills ?? 0),
    droneKills: stats.droneKills - (g._waveStartDroneKills ?? 0),
    destroyedByType: getDestroyedByTypeDelta(stats.destroyedByType, g._waveStartDestroyedByType),
    multiShots: Math.max(0, stats.multiShots - (g._waveStartMultiShots ?? 0)),
    maxCombo: g._waveMaxCombo ?? 1,
    buildingsSurviving: g.buildings.filter((b) => b.alive).length,
    burjHealth: Math.max(0, g.burjHealth),
    startTick: g._waveStartTick ?? 0,
    endTick: g._replayTick ?? 0,
  };
  if (!g._waveSummaries) g._waveSummaries = [];
  g._waveSummaries.push(summary);
  g._waveSummaryRecorded = true;
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

const MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE = 0.42;

function missileTargetCandidates(g: GameState): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  if (g.burjAlive) candidates.push({ x: BURJ_X, y: CITY_Y });
  g.defenseSites.forEach((site) => {
    if (site.alive) candidates.push({ x: site.x, y: site.y });
  });
  LAUNCHERS.forEach((_, i) => {
    if (g.launcherHP[i] > 0) candidates.push(getGameplayLauncherPosition(i));
  });
  return candidates;
}

function isMissileAnglePlayable(startX: number, startY: number, target: { x: number; y: number }): boolean {
  const dy = Math.max(1, target.y - startY);
  return Math.abs(target.x - startX) / dy >= MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE;
}

function resolveMissileApproach(
  g: GameState,
  startX: number,
  startY: number,
  preferredTarget: { x: number; y: number },
): { startX: number; target: { x: number; y: number } } {
  if (isMissileAnglePlayable(startX, startY, preferredTarget)) return { startX, target: preferredTarget };

  if (startY < 0) {
    const dy = Math.max(1, preferredTarget.y - startY);
    const requiredDx = dy * MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE;
    const currentDx = preferredTarget.x - startX;
    const side = currentDx === 0 ? (preferredTarget.x < CANVAS_W / 2 ? 1 : -1) : currentDx > 0 ? -1 : 1;
    return { startX: preferredTarget.x + side * requiredDx, target: preferredTarget };
  }

  const alternate = missileTargetCandidates(g)
    .filter((target) => isMissileAnglePlayable(startX, startY, target))
    .sort((a, b) => Math.abs(a.x - startX) - Math.abs(b.x - startX))[0];
  if (alternate) return { startX, target: alternate };

  const dy = Math.max(1, preferredTarget.y - startY);
  const requiredDx = dy * MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE;
  const currentDx = preferredTarget.x - startX;
  const side = currentDx === 0 ? (preferredTarget.x < CANVAS_W / 2 ? 1 : -1) : currentDx > 0 ? -1 : 1;
  return { startX: preferredTarget.x + side * requiredDx, target: preferredTarget };
}

export function spawnMirv(g: GameState, onEvent?: SimEventSink | null) {
  return spawnMirvWithOverrides(g, undefined, onEvent);
}

function spawnMirvWithOverrides(g: GameState, overrides?: SpawnEntry["overrides"], onEvent?: SimEventSink | null) {
  let startX = rand(100, CANVAS_W - 100);
  let target = pickTarget(g, startX);
  if (!target) return;
  const startY = -20;
  ({ startX, target } = resolveMissileApproach(g, startX, startY, target));
  const dx = target.x - startX;
  const dy = target.y - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const speedMul = overrides?.speedMul ?? 1;
  const speed = (rand(0.6, 0.9) + g.wave * 0.05) * 2 * speedMul;
  const hp = 1;
  g.missiles.push({
    x: startX,
    y: startY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    accel: 1.018,
    trail: [],
    alive: true,
    type: "mirv",
    health: hp,
    maxHealth: hp,
    splitY: rand(180, 300),
    warheadCount: 5 + Math.min(3, Math.max(0, Math.floor((g.wave - 8) / 3))),
    splitTriggered: false,
    variant: overrides?.variant ?? "normal",
    speedMul,
    _hitByExplosions: new Set(),
  });
  if (onEvent) onEvent("sfx", { name: "mirvIncoming" });
}

export interface SpawnPlaneOptions {
  goRight?: boolean;
  fireIntervalMul?: number;
  speedMul?: number;
  yOverride?: number;
  xOffset?: number;
  fireRangeMul?: number;
  interceptorSpeedMul?: number;
  silent?: boolean;
}

export function spawnPlane(g: GameState, onEvent?: SimEventSink | null, opts: SpawnPlaneOptions = {}) {
  const _rng = getRng();
  const goRight = opts.goRight ?? _rng() > 0.5;
  const speedMul = opts.speedMul ?? 1;
  const fireIntervalMul = opts.fireIntervalMul ?? 1;
  const fireRangeMul = opts.fireRangeMul ?? 1;
  const interceptorSpeedMul = opts.interceptorSpeedMul ?? 1;
  const xOffset = opts.xOffset ?? 0;
  const baseSpeed = goRight ? rand(5.6, 8.0) : rand(-8.0, -5.6);
  g.planes.push({
    x: (goRight ? -60 : CANVAS_W + 60) + xOffset,
    y: opts.yOverride ?? rand(80, 200),
    vx: baseSpeed * speedMul,
    vy: 0,
    blinkTimer: 0,
    alive: true,
    fireTimer: 20,
    fireInterval: Math.max(6, Math.round(25 * fireIntervalMul)),
    fireRange: 350 * fireRangeMul,
    interceptorSpeed: 44 * interceptorSpeedMul,
    evadeTimer: 0,
  });
  if (!opts.silent && onEvent) onEvent("sfx", { name: "planePass" });
}

// Side spawns reuse a narrow Y band, so back-to-back picks can land on top of
// each other. Sample a few candidates and pick the one farthest from any
// threat still loitering near the spawn X — gives vertical breathing room
// without coupling to the schedule generator.
const SAME_SIDE_SPAWN_X_WINDOW = 240;
const SAME_SIDE_SEP_ATTEMPTS = 5;

function pickSeparatedSpawnY(g: GameState, spawnX: number, yMin: number, yMax: number, minSep = 70): number {
  const range = yMax - yMin;
  const targetSep = Math.min(minSep, range * 0.45);
  if (range <= 0) return yMin;

  const nearbyYs: number[] = [];
  for (const m of g.missiles) {
    if (m.alive && Math.abs(m.x - spawnX) < SAME_SIDE_SPAWN_X_WINDOW) nearbyYs.push(m.y);
  }
  for (const d of g.drones) {
    if (d.alive && Math.abs(d.x - spawnX) < SAME_SIDE_SPAWN_X_WINDOW) nearbyYs.push(d.y);
  }
  if (nearbyYs.length === 0) return rand(yMin, yMax);

  let bestY = rand(yMin, yMax);
  let bestSep = Infinity;
  for (const oy of nearbyYs) bestSep = Math.min(bestSep, Math.abs(bestY - oy));
  if (bestSep >= targetSep) return bestY;

  for (let i = 1; i < SAME_SIDE_SEP_ATTEMPTS; i++) {
    const y = rand(yMin, yMax);
    let sep = Infinity;
    for (const oy of nearbyYs) {
      const d = Math.abs(y - oy);
      if (d < sep) sep = d;
    }
    if (sep > bestSep) {
      bestY = y;
      bestSep = sep;
      if (sep >= targetSep) break;
    }
  }
  return bestY;
}

export function spawnMissile(g: GameState, overrides?: SpawnEntry["overrides"]) {
  const _rng = getRng();
  const speedMul = overrides?.speedMul ?? 1;
  const speed = (rand(0.5, 1.0) + g.wave * 0.08) * 2 * speedMul;
  const sideMinY = 20,
    sideMaxY = 722;
  const topSpawnY = -10;
  let startX, startY;
  const side = overrides?.side;
  if (side === "left") {
    startX = -10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else if (side === "right") {
    startX = CANVAS_W + 10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else if (side === "top") {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
  } else if (g.wave >= 2 && _rng() < Math.min(0.4, (g.wave - 1) * 0.1)) {
    const fromLeft = _rng() > 0.5;
    startX = fromLeft ? -10 : CANVAS_W + 10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
  }
  let target = pickTarget(g, startX);
  if (!target) return;
  ({ startX, target } = resolveMissileApproach(g, startX, startY, target));
  const dx = target.x - startX;
  const dy = target.y - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  g.missiles.push({
    x: startX,
    y: startY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    accel: 1.0045 + g.wave * 0.0009,
    trail: [],
    alive: true,
    type: "missile",
    targetX: target.x,
    targetY: target.y,
    variant: overrides?.variant ?? "normal",
    speedMul,
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
  const speedMul = overrides?.speedMul ?? 1;
  const speed = (rand(0.5, 1.0) + g.wave * 0.08) * 2 * speedMul;
  const sideMinY = 20;
  const sideMaxY = 722;
  const topSpawnY = -10;
  let startX, startY;
  const side = overrides?.side;
  if (side === "left") {
    startX = -10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else if (side === "right") {
    startX = CANVAS_W + 10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else if (side === "top") {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
  } else if (g.wave >= 2 && _rng() < Math.min(0.4, (g.wave - 1) * 0.1)) {
    const fromLeft = _rng() > 0.5;
    startX = fromLeft ? -10 : CANVAS_W + 10;
    startY = pickSeparatedSpawnY(g, startX, sideMinY, sideMaxY);
  } else {
    startX = rand(50, CANVAS_W - 50);
    startY = topSpawnY;
  }
  let target = pickTarget(g, startX);
  if (!target) return;
  ({ startX, target } = resolveMissileApproach(g, startX, startY, target));
  const dx = target.x - startX;
  const dy = target.y - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  g.missiles.push({
    x: startX,
    y: startY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    accel: 1.0045 + g.wave * 0.0009,
    trail: [],
    alive: true,
    type: stackCount === 2 ? "stack2" : "stack3",
    splitTriggered: false,
    splitAfterDist: len * 0.2,
    travelDist: 0,
    targetX: target.x,
    targetY: target.y,
    variant: overrides?.variant ?? "normal",
    speedMul,
    _hitByExplosions: new Set(),
  });
}

const SHAHED_136_DIVE_TELEGRAPH_TICKS = 52;

export function spawnDroneOfType(
  g: GameState,
  subtype: "shahed136" | "shahed238",
  overrides?: SpawnEntry["overrides"],
  shahedVariant: Shahed136Variant = "shahed-136-dive-bomber",
) {
  const _rng = getRng();
  const isJet = subtype === "shahed238";
  const hasDive = !isJet && shahed136HasDive(shahedVariant);
  const hasBomb = !isJet && shahed136HasBomb(shahedVariant);
  const side = overrides?.side;
  const yRange = overrides?.yRange || (isJet ? [80, 590] : hasDive ? [45, 255] : undefined);
  let goingRight;
  if (side === "left") goingRight = true;
  else if (side === "right") goingRight = false;
  else goingRight = _rng() > 0.5;
  const baseSpeed = isJet ? rand(2.5, 3.9) : rand(0.42, 0.84);
  const shahedLevelSpeedMul = !isJet && !hasDive ? 1.45 : 1;
  const speedMul = overrides?.speedMul ?? 1;
  const speed = (baseSpeed + g.wave * 0.05) * 2 * speedMul * shahedLevelSpeedMul;
  const health = 1;
  const spawnX = goingRight ? -20 : CANVAS_W + 20;
  const [yMin, yMax] = yRange ?? getShahed136LevelFlightYRange();
  const spawnY = pickSeparatedSpawnY(g, spawnX, yMin, yMax);
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
    shahedVariant: isJet ? undefined : shahedVariant,
    health,
    collisionRadius: isJet ? 10 : 30,
    variant: overrides?.variant ?? "normal",
    speedMul,
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
    const target = hasDive
      ? pickTarget(g, spawnX + (goingRight ? 1 : -1) * CANVAS_W * rand(0.28, 0.42)) || { x: BURJ_X, y: CITY_Y }
      : { x: goingRight ? CANVAS_W + 80 : -80, y: spawnY };
    const path = hasDive
      ? computeShahed136Path(spawnX, spawnY, goingRight, speed, target)
      : {
          waypoints: computeShahed136StraightPath(spawnX, spawnY, speed, target),
          diveStartIndex: undefined,
          bombIndices: [] as number[],
        };
    drone.waypoints = path.waypoints;
    drone.pathIndex = 0;
    drone.bombIndices = hasBomb
      ? hasDive
        ? path.bombIndices
        : [Math.max(1, Math.floor(path.waypoints.length * rand(0.46, 0.58)))]
      : [];
    drone.bombsDropped = 0;
    if (hasDive && typeof path.diveStartIndex === "number") {
      drone.diveStartIndex = path.diveStartIndex;
      drone.diveTarget = target;
    }
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

function pickHornetLaunchTarget(allThreats: Threat[], activeHornets: Hornet[], siteKey: HornetSiteKey): Threat | null {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return null;

  const placement = getDefenseSitePlacement(siteKey);
  const siteX = placement?.x ?? 206;
  const assignmentCounts = getHornetAssignmentCounts(activeHornets);
  const activeTargets = Array.from(assignmentCounts.keys());

  // Hold-fire on reserved: if every live target is already being chased by another
  // hornet, keep this slot in the magazine rather than launching a wasted second.
  const unassigned = aliveThreats.filter((t) => !assignmentCounts.has(t));
  if (unassigned.length === 0) return null;
  const localHalf =
    siteKey === "wildHornetsLeft"
      ? unassigned.filter((target) => target.x < BURJ_X)
      : unassigned.filter((target) => target.x >= BURJ_X);
  const spatialPool = localHalf.length > 0 ? localHalf : unassigned;

  const scored = spatialPool
    .map((target) => {
      const assigned = assignmentCounts.get(target) || 0;
      const spatialPenalty = (Math.abs(target.x - siteX) / 600) * 80;
      return {
        target,
        score:
          hornetTargetScore(target, 1, assigned) + getSpreadBonus(target, activeTargets, 340, 0.16) - spatialPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;
  const topBand = scored.filter((s) => s.score >= topScore - 25);
  return topBand[randInt(0, topBand.length - 1)].target;
}

const HORNET_DIVE_SLACK = 80;

function pickHornetRetargetTarget(
  h: Hornet,
  allThreats: Threat[],
  activeHornets: Hornet[],
  lvl: number,
): Threat | null {
  const alive = allThreats.filter((t) => t.alive && t.y <= h.y + HORNET_DIVE_SLACK);
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
  if (t.type === "drone" && (t.diving || t.diveTelegraphing)) return 720 + t.y * 0.16;
  if (t.type === "bomb") return 700 + t.y * 0.25;
  if (t.type === "drone") return 500 + t.y * 0.1;
  return 300 + t.y * 0.35;
}

function pickRoadrunnerTargets(
  allThreats: Threat[],
  activeRoadrunners: Roadrunner[],
  count: number,
  options: { allowReserved?: boolean } = {},
): Threat[] {
  const { allowReserved = true } = options;
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  const reserved = new Set<Threat>(
    activeRoadrunners.filter((r) => r.alive && r.targetRef?.alive).map((r) => r.targetRef!),
  );
  const spreadTargets = Array.from(reserved);
  const picked: Threat[] = [];

  const pickNext = (allowReservedThisPass: boolean): Threat | null => {
    const candidates = aliveThreats
      .filter((t: Threat) => !picked.includes(t) && (allowReservedThisPass || !reserved.has(t)))
      .map((t: Threat) => ({
        target: t,
        score: roadrunnerThreatScore(t) + getSpreadBonus(t, [...spreadTargets, ...picked], 320, 0.18),
      }))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.target || null;
  };

  while (picked.length < Math.min(count, aliveThreats.length)) {
    const next = pickNext(false) || (allowReserved ? pickNext(true) : null);
    if (!next) break;
    picked.push(next);
  }

  return picked;
}

function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

export function updateAutoSystems(g: GameState, dt: number, allThreats: Threat[], onEvent?: SimEventSink | null) {
  const _rng = getRng();
  // ── WILD HORNETS ──
  // Per-site progressive magazine: each launch site reloads one drone at a time.
  // Sites and retargeting are independent purchases — read directly from owned nodes.
  if (g.upgrades.wildHornets > 0) {
    const hasRetarget = g.ownedUpgradeNodes.has("skyHunterMesh");
    const reloadPerSlot = 60;
    const launchGap = 24;
    const blastR = 30;
    const retargetBudget = hasRetarget ? Number.POSITIVE_INFINITY : 0;
    const siteKeys = getActiveHornetSiteKeys(g);

    if (!g.hornetSites || g.hornetSites.some((site) => !siteKeys.includes(site.key))) {
      syncHornetSitesForOwnership(g);
    }
    for (const key of siteKeys) {
      if (!g.hornetSites.some((site) => site.key === key)) {
        g.hornetSites.push({ key, ammo: HORNET_SITE_CAPACITY, reloadTimer: 0, launchCooldown: 0 });
      }
    }

    for (const siteState of g.hornetSites) {
      if (!siteKeys.includes(siteState.key)) continue;
      const siteAlive = isSiteAlive(g, siteState.key);
      if (siteAlive && siteState.ammo < HORNET_SITE_CAPACITY) {
        siteState.reloadTimer += dt;
        while (siteState.reloadTimer >= reloadPerSlot && siteState.ammo < HORNET_SITE_CAPACITY) {
          siteState.ammo++;
          siteState.reloadTimer -= reloadPerSlot;
        }
      }
      if (siteState.ammo >= HORNET_SITE_CAPACITY) siteState.reloadTimer = 0;
      if (siteState.launchCooldown > 0) {
        siteState.launchCooldown = Math.max(0, siteState.launchCooldown - dt);
      }

      if (siteAlive && siteState.ammo > 0 && siteState.launchCooldown <= 0 && allThreats.length > 0) {
        const target = pickHornetLaunchTarget(allThreats, g.hornets, siteState.key);
        if (target) {
          const hornetSite = getDefenseSitePlacement(siteState.key);
          g.hornets.push({
            x: (hornetSite?.x ?? 206) + rand(-12, 12),
            y: (hornetSite?.y ?? GROUND_Y) - 20,
            targetRef: target,
            speed: rand(4.476, 6.72),
            trail: [],
            alive: true,
            blastRadius: blastR,
            wobble: rand(0, Math.PI * 2),
            life: 168,
            maxLife: 168,
            retargetsRemaining: retargetBudget,
          });
          siteState.ammo--;
          siteState.launchCooldown = launchGap;
          if (onEvent) onEvent("sfx", { name: "hornetBuzz" });
        }
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
    // Fuel sputter — when hornet is running out of life, drop sparks like a coughing engine
    if (h.life < 30 && rand(0, 1) < 0.18 * dt) {
      g.particles.push({
        x: h.x + rand(-2, 2),
        y: h.y + rand(-2, 2),
        vx: rand(-0.8, 0.8),
        vy: rand(0.2, 1.4),
        life: rand(8, 18),
        maxLife: 18,
        color: rand(0, 1) > 0.5 ? "#ff6600" : "#ffaa44",
        size: rand(0.8, 1.6),
        type: "spark",
        drag: 0.93,
        gravity: 0.04,
      });
    }
    const t = h.targetRef;
    // Hornets are kamikaze drones. Without Sky Hunter Mesh they crash when their
    // target dies; with it they keep retargeting until life expires (Infinity budget).
    if (!t || !t.alive) {
      if ((h.retargetsRemaining ?? 0) <= 0) {
        h.alive = false;
        boom(g, h.x, h.y, h.blastRadius * 0.5, COL.hornet, false, onEvent, h.blastRadius * 0.2);
        return;
      }
      const newT = pickHornetRetargetTarget(
        h,
        allThreats,
        g.hornets.filter((other) => other !== h),
        g.upgrades.wildHornets,
      );
      if (newT) {
        h.targetRef = newT;
        h.retargetsRemaining = (h.retargetsRemaining ?? 0) - 1;
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
    const currentTarget = h.targetRef;
    if (currentTarget?.alive && currentTarget.y > h.y + HORNET_DIVE_SLACK) {
      h.wobble += 0.15 * dt;
      h.trail.push({ x: h.x, y: h.y });
      if (h.trail.length > 12) h.trail.shift();
      h.y -= h.speed * 0.5 * dt;
      h.x += Math.sin(h.wobble) * 0.8 * dt;
      return;
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
  // Progressively-reloading magazine: capacity = count, one slot reloads every
  // (interval / count) ticks. Launches fire one at a time with a small forced
  // gap so each one gets its own visual/audible beat.
  if (g.upgrades.roadrunner > 0) {
    const lvl = g.upgrades.roadrunner;
    const capacity = [1, 2, 3][lvl - 1];
    const reloadInterval = [300, 240, 180][lvl - 1];
    const reloadPerSlot = reloadInterval / capacity;
    const launchGap = [12, 60, 12][lvl - 1];
    const rrSpeed = [10.1, 13.86, 17.64][lvl - 1];
    const rrBlastR = [27, 27, 28][lvl - 1];
    const rrTurnRate = [0.096, 0.132, 0.168][lvl - 1];

    const siteAlive = isSiteAlive(g, "roadrunner");

    if (siteAlive && g.roadrunnerAmmo < capacity) {
      g.roadrunnerReloadTimer += dt;
      while (g.roadrunnerReloadTimer >= reloadPerSlot && g.roadrunnerAmmo < capacity) {
        g.roadrunnerAmmo++;
        g.roadrunnerReloadTimer -= reloadPerSlot;
      }
    }
    if (g.roadrunnerAmmo >= capacity) g.roadrunnerReloadTimer = 0;

    if (g.roadrunnerLaunchCooldown > 0) {
      g.roadrunnerLaunchCooldown = Math.max(0, g.roadrunnerLaunchCooldown - dt);
    }

    if (siteAlive && g.roadrunnerAmmo > 0 && g.roadrunnerLaunchCooldown <= 0 && allThreats.length > 0) {
      const target = pickRoadrunnerTargets(allThreats, g.roadrunners, 1, { allowReserved: false })[0];
      if (target) {
        const roadrunnerSite = getDefenseSitePlacement("roadrunner");
        g.roadrunners.push({
          x: (roadrunnerSite?.x ?? 711) + rand(-15, 15),
          y: (roadrunnerSite?.y ?? GROUND_Y) - 10,
          targetRef: target,
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
        g.roadrunnerAmmo--;
        g.roadrunnerLaunchCooldown = launchGap;
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
  updateFlares(g, dt, {
    boom,
    destroyThreat: (state, threat) => {
      if (!threat.alive) return;
      threat.alive = false;
      state.score += getKillReward(threat) * state.combo;
      recordThreatDestroyed(state, threat);
    },
    recordNeutralized: recordThreatDestroyed,
    onEvent,
  });

  // ── IRON BEAM ──
  // Last-resort Burj defense: the charge is reserved for threats that will
  // actually hit the tower, and is only spent once one is about to land. A
  // charged beam therefore guarantees the next Burj impactor gets burned down.
  if (g.upgrades.ironBeam > 0 && isSiteAlive(g, "ironBeam")) {
    const lvl = g.upgrades.ironBeam;
    const beamCount = lvl;
    const spareRange = IRON_BEAM_RANGE[lvl - 1];
    const chargeTime = IRON_BEAM_CHARGE_TIME[lvl - 1];
    g.ironBeamTimer += dt;
    if (g.ironBeamTimer >= chargeTime) {
      const burjBound = allThreats
        .map((t) => ({ t, eta: predictBurjImpactTicks(g, t, IRON_BEAM_FIRE_WINDOW) }))
        .filter((e): e is { t: Threat; eta: number } => e.eta !== null)
        .sort((a, b) => a.eta - b.eta);
      if (burjBound.length > 0) {
        const targets = burjBound.slice(0, beamCount).map((e) => e.t);
        if (targets.length < beamCount) {
          // Spare beams strafe the nearest other threats around the emitter.
          const spares = allThreats
            .filter(
              (t) => t.alive && !targets.includes(t) && dist(t.x, t.y, BURJ_X, IRON_BEAM_EMITTER_Y) < spareRange,
            )
            .sort(
              (a, b) =>
                dist(a.x, a.y, BURJ_X, IRON_BEAM_EMITTER_Y) - dist(b.x, b.y, BURJ_X, IRON_BEAM_EMITTER_Y),
            );
          targets.push(...spares.slice(0, beamCount - targets.length));
        }
        for (const t of targets) {
          g.laserBeams.push({
            x1: BURJ_X,
            y1: IRON_BEAM_EMITTER_Y,
            x2: t.x,
            y2: t.y,
            life: 20,
            maxLife: 20,
            targetRef: t,
          });
          damageTarget(g, t, t.type === "drone" ? 2 : 1, COL.laser, t.type === "drone" ? 20 : 15);
        }
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
  updatePatriotSystem(
    g,
    dt,
    allThreats,
    isSiteAlive(g, "patriot"),
    isBurjImpactTarget,
    onEvent,
    (x, y, radius, initialRadius) => boom(g, x, y, radius, COL.patriot, false, onEvent, initialRadius),
  );

  // ── EMP SHOCKWAVE ── (charging is handled in update() before waveComplete check)
  updateEmpRings(g, dt, allThreats);
}

function updateMissiles(g: GameState, dt: number, onEvent?: SimEventSink | null) {
  g.missiles.forEach((m: Missile) => {
    if (!m.alive) return;
    if (m.flareControl) return;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 21) m.trail.shift();
    if (m.accel) {
      m.vx *= m.accel ** dt;
      m.vy *= m.accel ** dt;
    }
    const stepX = m.vx * dt;
    const stepY = m.vy * dt;
    m.x += stepX;
    m.y += stepY;
    if (m.type === "stack2" || m.type === "stack3") {
      m.travelDist = (m.travelDist ?? 0) + Math.sqrt(stepX * stepX + stepY * stepY);
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
        const childSpeedMul = m.speedMul ?? 1;
        g.missiles.push({
          x: m.x + rand(-20, 20),
          y: m.y + rand(-10, 10),
          vx: (dx / len) * spd * childSpeedMul,
          vy: (dy / len) * spd * childSpeedMul,
          accel: 1.018 + g.wave * 0.0036,
          trail: [],
          alive: true,
          type: "mirv_warhead",
          targetX: t.x,
          targetY: t.y,
          variant: m.variant ?? "normal",
          speedMul: childSpeedMul,
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
          variant: m.variant ?? "normal",
          speedMul: m.speedMul ?? 1,
          _hitByExplosions: new Set(),
        });
      }
      boom(g, m.x, m.y, 18, "#ffb36b", false, onEvent, 0, { harmless: true });
      if (onEvent) onEvent("sfx", { name: "mirvSplit" });
    }
    // Burj collision — hitbox matches the shared scenic Burj placement
    if (m.alive && hitsBurjBody(g, m.x, m.y)) {
      m.alive = false;
      boom(g, m.x, m.y, 55, "#ff4400", false, onEvent, 30);
      applyShake(g, 10, 4);
      applyBurjHitDamage(g, m.x, m.y, "missile", onEvent);
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
          applyShake(g, 12, 5);
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
          applyShake(g, 10, 4);
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
      if (g.burjAlive && isBurjImpactTarget(m.targetX, m.targetY)) {
        applyBurjHitDamage(g, m.x, GAMEPLAY_SCENIC_THREAT_FLOOR_Y, "missile", onEvent);
      }
    }
    if (m.x < -50 || m.x > CANVAS_W + 50 || m.y > CANVAS_H + 50) m.alive = false;
  });
}

function updateDrones(g: GameState, _rng: () => number, dt: number, onEvent?: SimEventSink | null) {
  g.drones.forEach((d: Drone) => {
    if (!d.alive) return;
    if (d.flareControl) return;
    d.trail ??= [];
    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > (d.subtype === "shahed238" ? 13 : 10)) d.trail.shift();
    d.wobble += 0.05 * dt;
    if (d.waypoints && d.waypoints.length >= 2) {
      // Follow precomputed trajectory.
      if (!d.waypoints || d.waypoints.length < 2) {
        d.alive = false;
        return;
      }
      const prevX = d.x;
      const prevY = d.y;
      const diveStart = d.diveStartIndex ?? Infinity;
      const isShahed136Diver =
        d.subtype === "shahed136" && shahed136HasDive(d.shahedVariant ?? "shahed-136-dive-bomber");
      const hasWaypointDive = Number.isFinite(diveStart);
      d.diveTelegraphing =
        isShahed136Diver && !d.diving && (d.pathIndex ?? 0) >= diveStart - SHAHED_136_DIVE_TELEGRAPH_TICKS;
      // Two-phase Shahed-136 dive behavior: cruise feels lazy, dive ramps to terminal velocity.
      // diveSpeed is repurposed here as the ramping pathSpeed multiplier for waypoint paths.
      let pathSpeed = 1;
      if (isShahed136Diver && (d.pathIndex ?? 0) >= diveStart) {
        if (!d.diveSpeed) d.diveSpeed = 1.0;
        d.diveSpeed = Math.min(4.0, d.diveSpeed * 1.06 ** dt);
        pathSpeed = d.diveSpeed;
      }
      d.pathIndex = Math.min((d.pathIndex ?? 0) + dt * pathSpeed, d.waypoints.length - 1);
      const i0 = Math.floor(d.pathIndex);
      const frac = d.pathIndex - i0;
      const i1 = Math.min(i0 + 1, d.waypoints.length - 1);
      d.x = d.waypoints[i0].x + (d.waypoints[i1].x - d.waypoints[i0].x) * frac;
      d.y = d.waypoints[i0].y + (d.waypoints[i1].y - d.waypoints[i0].y) * frac;
      d.vx = d.x - prevX;
      d.vy = d.y - prevY;
      if (hasWaypointDive && !d.diving && d.pathIndex >= diveStart) {
        d.diving = true;
        d.diveTelegraphing = false;
      }
      // Drop bombs at precomputed path positions
      if (
        (d.bombsDropped ?? 0) < (d.bombIndices?.length ?? 0) &&
        d.pathIndex >= (d.bombIndices ?? [])[d.bombsDropped ?? 0]
      ) {
        const bombT = pickBuildingTarget(g, d.x);
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
            targetX: bombT.x,
            targetY: bombT.y,
            variant: d.variant ?? "normal",
            speedMul: d.speedMul ?? 1,
            _hitByExplosions: new Set(),
          });
        }
        d.bombsDropped = (d.bombsDropped ?? 0) + 1;
      }
    } else {
      if (!d.diving) {
        d.x += d.vx * dt;
        d.y += (d.vy + Math.sin(d.wobble) * 0.3) * dt;
        const nearMid = (d.vx > 0 && d.x > CANVAS_W * 0.35) || (d.vx < 0 && d.x < CANVAS_W * 0.65);
        if (nearMid) {
          if (shahed136HasBomb(d.shahedVariant ?? "shahed-136-dive-bomber") && !d.bombDropped) {
            d.bombDropped = true;
            const bombT = pickBuildingTarget(g, d.x);
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
                targetX: bombT.x,
                targetY: bombT.y,
                variant: d.variant ?? "normal",
                speedMul: d.speedMul ?? 1,
                _hitByExplosions: new Set(),
              });
            }
          }
          if (shahed136HasDive(d.shahedVariant ?? "shahed-136-dive-bomber")) {
            d.diving = true;
            d.diveTelegraphing = false;
            const diveT = pickTarget(g, d.x);
            d.diveTarget = diveT || { x: BURJ_X, y: CITY_Y };
          }
        }
      } else {
        const dx = d.diveTarget!.x - d.x;
        const dy = d.diveTarget!.y - d.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) {
          d.alive = false;
        } else {
          // Fallback dive for drones spawned without waypoints (legacy path; not exercised
          // in current spawn paths). Real Shahed-136 dive tuning lives in the waypoint
          // branch above where pathSpeed ramps with d.diveSpeed.
          if (!d.diveSpeed) d.diveSpeed = Math.max(Math.abs(d.vx), 1.0) * 2.7;
          d.vx = (dx / len) * d.diveSpeed;
          d.vy = (dy / len) * d.diveSpeed;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
      }
    }
    if (d.x < -60 || d.x > CANVAS_W + 60 || d.y > CANVAS_H + 20) d.alive = false;
    // Burj body collision — match the shared scenic Burj placement
    if (d.alive && hitsBurjBody(g, d.x, d.y)) {
      d.alive = false;
      boom(g, d.x, d.y, 70, "#ff6600", false, onEvent, 40);
      applyShake(g, 15, 6);
      applyBurjHitDamage(g, d.x, d.y, "drone", onEvent);
    }
    // Shahed impact
    if (d.diveTarget && d.alive) {
      const hitTarget = dist(d.x, d.y, d.diveTarget.x, d.diveTarget.y) < 20;
      const hitGround = d.y >= GAMEPLAY_WATERLINE_Y;
      const pathDone = d.waypoints && (d.pathIndex ?? 0) >= d.waypoints.length - 1;
      if (hitTarget || hitGround || pathDone) {
        const impactY = hitTarget ? d.y : Math.min(d.y, GAMEPLAY_WATERLINE_Y);
        const targetIsBurj = isBurjDiveTarget(g, d);
        d.alive = false;
        boom(g, d.x, impactY, 70, "#ff6600", false, onEvent, 40);
        applyShake(g, 15, 6);
        if (targetIsBurj) {
          applyBurjHitDamage(g, d.x, Math.min(impactY, GAMEPLAY_SCENIC_THREAT_FLOOR_Y), "drone", onEvent);
        }
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

const INTERCEPTOR_THREAT_PROXIMITY_FUSE_ENABLED = true;
const INTERCEPTOR_TARGET_DETONATE_RADIUS = 8;
const INTERCEPTOR_TARGET_GATED_PROXIMITY_RADIUS = 60;
const INTERCEPTOR_PLAYER_BLAST_RADIUS = 60;
const PLAYER_CHAIN_EXPLOSION_RADIUS = 60;

function didPlayerInterceptorReachTarget(ic: Interceptor, prevX: number, prevY: number): boolean {
  if (dist(ic.x, ic.y, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_DETONATE_RADIUS) return true;
  return segmentDistanceToPoint(prevX, prevY, ic.x, ic.y, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_DETONATE_RADIUS;
}

function closestPointOnSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): { x: number; y: number; distance: number } {
  const segX = x2 - x1;
  const segY = y2 - y1;
  const lenSq = segX * segX + segY * segY;
  if (lenSq <= 0) return { x: x1, y: y1, distance: dist(x1, y1, px, py) };
  const t = Math.max(0, Math.min(1, ((px - x1) * segX + (py - y1) * segY) / lenSq));
  const closestX = x1 + segX * t;
  const closestY = y1 + segY * t;
  return { x: closestX, y: closestY, distance: dist(closestX, closestY, px, py) };
}

function segmentDistanceToPoint(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
  return closestPointOnSegment(x1, y1, x2, y2, px, py).distance;
}

function findIntendedTargetDetonationPoint(
  ic: Interceptor,
  prevX: number,
  prevY: number,
  g: GameState,
): { x: number; y: number } | null {
  for (const target of ic.intendedTargets ?? []) {
    if (!target.alive || isThreatDoomedByActiveExplosion(g, target)) continue;
    const radius =
      target.type === "drone"
        ? INTERCEPTOR_PLAYER_BLAST_RADIUS + target.collisionRadius
        : INTERCEPTOR_PLAYER_BLAST_RADIUS;
    const closest = closestPointOnSegment(prevX, prevY, ic.x, ic.y, target.x, target.y);
    if (closest.distance <= radius) {
      return { x: closest.x, y: closest.y };
    }
  }
  return null;
}

function updateInterceptors(g: GameState, dt: number, onEvent?: SimEventSink | null) {
  g.interceptors.forEach((ic: Interceptor) => {
    if (!ic.alive) return;
    ic.trail.push({ x: ic.x, y: ic.y });
    if (ic.trail.length > 15) ic.trail.shift();
    const prevX = ic.x;
    const prevY = ic.y;
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
    if (ic.fromF15 && dist(ic.x, ic.y, ic.targetX, ic.targetY) < 40) {
      detonate = true;
    } else if (!ic.fromF15 && didPlayerInterceptorReachTarget(ic, prevX, prevY)) {
      ic.x = ic.targetX;
      ic.y = ic.targetY;
      detonate = true;
    } else if (!ic.fromF15) {
      const intendedDetonation = findIntendedTargetDetonationPoint(ic, prevX, prevY, g);
      if (intendedDetonation) {
        ic.x = intendedDetonation.x;
        ic.y = intendedDetonation.y;
        detonate = true;
      }
    }
    // Proximity fuse: detonate early if passing close to any threat
    const canProximityFuseNearTarget =
      dist(ic.x, ic.y, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_GATED_PROXIMITY_RADIUS;
    if (!detonate && !ic.fromF15 && INTERCEPTOR_THREAT_PROXIMITY_FUSE_ENABLED && canProximityFuseNearTarget) {
      for (const m of g.missiles) {
        if (
          m.alive &&
          !isThreatDoomedByActiveExplosion(g, m) &&
          dist(ic.x, ic.y, m.x, m.y) < INTERCEPTOR_PLAYER_BLAST_RADIUS
        ) {
          detonate = true;
          break;
        }
      }
      if (!detonate) {
        for (const d of g.drones) {
          if (
            d.alive &&
            !isThreatDoomedByActiveExplosion(g, d) &&
            dist(ic.x, ic.y, d.x, d.y) < INTERCEPTOR_PLAYER_BLAST_RADIUS + d.collisionRadius
          ) {
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
        boom(
          g,
          ic.x,
          ic.y,
          INTERCEPTOR_PLAYER_BLAST_RADIUS,
          COL.interceptor,
          true,
          onEvent,
          INTERCEPTOR_PLAYER_BLAST_RADIUS,
        );
      }
    }
    if (ic.fromF15 && (ic.x < -50 || ic.x > CANVAS_W + 50 || ic.y < -50 || ic.y > CANVAS_H + 50)) ic.alive = false;
  });
}

function updateExplosions(g: GameState, dt: number, onEvent?: SimEventSink | null) {
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
              recordThreatDestroyed(g, m);
              rootEx.kills = (rootEx.kills ?? 0) + 1;
              rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
              boom(
                g,
                m.x,
                m.y,
                PLAYER_CHAIN_EXPLOSION_RADIUS,
                COL.mirv,
                ex.playerCaused,
                onEvent,
                PLAYER_CHAIN_EXPLOSION_RADIUS,
                {
                  chain: true,
                  chainLevel: (ex.chainLevel ?? 0) + 1,
                  rootExplosionId: rootEx.id,
                  linkFromX: ex.x,
                  linkFromY: ex.y,
                  linkAlpha: 1,
                  visualType: "missile",
                },
              );
            }
          }
        } else if (dist(m.x, m.y, ex.x, ex.y) < ex.radius) {
          m.alive = false;
          g.score += getKillReward(m) * g.combo;
          recordThreatDestroyed(g, m);
          rootEx.kills = (rootEx.kills ?? 0) + 1;
          rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
          boom(
            g,
            m.x,
            m.y,
            PLAYER_CHAIN_EXPLOSION_RADIUS,
            "#ffcc00",
            ex.playerCaused,
            onEvent,
            PLAYER_CHAIN_EXPLOSION_RADIUS,
            {
              chain: true,
              chainLevel: (ex.chainLevel ?? 0) + 1,
              rootExplosionId: rootEx.id,
              linkFromX: ex.x,
              linkFromY: ex.y,
              linkAlpha: 1,
              visualType: "missile",
            },
          );
        }
      });
      g.drones.forEach((d) => {
        if (!d.alive) return;
        if (dist(d.x, d.y, ex.x, ex.y) < ex.radius + d.collisionRadius) {
          d.health--;
          if (d.health <= 0) {
            d.alive = false;
            g.score += getKillReward(d) * g.combo;
            recordThreatDestroyed(g, d);
            rootEx.kills = (rootEx.kills ?? 0) + 1;
            rootEx.heroPulse = Math.min(1.6, 0.65 + (rootEx.kills ?? 0) * 0.18);
            boom(
              g,
              d.x,
              d.y,
              PLAYER_CHAIN_EXPLOSION_RADIUS,
              "#ff8800",
              ex.playerCaused,
              onEvent,
              PLAYER_CHAIN_EXPLOSION_RADIUS,
              {
                chain: true,
                chainLevel: (ex.chainLevel ?? 0) + 1,
                rootExplosionId: rootEx.id,
                linkFromX: ex.x,
                linkFromY: ex.y,
                linkAlpha: 1,
                visualType: "drone",
              },
            );
          }
        }
      });
      // Multi-kill bonus (only check on root explosions)
      if (rootEx === ex && (ex.kills ?? 0) >= 2 && !ex.bonusAwarded) {
        ex.bonusAwarded = true;
        if (ex.playerCaused && !ex._multiShotCounted) {
          ex._multiShotCounted = true;
          g.stats = normalizeGameStats(g.stats);
          g.stats.multiShots++;
        }
        const bonus = getMultiKillBonus(ex.kills ?? 0);
        const label = ex.kills === 2 ? "DOUBLE KILL" : ex.kills === 3 ? "TRIPLE KILL" : "MEGA KILL";
        g.score += bonus;
        g.multiKillToast = { label, bonus, kills: ex.kills, x: ex.x, y: ex.y, timer: 90, pulse: 1 };
        ex.heroPulse = Math.max(ex.heroPulse ?? 0, 1.2);
        applyShake(g, 10 + (ex.kills ?? 0) * 2, 4 + (ex.kills ?? 0));
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
        applyShake(g, 10 + (ex.kills ?? 0) * 2, 4 + (ex.kills ?? 0));
        if (onEvent) onEvent("sfx", { name: "multiKill" });
      }
    }
    if (ex.kills) ex._lastBonusKills = ex.kills;
  });
}

function processRootExplosionCombo(g: GameState, forceFinalKills = false): void {
  g.explosions.forEach((ex) => {
    if (ex._comboProcessed || !ex.playerCaused || ex.rootExplosionId !== null) return;
    const kills = ex.kills ?? 0;
    if (forceFinalKills && kills < 1) return;
    if (!forceFinalKills && ex.alpha > 0) return;
    ex._comboProcessed = true;
    if (kills >= 1) {
      const next = Math.min(10, g.combo + 1);
      if (next > g.combo) {
        g.comboToast = { multiplier: next, timer: 70, x: ex.x, y: ex.y - 20, pulse: 1 };
      }
      g.combo = next;
      g._waveMaxCombo = Math.max(g._waveMaxCombo ?? 1, g.combo);
      g.stats = normalizeGameStats(g.stats);
      g.stats.maxCombo = Math.max(g.stats.maxCombo, g.combo);
    } else {
      g.combo = 1;
    }
  });
}

function updatePlanes(g: GameState, dt: number, allThreats: Threat[], onEvent?: SimEventSink | null) {
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
        closestD = p.fireRange;
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
        const spd = p.interceptorSpeed;
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

function updateParticleVisuals(g: GameState, dt: number): void {
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
}

function filterDeadVisuals(g: GameState): void {
  g.interceptors = g.interceptors.filter((ic) => ic.alive);
  g.explosions = g.explosions.filter((ex) => ex.alpha > 0);
  g.particles = g.particles.filter((p) => p.life > 0);
  g.planes = g.planes.filter((p) => p.alive);
}

function updateWaveCompleteVisuals(g: GameState, dt: number, onEvent?: SimEventSink | null): void {
  updateInterceptors(g, dt, onEvent);
  updateExplosions(g, dt, onEvent);
  updatePlanes(g, dt, [], onEvent);
  updateBurjFireParticles(g, dt);
  updateParticleVisuals(g, dt);
  filterDeadVisuals(g);
}

function startWaveBonus(g: GameState, onEvent?: SimEventSink | null): void {
  if (g._bonusScreenStarted) return;
  g._bonusScreenStarted = true;
  if (g.burjAlive) {
    processRootExplosionCombo(g, true);
    g.stats = normalizeGameStats(g.stats);
  }
  if (g.burjAlive && onEvent) {
    onEvent("waveBonusStart", {
      wave: g.wave,
      buildings: g.buildings.filter((b) => b.alive).length,
      missileKills: g.stats.missileKills - (g._waveStartMissileKills ?? 0),
      droneKills: g.stats.droneKills - (g._waveStartDroneKills ?? 0),
      destroyedByType: getDestroyedByTypeDelta(g.stats.destroyedByType, g._waveStartDestroyedByType),
      multiShots: Math.max(0, g.stats.multiShots - (g._waveStartMultiShots ?? 0)),
      maxCombo: g._waveMaxCombo ?? 1,
    });
  }
}

export function completeWaveBonusAndOpenShop(g: GameState, onEvent?: SimEventSink | null): void {
  g._bonusScreenDone = true;
  if (g.shopOpened) return;

  g.shopOpened = true;
  if (!g.burjAlive) return;
  recordWaveSummary(g);
  g.state = "shop";
  if (g._draftMode) {
    g._draftOffers = draftPick3(g, g._debugUpgradeForceShowFamilies ?? []);
  }
  onEvent?.("shopOpen", { score: g.score, wave: g.wave, upgrades: { ...g.upgrades } });
}

export function update(g: GameState, dt: number, onEvent?: SimEventSink | null) {
  if (dt <= 0) throw new Error(`Simulation dt must be positive; received ${dt}`);
  syncFireChargeForTick(g, Math.floor(g.time));
  const _rng = getRng();
  const rawDt = dt;
  const simDt = dt * empScrubScale(g.empScrubTicks ?? 0);
  dt = simDt;
  g.time += rawDt;
  updateEmpVisualFx(g, rawDt);
  if (g.shakeTimer > 0) {
    g.shakeTimer = Math.max(0, g.shakeTimer - dt);
    if (g.shakeTimer === 0) {
      g.shakeIntensity = 0;
      g.shakePeakTimer = 0;
    }
  }
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
      g.stats = normalizeGameStats(g.stats);
      if (onEvent) {
        onEvent("gameOver", {
          score: g.score,
          wave: g.wave,
          stats: { ...g.stats, destroyedByType: cloneDestroyedByTypeStats(g.stats.destroyedByType) },
        });
      }
    }
    return;
  }

  // F-15 rank-2 return pass
  if (g.f15ReturnTimer > 0) {
    g.f15ReturnTimer -= dt;
    if (g.f15ReturnTimer <= 0) {
      g.f15ReturnTimer = 0;
      spawnF15Formation(g, g.f15ReturnGoRight, g.upgrades.f15, onEvent);
    }
  }

  if (g.waveComplete) {
    if (g._laserHandle) {
      g._laserHandle.stop();
      g._laserHandle = null;
    }
    updateWaveCompleteVisuals(g, dt, onEvent);
    if ((g.waveClearedTimer ?? 0) <= 0) {
      startWaveBonus(g, onEvent);
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
    g._waveSummaryRecorded = false;
    g.shopOpened = false;
    g.waveClearedTimer = 120;
    g.score += 250 * g.wave;
    processRootExplosionCombo(g, true);
    g.stats = normalizeGameStats(g.stats);
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
    else if (
      type === "shahed-136" ||
      type === "shahed-136-bomber" ||
      type === "shahed-136-dive" ||
      type === "shahed-136-dive-bomber"
    )
      spawnDroneOfType(gs, "shahed136", overrides, type);
    else if (type === "drone238") spawnDroneOfType(gs, "shahed238", overrides);
    else if (type === "mirv") spawnMirvWithOverrides(gs, overrides, onEvent);
  });

  const allThreats = [...g.missiles.filter((m) => m.alive), ...g.drones.filter((d) => d.alive)];
  // Auto-defense systems only target threats visible on screen
  const visibleThreats = allThreats.filter((t) => t.y >= 0);
  updateAutoSystems(g, dt, visibleThreats, onEvent);
  updateMissiles(g, dt, onEvent);
  updateDrones(g, _rng, dt, onEvent);
  updateInterceptors(g, dt, onEvent);
  updateExplosions(g, dt, onEvent);
  updatePlanes(g, dt, allThreats, onEvent);
  updateBurjFireParticles(g, dt);

  updateParticleVisuals(g, dt);

  // Combo: check dying player-caused root explosions
  processRootExplosionCombo(g);

  // PERF: This allocates six fresh arrays every tick. Keep the current filter
  // order for determinism; a future mark-and-sweep pass should preserve entity
  // iteration order and replay hashes before replacing it.
  g.missiles = g.missiles.filter((m) => m.alive);
  g.drones = g.drones.filter((d) => d.alive);
  g.interceptors = g.interceptors.filter((ic) => ic.alive);
  g.explosions = g.explosions.filter((ex) => ex.alpha > 0);
  g.particles = g.particles.filter((p) => p.life > 0);
  g.planes = g.planes.filter((p) => p.alive);
}

function spawnF15Formation(g: GameState, goRight: boolean, lvl: number, onEvent: SimEventSink | null | undefined) {
  const fireIntervalMul = lvl >= 2 ? 0.4 : 0.55;
  const speedMul = lvl >= 2 ? 1.15 : 1.0;
  const fireRangeMul = 1.8;
  const interceptorSpeedMul = 1.4;
  const leadY = rand(75, 100);
  const wingY = leadY + 115;
  const leadOffset = goRight ? 180 : -180;
  spawnPlane(g, onEvent, {
    goRight,
    yOverride: leadY,
    xOffset: leadOffset,
    fireIntervalMul,
    speedMul,
    fireRangeMul,
    interceptorSpeedMul,
  });
  spawnPlane(g, null, {
    goRight,
    yOverride: wingY,
    fireIntervalMul,
    speedMul,
    fireRangeMul,
    interceptorSpeedMul,
    silent: true,
  });
}

export function fireF15Pair(g: GameState, onEvent?: SimEventSink | null) {
  if (!g.f15ReadyThisWave || g.upgrades.f15 <= 0) return false;
  const lvl = g.upgrades.f15;
  g.f15ReadyThisWave = false;
  const goRight = getRng()() > 0.5;
  spawnF15Formation(g, goRight, lvl, onEvent);
  if (lvl >= 2) {
    g.f15ReturnTimer = 110;
    g.f15ReturnGoRight = !goRight;
  }
  if (onEvent) onEvent("sfx", { name: "planeIncoming" });
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

export function createGameSim(options: { onEvent?: SimEventSink | null } = {}) {
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

export {
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  draftPick3,
  grantReplayUpgrade,
  repairLauncher,
  repairSite,
} from "./game-sim-shop";
