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
  applyShake,
  getShahed136LevelFlightYRange,
  getGameplayLauncherPosition,
  dist,
  rand,
  randInt,
  pickTarget,
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
  getAmmoCapacity,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  GAMEPLAY_SCENIC_BASE_Y,
  ov,
  resetExplosionId,
} from "./game-logic.js";
import { createCommander, generateWaveSchedule, advanceSpawnSchedule, isWaveFullySpawned } from "./wave-spawner.js";
import { createEmptyUpgradeLevels, createEmptyUpgradeProgression } from "./game-sim-upgrades.js";
import {
  buyUpgrade,
  closeShop,
  draftPick3,
  getActiveHornetSiteKeys,
  HORNET_SITE_CAPACITY,
  syncHornetSitesForOwnership,
} from "./game-sim-shop.js";
import { createFireChargeState } from "./player-fire-limiter.js";
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
  PatriotMissile,
  PatriotLaunchQueueItem,
  Flare,
  SpawnEntry,
  Shahed136Variant,
  EmpRing,
} from "./types.js";
import { shahed136HasBomb, shahed136HasDive } from "./types.js";
import { getBurjDamageFireLayout } from "./art-render.js";
import { getBurjFireEmberVariantId, getBurjFireFlameVariantId } from "./burj-fire-textures.js";
import { getBurjSmokeParticleVariantId } from "./smoke-particle-assets.js";

const BURJ_FIRE_MAX_HEALTH = 7;
const BURJ_FIRE_TOWER_BASE_Y = GAMEPLAY_SCENIC_BASE_Y;

function pickBurjParticleVariantIndex(x: number, y: number, life: number, size: number, salt = 0): number {
  const value = Math.sin(x * 0.173 + y * 0.097 + life * 0.231 + size * 0.419 + salt * 2.113) * 10000;
  return Math.floor(Math.abs(value));
}

function pickBurjSmokeParticleVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjSmokeParticleVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

function pickBurjFireFlameVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjFireFlameVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

function pickBurjFireEmberVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjFireEmberVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

export function updateBurjFireParticles(g: GameState, dt: number): void {
  if (!g.burjAlive) return;
  const rawHealth = Math.max(0, Math.min(BURJ_FIRE_MAX_HEALTH, Math.round(g.burjHealth)));
  const layout = getBurjDamageFireLayout(BURJ_FIRE_TOWER_BASE_Y, rawHealth, {
    maxHealth: BURJ_FIRE_MAX_HEALTH,
    gameSeed: g._gameSeed ?? 0,
  });
  if (layout.fireSites.length === 0 || layout.tier === "pristine") return;

  const damageRatio = layout.lostCount / BURJ_FIRE_MAX_HEALTH;
  const tierMul =
    layout.tier === "critical" ? 1.7 : layout.tier === "burning" ? 1.15 + damageRatio * 0.4 : 0.45 + damageRatio * 0.36;
  const tierSizeMul = layout.tier === "critical" ? 1.12 : layout.tier === "burning" ? 0.96 : 0.68;
  const smokeDamageMul = ov("burjFire.smokeDamageMul", 2.4);
  const flameRate = Math.min(8.5, ov("burjFire.flameRate", 0.9) * tierMul);
  const emberRate = Math.min(8.2, ov("burjFire.emberRate", 1.25) * (0.78 + tierMul * 0.7));
  const smokeRate = Math.min(
    2.2,
    ov("burjFire.smokeRate", 0.75) * (0.4 + tierMul * 0.55 + damageRatio * smokeDamageMul * 0.16),
  );
  const flameLife = ov("burjFire.flameLife", 51);
  const emberLife = ov("burjFire.emberLife", 100);
  const smokeLife = ov("burjFire.smokeLife", 155);
  const smokeRise = ov("burjFire.smokeRise", 1.35);
  const smokeDrift = ov("burjFire.smokeDrift", 0.44);
  const flameSize = ov("burjFire.flameSize", 7.5);
  const smokeSize = ov("burjFire.smokeSize", 7.5);
  const emberSize = ov("burjFire.emberSize", 2.5);
  const hotspotSpread = ov("burjFire.hotspotSpread", 0.62);
  const smokeRiseDamageBoost = ov("burjFire.smokeRiseDamageBoost", 0.5);
  const smokeBase = ov("burjFire.smokeBase", 0.35);
  const smokeYOffset = ov("burjFire.smokeYOffset", 17);
  const hitFlashFlameMul = ov("burjFire.hitFlashFlameMul", 3.4);
  const hitFlashSmokeMul = ov("burjFire.hitFlashSmokeMul", 2.4);
  const ignite = g.burjHitFlashMax > 0 ? Math.max(0, Math.min(1, g.burjHitFlashTimer / g.burjHitFlashMax)) : 0;
  const flameKick = 1 + ignite * Math.max(0, hitFlashFlameMul - 1);
  const smokeKick = 1 + ignite * Math.max(0, hitFlashSmokeMul - 1);
  const flameSizeKick = 1 + ignite * 0.5;
  const totalFlameAnchors = Math.max(
    1,
    layout.fireSites.reduce((sum, site) => sum + site.flameAnchors.length, 0),
  );
  const totalSmokeSites = Math.max(1, layout.fireSites.length);

  for (const site of layout.fireSites) {
    const band = site.band;
    const halfW = Math.max(4, band.halfW);

    for (const anchor of site.flameAnchors) {
      const anchorT = Math.max(0, Math.min(1, 0.5 + (anchor.x - BURJ_X) / Math.max(1, halfW * 1.6)));
      const anchorSizeMul = 0.78 + 0.22 * Math.sin(anchor.seed);
      spawnPoisson(g, (flameRate * dt * flameKick) / totalFlameAnchors, () => {
        const lean = (anchorT - 0.5) * 0.28 + rand(-0.12, 0.12);
        const x = anchor.x + rand(-halfW * hotspotSpread * 0.2, halfW * hotspotSpread * 0.2);
        const y = anchor.y + rand(-band.h * 0.1, band.h * 1.25);
        const life = rand(flameLife * 0.65, flameLife);
        const size = rand(flameSize * 0.78, flameSize * 1.45) * anchorSizeMul * tierSizeMul * flameSizeKick;
        g.particles.push({
          x,
          y,
          vx: rand(-0.16, 0.16) + (anchorT - 0.5) * 0.05,
          vy: -rand(0.52, 1.08),
          life,
          maxLife: flameLife,
          color: layout.tier === "wounded" ? "#ff7a24" : "#ff8f32",
          size,
          type: "fireFlame",
          textureVariant: pickBurjFireFlameVariant(x, y, life, size, anchor.seed),
          angle: lean,
          spin: rand(-0.018, 0.018),
          gravity: 0,
          drag: 0.955,
        });
      });

      spawnPoisson(g, (emberRate * dt * flameKick) / totalFlameAnchors, () => {
        const ang = rand(-Math.PI * 0.75, -Math.PI * 0.25);
        const sp = rand(0.55, layout.tier === "critical" ? 2.1 : 1.55);
        const x = anchor.x + rand(-halfW * 0.18, halfW * 0.18);
        const y = anchor.y + rand(-band.h * 0.2, band.h * 0.95);
        const life = rand(emberLife * 0.55, emberLife);
        const size = rand(emberSize * 0.7, emberSize * 1.3);
        g.particles.push({
          x,
          y,
          vx: Math.cos(ang) * sp * 0.6,
          vy: Math.sin(ang) * sp,
          life,
          maxLife: emberLife,
          color: layout.tier === "wounded" ? "#ff9d48" : "#ffc06a",
          size,
          type: "fireEmber",
          textureVariant: pickBurjFireEmberVariant(x, y, life, size, anchor.seed),
          angle: ang + Math.PI / 2,
          spin: rand(-0.09, 0.09),
          gravity: 0.012,
          drag: 0.965,
        });
      });
    }

    const smokeAnchor = site.smokeAnchor;
    const smokeVyBoost = 1 + damageRatio * smokeRiseDamageBoost;
    const narrowSmokeW = halfW * 0.2;
    spawnPoisson(g, (smokeRate * dt * smokeKick * smokeBase) / totalSmokeSites, () => {
      const x = smokeAnchor.x + rand(-narrowSmokeW, narrowSmokeW);
      const y = smokeAnchor.y + smokeYOffset + rand(-4, 5);
      const life = rand(smokeLife * 0.7, smokeLife);
      const size = rand(smokeSize, smokeSize * 1.55);
      g.particles.push({
        x,
        y,
        vx: 0.035 + rand(smokeDrift * 0.35, smokeDrift),
        vy: -rand(smokeRise * 0.6, smokeRise) * smokeVyBoost,
        life,
        maxLife: smokeLife,
        color: layout.tier === "critical" ? "#8f969a" : layout.tier === "burning" ? "#9da1a3" : "#aeb0ae",
        size,
        type: "fireSmoke",
        textureVariant: pickBurjSmokeParticleVariant(x, y, life, size),
        angle: rand(-Math.PI, Math.PI),
        gravity: -0.004,
        drag: 0.992,
      });
    });

    spawnPoisson(g, (smokeRate * dt * smokeKick * 0.28) / totalSmokeSites, () => {
      const x = smokeAnchor.x + rand(-narrowSmokeW * 0.7, narrowSmokeW * 0.7);
      const y = smokeAnchor.y + smokeYOffset + rand(-2, 6);
      const life = rand(smokeLife * 0.18, smokeLife * 0.34);
      const size = rand(smokeSize * 0.7, smokeSize * 1.05);
      g.particles.push({
        x,
        y,
        vx: rand(smokeDrift * 0.12, smokeDrift * 0.45),
        vy: -rand(smokeRise * 0.35, smokeRise * 0.65) * smokeVyBoost,
        life,
        maxLife: smokeLife * 0.34,
        color: "#6c6260",
        size,
        type: "fireSmoke",
        textureVariant: pickBurjSmokeParticleVariant(x, y, life, size, 1),
        angle: rand(-Math.PI, Math.PI),
        gravity: -0.003,
        drag: 0.99,
      });
    });
  }
}

function spawnPoisson(g: GameState, expected: number, spawn: () => void): void {
  if (g.particles.length >= MAX_PARTICLES) return;
  let count = Math.floor(expected);
  if (rand(0, 1) < expected - count) count += 1;
  for (let i = 0; i < count; i += 1) {
    if (g.particles.length >= MAX_PARTICLES) return;
    spawn();
  }
}

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

let _burjDecalId = 0;
let _burjDamageFxId = 0;
let _buildingDestroyFxId = 0;
let _empFxId = 0;
const BURJ_INVULN_TICKS = 30;

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

function applyBurjHitDamage(
  g: GameState,
  x: number,
  y: number,
  kind: BurjDamageKind,
  onEvent?: ((type: string, data?: unknown) => void) | null,
): void {
  if (g._debugMode || !g.burjAlive) return;
  if (g.burjInvulnTimer > 0) return;
  addBurjImpactDamage(g, x, y, kind);
  g.burjHealth = 0;
  g.burjInvulnTimer = BURJ_INVULN_TICKS;
  if (onEvent) onEvent("sfx", { name: "burjHit" });
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

function isBurjImpactTarget(targetX: number | undefined, targetY: number | undefined): boolean {
  if (targetX === undefined || targetY === undefined) return false;
  const burjTop = getGameplayBurjCollisionTop(2);
  return (
    Math.abs(targetX - BURJ_X) <= 40 &&
    (targetY >= GAMEPLAY_SCENIC_THREAT_FLOOR_Y || (targetY >= burjTop && targetY <= GAMEPLAY_SCENIC_THREAT_FLOOR_Y))
  );
}

function updateBurjDamageFx(g: GameState): void {
  if (g.burjHitFlashTimer > 0) g.burjHitFlashTimer--;
  if (g.burjInvulnTimer > 0) g.burjInvulnTimer--;
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
  resetExplosionId();
  _burjDecalId = 0;
  _burjDamageFxId = 0;
  _buildingDestroyFxId = 0;
  _empFxId = 0;

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
    flareReadyThisWave: false,
    flareSalvoQueue: [],
    flareSalvoClaims: new Set(),
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

  return g as unknown as GameState;
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

export function spawnMirv(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
  return spawnMirvWithOverrides(g, undefined, onEvent);
}

function spawnMirvWithOverrides(
  g: GameState,
  overrides?: SpawnEntry["overrides"],
  onEvent?: ((type: string, data?: unknown) => void) | null,
) {
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

export function spawnPlane(
  g: GameState,
  onEvent?: ((type: string, data?: unknown) => void) | null,
  opts: SpawnPlaneOptions = {},
) {
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

function patriotTargetPriority(t: Threat): number {
  // MIRVs first (highest priority), then missiles and jet shaheds, then everything else
  if (t.type === "mirv") return 100;
  if (t.type === "stack3") return 88;
  if (t.type === "mirv_warhead") return 80;
  if (t.type === "stack2") return 72;
  if (t.type === "missile") return 60;
  if (t.type === "drone" && t.subtype === "shahed238") return 60;
  if (t.type === "drone" && (t.diving || t.diveTelegraphing)) return 55;
  if (t.type === "bomb") return 50;
  return 10;
}

const PATRIOT_TURN_RATE = [0.075, 0.095, 0.115];
const PATRIOT_RETARGET_MIN_DOT = 0.35;
const PATRIOT_LAUNCH_BIAS = 0.45;
const PATRIOT_LAUNCH_SPACING_TICKS = 18;
const PATRIOT_HOLD_TICKS = 72;
const PATRIOT_FOLLOWUP_TICKS = 90;
const PATRIOT_BURJ_URGENT_Y = 700;

function pickPatriotTargets(
  allThreats: Threat[],
  activePatriots: PatriotMissile[],
  count: number,
  extraReserved: Threat[] = [],
): Threat[] {
  const aliveThreats = allThreats.filter((t) => t.alive);
  if (aliveThreats.length === 0) return [];

  const reserved = new Set<Threat>(
    activePatriots.filter((p) => p.alive && p.targetRef?.alive).map((p) => p.targetRef!),
  );
  extraReserved.filter((t) => t.alive).forEach((t) => reserved.add(t));
  const spreadTargets = Array.from(reserved);
  const picked: Threat[] = [];

  const pickNext = (): Threat | null => {
    const sorted = [...aliveThreats]
      .filter((t) => !picked.includes(t) && !reserved.has(t))
      .map((t) => ({
        target: t,
        score: patriotTargetPriority(t) * 10 + t.y * 0.1 + getSpreadBonus(t, [...spreadTargets, ...picked], 360, 0.16),
      }))
      .sort((a, b) => b.score - a.score);
    return sorted[0]?.target ?? null;
  };

  while (picked.length < Math.min(count, aliveThreats.length)) {
    const next = pickNext();
    if (!next) break;
    picked.push(next);
  }

  return picked;
}

function isPatriotUrgentThreat(t: Threat): boolean {
  if (t.type === "mirv" || t.type === "stack3" || t.type === "mirv_warhead" || t.type === "stack2") return true;
  if (t.type === "drone" && (t.subtype === "shahed238" || t.diving || t.diveTelegraphing)) return true;
  if (t.type === "missile" && isBurjImpactTarget(t.targetX, t.targetY) && t.y >= PATRIOT_BURJ_URGENT_Y) return true;
  return false;
}

function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function getPatriotLaunchHeading(x: number, y: number, target: Threat): number {
  const targetHeading = Math.atan2(target.y - y, target.x - x);
  return normalizeAngle(-Math.PI / 2 + normalizeAngle(targetHeading + Math.PI / 2) * PATRIOT_LAUNCH_BIAS);
}

function getPatriotHeading(p: PatriotMissile): number {
  if (typeof p.heading === "number") return p.heading;
  const prev = p.trail[p.trail.length - 1];
  if (prev && (prev.x !== p.x || prev.y !== p.y)) {
    return Math.atan2(p.y - prev.y, p.x - prev.x);
  }
  if (p.targetRef) {
    return Math.atan2(p.targetRef.y - p.y, p.targetRef.x - p.x);
  }
  return -Math.PI / 2;
}

function launchPatriotMissile(
  g: GameState,
  target: Threat,
  blastRadius: number,
  onEvent?: ((type: string, data?: unknown) => void) | null,
): PatriotMissile {
  const patriotSite = getDefenseSitePlacement("patriot");
  const x = (patriotSite?.x ?? 334) + rand(-10, 10);
  const y = (patriotSite?.y ?? GROUND_Y) - 3;
  const missile: PatriotMissile = {
    x,
    y,
    targetRef: target,
    heading: getPatriotLaunchHeading(x, y, target),
    speed: rand(21, 25.5),
    trail: [],
    alive: true,
    blastRadius,
    wobble: rand(0, Math.PI * 2),
    life: 200,
  };
  g.patriotMissiles.push(missile);
  if (onEvent) onEvent("sfx", { name: "patriotLaunch" });
  return missile;
}

function schedulePatriotSalvo(
  g: GameState,
  targets: Threat[],
  blastRadius: number,
  onEvent?: ((type: string, data?: unknown) => void) | null,
): void {
  if (targets.length === 0 || g.patriotReserveShots <= 0) return;
  const shots = targets.slice(0, g.patriotReserveShots);
  for (let i = 0; i < shots.length; i++) {
    g.patriotLaunchQueue.push({
      delay: PATRIOT_LAUNCH_SPACING_TICKS * i,
      targetRef: shots[i],
      blastRadius,
    });
  }
  g.patriotReserveShots = Math.max(0, g.patriotReserveShots - shots.length);
  g.patriotHoldTimer = 0;
  g.patriotFollowupTimer =
    g.patriotReserveShots > 0
      ? PATRIOT_FOLLOWUP_TICKS + PATRIOT_LAUNCH_SPACING_TICKS * Math.max(0, shots.length - 1)
      : 0;
  drainPatriotLaunchQueue(g, 0, targets, onEvent);
}

function drainPatriotLaunchQueue(
  g: GameState,
  dt: number,
  allThreats: Threat[],
  onEvent?: ((type: string, data?: unknown) => void) | null,
): void {
  if (g.patriotLaunchQueue.length === 0) return;

  const waiting: PatriotLaunchQueueItem[] = [];
  for (const queued of g.patriotLaunchQueue) {
    const delay = Math.max(0, queued.delay - dt);
    if (delay > 0) {
      waiting.push({ ...queued, delay });
      continue;
    }

    const fallbackTarget = queued.targetRef.alive
      ? queued.targetRef
      : pickPatriotTargets(allThreats, g.patriotMissiles, 1)[0];
    if (fallbackTarget?.alive) {
      launchPatriotMissile(g, fallbackTarget, queued.blastRadius, onEvent);
    }
  }
  g.patriotLaunchQueue = waiting;
}

function updatePatriotBattery(
  g: GameState,
  dt: number,
  allThreats: Threat[],
  onEvent?: ((type: string, data?: unknown) => void) | null,
): void {
  const lvl = g.upgrades.patriot;
  const interval = [480, 360, 300][lvl - 1];
  const capacity = [2, 3, 4][lvl - 1];
  const blastR = [84, 108, 132][lvl - 1];

  drainPatriotLaunchQueue(g, dt, allThreats, onEvent);

  if (g.patriotReserveShots > 0 && g.patriotFollowupTimer > 0) {
    g.patriotFollowupTimer = Math.max(0, g.patriotFollowupTimer - dt);
    if (g.patriotFollowupTimer <= 0 && g.patriotLaunchQueue.length === 0) {
      g.patriotReserveShots = 0;
      g.patriotHoldTimer = 0;
      g.patriotTimer = 0;
      return;
    }
  }

  if (g.patriotLaunchQueue.length > 0) return;

  if (g.patriotReserveShots <= 0 && g.patriotLaunchQueue.length === 0) {
    g.patriotTimer += dt;
    if (g.patriotTimer >= interval) {
      g.patriotTimer = 0;
      g.patriotReserveShots = capacity;
      g.patriotHoldTimer = 0;
      g.patriotFollowupTimer = 0;
    }
  }

  if (g.patriotReserveShots <= 0) return;

  const queuedTargets = g.patriotLaunchQueue.map((queued) => queued.targetRef);
  const targets = pickPatriotTargets(allThreats, g.patriotMissiles, g.patriotReserveShots, queuedTargets);
  if (targets.length === 0) return;

  if (g.patriotFollowupTimer > 0) {
    schedulePatriotSalvo(g, targets.slice(0, 1), blastR, onEvent);
    return;
  }

  const shouldFireNow = targets.length >= g.patriotReserveShots || targets.some(isPatriotUrgentThreat);
  if (shouldFireNow) {
    schedulePatriotSalvo(g, targets, blastR, onEvent);
    return;
  }

  if (g.patriotHoldTimer <= 0) {
    g.patriotHoldTimer = PATRIOT_HOLD_TICKS;
    return;
  }

  g.patriotHoldTimer = Math.max(0, g.patriotHoldTimer - dt);
  if (g.patriotHoldTimer <= 0) {
    schedulePatriotSalvo(g, targets, blastR, onEvent);
  }
}

function patriotAlignmentFromHeading(p: PatriotMissile, target: Threat, heading: number): number {
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return (dx / d) * Math.cos(heading) + (dy / d) * Math.sin(heading);
}

function pickPatriotRetargetTarget(
  p: PatriotMissile,
  allThreats: Threat[],
  activePatriots: PatriotMissile[],
): Threat | null {
  const heading = getPatriotHeading(p);
  const reserved = new Set<Threat>(
    activePatriots.filter((other) => other.alive && other.targetRef?.alive).map((other) => other.targetRef!),
  );
  const candidates = allThreats
    .filter((t) => t.alive)
    .map((target) => {
      const alignment = patriotAlignmentFromHeading(p, target, heading);
      return {
        target,
        alignment,
        reserved: reserved.has(target),
        score: patriotTargetPriority(target) * 10 + target.y * 0.1 + alignment * 180,
      };
    })
    .filter((candidate) => candidate.alignment >= PATRIOT_RETARGET_MIN_DOT)
    .sort((a, b) => {
      if (a.reserved !== b.reserved) return a.reserved ? 1 : -1;
      return b.score - a.score;
    });

  return candidates[0]?.target ?? null;
}

function isFlareMissileTarget(m: Missile): boolean {
  return m.alive && !m.luredByFlare && !m.redirected;
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

function launchFlareSalvo(g: GameState, count: number, opts: { fanWidth?: number } = {}): Flare[] {
  const originY = ov("upgrade.flares.y", 837);
  const fanWidth = opts.fanWidth ?? 520;
  const flareLife = ov("flare.flareLife", 150);
  const spawned: Flare[] = [];
  const safeCount = Math.max(1, Math.round(count));
  const fanAngle = ov("flare.fanAngle", Math.PI * 0.78);
  const ejectSpeed = ov("flare.ejectSpeed", 3.6);
  const flareDrag = ov("flare.drag", 0.993);
  for (let i = 0; i < safeCount; i++) {
    const t = safeCount === 1 ? 0.5 : i / (safeCount - 1);
    const centered = t - 0.5;
    const angle = centered * fanAngle + rand(-0.07, 0.07);
    const speed = ejectSpeed * rand(0.85, 1.15);
    const vx = Math.sin(angle) * speed;
    const vy = -Math.cos(angle) * speed;
    void fanWidth;
    const flare: Flare = {
      id: g.nextFlareId++,
      x: BURJ_X + rand(-6, 6),
      y: originY + rand(-4, 4),
      vx,
      vy,
      anchorX: BURJ_X,
      drag: flareDrag,
      life: flareLife,
      maxLife: flareLife,
      alive: true,
      luresLeft: 999,
      hotRadius: 60,
      trail: [],
    };
    g.flares.push(flare);
    spawned.push(flare);
  }
  return spawned;
}

function nearestFlareForThreat(threat: Threat, flares: Flare[]): Flare | null {
  let best: Flare | null = null;
  let bestDist = Infinity;
  for (const flare of flares) {
    if (!flare.alive) continue;
    const d = dist(threat.x, threat.y, flare.x, flare.y);
    if (d < bestDist) {
      bestDist = d;
      best = flare;
    }
  }
  return best;
}

function spawnFlareLureSparks(g: GameState, x: number, y: number): void {
  for (let i = 0; i < 5; i++) {
    g.particles.push({
      x,
      y,
      vx: rand(-1.5, 1.5),
      vy: rand(-1.5, 1.5),
      life: 20,
      maxLife: 20,
      color: "#ffaa44",
      size: 1.5,
    });
  }
}

function applyFlareLurePass(
  g: GameState,
  flares: Flare[],
  opts: { centerX: number; centerY: number; radius: number },
): void {
  for (const m of g.missiles) {
    if (!isFlareMissileTarget(m)) continue;
    if (dist(m.x, m.y, opts.centerX, opts.centerY) > opts.radius) continue;
    const nearFlare = nearestFlareForThreat(m, flares);
    if (!nearFlare) continue;
    m.luredByFlare = true;
    m.flareTargetId = nearFlare.id;
    steerTowardPoint(m, nearFlare.x, nearFlare.y, 8, 0.5);
    spawnFlareLureSparks(g, m.x, m.y);
  }
  for (const d of g.drones) {
    if (!d.alive || d.luredByFlare || d.redirected) continue;
    if (dist(d.x, d.y, opts.centerX, opts.centerY) > opts.radius) continue;
    const nearFlare = nearestFlareForThreat(d, flares);
    if (!nearFlare) continue;
    d.luredByFlare = true;
    d.flareTargetId = nearFlare.id;
    d.lureDeathTimer = 200;
    steerTowardPoint(d, nearFlare.x, nearFlare.y, 8, 0.5);
    spawnFlareLureSparks(g, d.x, d.y);
  }
}

function applyFlareTickLure(g: GameState): void {
  if (g.flares.length === 0) return;
  const radius = ov("flare.tickLureRadius", 200);
  const radiusSq = radius * radius;
  for (const m of g.missiles) {
    if (!isFlareMissileTarget(m)) continue;
    let best: Flare | null = null;
    let bestSq = radiusSq;
    for (const f of g.flares) {
      if (!f.alive) continue;
      const dx = m.x - f.x;
      const dy = m.y - f.y;
      const dsq = dx * dx + dy * dy;
      if (dsq < bestSq) {
        bestSq = dsq;
        best = f;
      }
    }
    if (!best) continue;
    m.luredByFlare = true;
    m.flareTargetId = best.id;
    steerTowardPoint(m, best.x, best.y, 8, 0.5);
    spawnFlareLureSparks(g, m.x, m.y);
  }
  for (const d of g.drones) {
    if (!d.alive || d.luredByFlare || d.redirected) continue;
    let best: Flare | null = null;
    let bestSq = radiusSq;
    for (const f of g.flares) {
      if (!f.alive) continue;
      const dx = d.x - f.x;
      const dy = d.y - f.y;
      const dsq = dx * dx + dy * dy;
      if (dsq < bestSq) {
        bestSq = dsq;
        best = f;
      }
    }
    if (!best) continue;
    d.luredByFlare = true;
    d.flareTargetId = best.id;
    d.lureDeathTimer = 200;
    steerTowardPoint(d, best.x, best.y, 8, 0.5);
    spawnFlareLureSparks(g, d.x, d.y);
  }
}

function collectAirborneThreats(g: GameState, out: Array<Missile | Drone>): void {
  for (const m of g.missiles) if (m.alive) out.push(m);
  for (const d of g.drones) if (d.alive) out.push(d);
}

function aimThreatAtPoint(threat: Threat, x: number, y: number, speedMul = 1): void {
  const dx = x - threat.x;
  const dy = y - threat.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = Math.max(0.001, Math.sqrt(threat.vx * threat.vx + threat.vy * threat.vy) * speedMul);
  threat.vx = (dx / len) * speed;
  threat.vy = (dy / len) * speed;
}

function tryRedirectFlareThreat(g: GameState, attacker: Missile | Drone): boolean {
  if (g.upgrades.flare < 2 || attacker.redirected === true) return false;
  const candidateCap = Math.max(1, Math.round(ov("flare.redirectCandidates", 3)));
  const pool: Array<Missile | Drone> = [];
  collectAirborneThreats(g, pool);
  const candidates = pool
    .filter((target) => target !== attacker && !g.flareSalvoClaims.has(target))
    .sort((a, b) => dist(attacker.x, attacker.y, a.x, a.y) - dist(attacker.x, attacker.y, b.x, b.y))
    .slice(0, candidateCap);
  if (candidates.length === 0) return false;
  const chosen = candidates[Math.floor(getRng()() * candidates.length)];
  g.flareSalvoClaims.add(chosen);
  attacker.redirectTarget = chosen;
  attacker.redirected = true;
  attacker.luredByFlare = false;
  attacker.flareTargetId = undefined;
  aimThreatAtPoint(attacker, chosen.x, chosen.y, ov("flare.redirectSpeedMul", 1.4));
  return true;
}

function destroyRedirectedThreat(g: GameState, threat: Missile | Drone): void {
  if (!threat.alive) return;
  threat.alive = false;
  g.score += getKillReward(threat) * g.combo;
  recordThreatDestroyed(g, threat);
}

function consumeThreatAtFlare(
  g: GameState,
  threat: Missile | Drone,
  flare: Flare | null,
  onEvent: ((type: string, data?: unknown) => void) | null | undefined,
): void {
  const x = flare ? flare.x : threat.x;
  const y = flare ? flare.y : threat.y;
  if (flare) flare.alive = false;
  destroyRedirectedThreat(g, threat);
  threat.redirected = false;
  threat.redirectTarget = undefined;
  threat.luredByFlare = false;
  threat.flareTargetId = undefined;
  boom(g, x, y, 65, COL.flare, true, onEvent, 15);
}

function reaimRedirectedThreat(g: GameState, attacker: Missile | Drone, pool: Array<Missile | Drone>): boolean {
  let best: Missile | Drone | null = null;
  let bestDist = Infinity;
  for (const candidate of pool) {
    if (candidate === attacker || g.flareSalvoClaims.has(candidate)) continue;
    const d = dist(attacker.x, attacker.y, candidate.x, candidate.y);
    if (d > 80 || d >= bestDist) continue;
    best = candidate;
    bestDist = d;
  }
  if (!best) return false;
  g.flareSalvoClaims.add(best);
  attacker.redirectTarget = best;
  aimThreatAtPoint(attacker, best.x, best.y, ov("flare.redirectSpeedMul", 1.4));
  return true;
}

function updateRedirectedProjectiles(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null): void {
  const pool: Array<Missile | Drone> = [];
  collectAirborneThreats(g, pool);
  const impactRadius = ov("flare.redirectAOE", 45);
  for (const attacker of pool) {
    if (attacker.redirected !== true || !attacker.alive) continue;
    const target = attacker.redirectTarget;
    if (!target || !target.alive) {
      if (!reaimRedirectedThreat(g, attacker, pool)) consumeThreatAtFlare(g, attacker, null, onEvent);
      continue;
    }
    aimThreatAtPoint(attacker, target.x, target.y, 1);
    if (dist(attacker.x, attacker.y, target.x, target.y) > impactRadius) continue;
    const x = (attacker.x + target.x) / 2;
    const y = (attacker.y + target.y) / 2;
    destroyRedirectedThreat(g, attacker);
    destroyRedirectedThreat(g, target);
    boom(g, x, y, impactRadius, COL.flare, true, onEvent, impactRadius * 0.55, {
      visualType: target.type === "drone" ? "drone" : "missile",
    });
    const rootEx = g.explosions[g.explosions.length - 1];
    if (rootEx) {
      rootEx.kills = (rootEx.kills ?? 0) + 2;
      rootEx.heroPulse = Math.min(1.6, 0.65 + rootEx.kills * 0.18);
    }
  }
}

function updateFlareSalvoQueue(g: GameState): void {
  if (g.flareSalvoQueue.length === 0) {
    const redirectedThreats =
      g.missiles.some((m) => m.redirected && m.alive) || g.drones.some((d) => d.redirected && d.alive);
    if (!g.flares.some((flare) => flare.alive) && !redirectedThreats) g.flareSalvoClaims.clear();
    return;
  }
  const ready = g.flareSalvoQueue.filter((drop) => drop.fireAt <= g.waveTick);
  g.flareSalvoQueue = g.flareSalvoQueue.filter((drop) => drop.fireAt > g.waveTick);
  for (const drop of ready) {
    const flares = launchFlareSalvo(g, drop.count);
    applyFlareLurePass(g, flares, {
      centerX: BURJ_X,
      centerY: ov("upgrade.flares.y", 837),
      radius: ov("flare.lureRadius", 600),
    });
  }
}

const EMP_SHAKE_TIMER = 22;
const EMP_SHAKE_INTENSITY = 14;
const EMP_SCRUB_TICKS = 7;
const EMP_GLITCH_TICKS = 12;
const EMP_ZOOM_TICKS = 10;
const EMP_RING_SPEED_INITIAL = 40;
const EMP_RING_SPEED_MID = 25;
const EMP_RING_SPEED_TAIL = 12;
const EMP_RING_LAYERS: ReadonlyArray<{
  visualRole: NonNullable<EmpRing["visualRole"]>;
  tint: number;
  radiusMul: number;
  ageOffset: number;
  damages: boolean;
}> = [
  { visualRole: "core", tint: 0xffffff, radiusMul: 1, ageOffset: 0, damages: true },
  { visualRole: "cyan", tint: 0x66ddff, radiusMul: 0.92, ageOffset: -2, damages: false },
  { visualRole: "magenta", tint: 0xff66ff, radiusMul: 0.84, ageOffset: -4, damages: false },
];

function empScrubScale(remainingTicks: number): number {
  if (remainingTicks <= 0) return 1;
  if (remainingTicks > 4) return 0;
  return 0.25;
}

function empRingExpansionSpeed(age: number): number {
  if (age <= 3) return EMP_RING_SPEED_INITIAL;
  if (age <= 8) return EMP_RING_SPEED_MID;
  return EMP_RING_SPEED_TAIL;
}

function updateEmpVisualFx(g: GameState, dt: number): void {
  if (g.empScrubTicks > 0) g.empScrubTicks = Math.max(0, g.empScrubTicks - dt);
  if (g.empGlitchTimer > 0) g.empGlitchTimer = Math.max(0, g.empGlitchTimer - dt);
  if (g.empZoomTimer > 0) g.empZoomTimer = Math.max(0, g.empZoomTimer - dt);
  g.empArcs.forEach((arc) => {
    arc.life -= dt;
    arc.alive = arc.life > 0;
  });
  g.empBurstFlashes.forEach((flash) => {
    flash.life -= dt;
    flash.alive = flash.life > 0;
  });
  g.empLauncherFlares.forEach((flare) => {
    flare.life -= dt;
    flare.alive = flare.life > 0;
  });
  g.empArcs = g.empArcs.filter((arc) => arc.alive !== false);
  g.empBurstFlashes = g.empBurstFlashes.filter((flash) => flash.alive !== false);
  g.empLauncherFlares = g.empLauncherFlares.filter((flare) => flare.alive !== false);
}

function spawnEmpKillBurst(g: GameState, x: number, y: number, originX: number, originY: number): void {
  const seedBase = _empFxId + x * 17 + y * 31 + originX * 7 + originY * 3;
  g.empBurstFlashes.push({
    id: _empFxId++,
    x,
    y,
    life: 4,
    maxLife: 4,
    seed: seedBase,
    alive: true,
  });
  g.empArcs.push({
    id: _empFxId++,
    x1: originX,
    y1: originY,
    x2: x,
    y2: y,
    life: 5,
    maxLife: 5,
    seed: seedBase + 101,
    alive: true,
  });

  const _rng = getRng();
  const sparkCount = Math.min(15, MAX_PARTICLES - g.particles.length);
  for (let i = 0; i < sparkCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(2, 7);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(20, 50),
      maxLife: 50,
      color: _rng() > 0.4 ? "#cc44ff" : _rng() > 0.5 ? "#aa66ff" : "#ffffff",
      size: rand(1.5, 4),
    });
  }
}

function pushEmpRingBurst(
  g: GameState,
  base: Omit<EmpRing, "alpha" | "alive" | "hitSet" | "age" | "visualRole" | "tint" | "radiusMul"> & {
    kind: NonNullable<EmpRing["kind"]>;
  },
): void {
  for (const layer of EMP_RING_LAYERS) {
    g.empRings.push({
      ...base,
      damage: layer.damages ? base.damage : 0,
      age: layer.ageOffset,
      visualRole: layer.visualRole,
      tint: layer.tint,
      radiusMul: layer.radiusMul,
      hitSet: new Set(),
      alive: true,
      alpha: 1,
    });
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
            speed: rand(3.73, 5.6),
            trail: [],
            alive: true,
            blastRadius: blastR,
            wobble: rand(0, Math.PI * 2),
            life: 240,
            maxLife: 240,
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
  updateFlareSalvoQueue(g);
  const flareGravity = ov("flare.gravity", 0.024);
  const flareTrailMax = Math.max(4, Math.round(ov("flare.trailLength", 22)));
  g.flares.forEach((f) => {
    if (!f.alive) return;
    f.trail.push({ x: f.x, y: f.y });
    if (f.trail.length > flareTrailMax) f.trail.shift();
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vy += flareGravity * dt;
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
  g.flares = g.flares.filter((f) => f.alive);
  applyFlareTickLure(g);

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
    updatePatriotBattery(g, dt, allThreats, onEvent);
  } else {
    g.patriotLaunchQueue = [];
    g.patriotReserveShots = 0;
    g.patriotHoldTimer = 0;
    g.patriotFollowupTimer = 0;
  }
  // Patriot in-flight update — guided SAM with limited steering.
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
      const best = pickPatriotRetargetTarget(
        p,
        allThreats,
        g.patriotMissiles.filter((other: PatriotMissile) => other !== p),
      );
      if (best) {
        p.targetRef = best;
      } else {
        // No acceptable threat in the seeker cone; keep flying until life expires.
        p.heading = getPatriotHeading(p);
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 18) p.trail.shift();
        p.x += Math.cos(p.heading) * p.speed * dt;
        p.y += Math.sin(p.heading) * p.speed * dt;
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
    const desiredHeading = Math.atan2(ply - p.y, plx - p.x);
    const currentHeading = getPatriotHeading(p);
    const headingDelta = normalizeAngle(desiredHeading - currentHeading);
    const turnRate = PATRIOT_TURN_RATE[Math.max(0, Math.min(PATRIOT_TURN_RATE.length - 1, g.upgrades.patriot - 1))];
    const maxTurn = turnRate * dt;
    const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
    p.heading = normalizeAngle(currentHeading + appliedTurn);
    p.x += (Math.cos(p.heading) * p.speed + Math.sin(p.wobble) * 0.6) * dt;
    p.y += (Math.sin(p.heading) * p.speed + Math.cos(p.wobble) * 0.4) * dt;
  });
  g.patriotMissiles = g.patriotMissiles.filter((p) => p.alive);

  // ── EMP SHOCKWAVE ── (charging is handled in update() before waveComplete check)
  if (g.empRings.length > 0) {
    // Update active rings
    g.empRings.forEach((ring) => {
      ring.age = (ring.age ?? 0) + dt;
      if (ring.age > 0) {
        ring.radius += empRingExpansionSpeed(ring.age) * (ring.expandRate ?? 1) * dt;
      }
      const effectiveMaxRadius = ring.maxRadius * (ring.radiusMul ?? 1);
      if (ring.radius > effectiveMaxRadius) {
        ring.alive = false;
        return;
      }
      ring.alpha = 1 - ring.radius / effectiveMaxRadius;
      if ((ring.damage ?? 0) <= 0 || ring.age <= 0) return;
      // Damage threats in the ring band
      const bandInner = ring.radius - 15;
      const bandOuter = ring.radius + 15;
      allThreats.forEach((t) => {
        if (!t.alive || ring.hitSet?.has(t)) return;
        const d = dist(t.x, t.y, ring.x, ring.y);
        if (d >= bandInner && d <= bandOuter) {
          ring.hitSet?.add(t);
          damageTarget(g, t, ring.damage ?? 0, COL.emp, 20, { noExplosion: true });
          spawnEmpKillBurst(g, t.x, t.y, ring.x, ring.y);
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
          if (!tryRedirectFlareThreat(g, m)) consumeThreatAtFlare(g, m, flareTarget, onEvent);
          else flareTarget.alive = false;
          return;
        }
      } else {
        // Flare already exploded — missile lost guidance, harmless self-destruct
        m.alive = false;
        recordThreatDestroyed(g, m);
        boom(g, m.x, m.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
        return;
      }
    }
    const stepX = m.vx * dt;
    const stepY = m.vy * dt;
    m.x += stepX;
    m.y += stepY;
    if (m.type === "stack2" || m.type === "stack3") {
      m.travelDist = (m.travelDist ?? 0) + Math.sqrt(stepX * stepX + stepY * stepY);
    }
    if (m.luredByFlare) {
      const flareTarget = getLiveFlare(g, m.flareTargetId);
      if (flareTarget && dist(m.x, m.y, flareTarget.x, flareTarget.y) <= flareTarget.hotRadius) {
        if (!tryRedirectFlareThreat(g, m)) consumeThreatAtFlare(g, m, flareTarget, onEvent);
        else flareTarget.alive = false;
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
          if (!tryRedirectFlareThreat(g, d)) consumeThreatAtFlare(g, d, flareTarget, onEvent);
          else flareTarget.alive = false;
          return;
        }
      } else {
        // Flare already exploded — lost guidance, harmless self-destruct
        d.alive = false;
        recordThreatDestroyed(g, d);
        boom(g, d.x, d.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
        return;
      }
      if ((d.lureDeathTimer ?? 0) > 0) {
        d.lureDeathTimer = (d.lureDeathTimer ?? 0) - dt;
        if ((d.lureDeathTimer ?? 0) <= 0) {
          d.alive = false;
          recordThreatDestroyed(g, d);
          boom(g, d.x, d.y, 15, COL.flare, false, onEvent, 0, { harmless: true });
          return;
        }
      }
    }
    d.wobble += 0.05 * dt;
    if (d.waypoints && d.waypoints.length >= 2) {
      // Follow precomputed trajectory (skip when lured by flare)
      if (!d.waypoints || d.waypoints.length < 2) {
        d.alive = false;
        return;
      }
      if (d.luredByFlare) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
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
        const burjTop = getGameplayBurjCollisionTop(2);
        const targetY = d.diveTarget.y;
        const targetIsBurj =
          g.burjAlive &&
          Math.abs(d.diveTarget.x - BURJ_X) <= Math.max(36, d.collisionRadius) &&
          (targetY >= GAMEPLAY_SCENIC_THREAT_FLOOR_Y ||
            (targetY >= burjTop && targetY <= GAMEPLAY_SCENIC_THREAT_FLOOR_Y));
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

function didPlayerInterceptorReachTarget(ic: Interceptor, prevX: number, prevY: number): boolean {
  if (dist(ic.x, ic.y, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_DETONATE_RADIUS) return true;
  const segX = ic.x - prevX;
  const segY = ic.y - prevY;
  const lenSq = segX * segX + segY * segY;
  if (lenSq <= 0) return false;
  const t = Math.max(0, Math.min(1, ((ic.targetX - prevX) * segX + (ic.targetY - prevY) * segY) / lenSq));
  const closestX = prevX + segX * t;
  const closestY = prevY + segY * t;
  return dist(closestX, closestY, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_DETONATE_RADIUS;
}

function updateInterceptors(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
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
    }
    // Proximity fuse: detonate early if passing close to any threat
    const canProximityFuseNearTarget =
      dist(ic.x, ic.y, ic.targetX, ic.targetY) <= INTERCEPTOR_TARGET_GATED_PROXIMITY_RADIUS;
    if (!detonate && !ic.fromF15 && INTERCEPTOR_THREAT_PROXIMITY_FUSE_ENABLED && canProximityFuseNearTarget) {
      const fuseRadius = 72;
      for (const m of g.missiles) {
        if (m.alive && !isThreatDoomedByActiveExplosion(g, m) && dist(ic.x, ic.y, m.x, m.y) < fuseRadius) {
          detonate = true;
          break;
        }
      }
      if (!detonate) {
        for (const d of g.drones) {
          if (d.alive && !isThreatDoomedByActiveExplosion(g, d) && dist(ic.x, ic.y, d.x, d.y) < fuseRadius) {
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
              recordThreatDestroyed(g, m);
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
          recordThreatDestroyed(g, m);
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
            recordThreatDestroyed(g, d);
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

export function update(g: GameState, dt: number, onEvent?: ((type: string, data?: unknown) => void) | null) {
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
    if ((g.waveClearedTimer ?? 0) <= 0) {
      // Emit bonus screen event once, then wait for it to finish before opening shop
      if (!g._bonusScreenStarted) {
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
        } else {
          g._bonusScreenDone = true;
        }
      }
      if (!g.shopOpened && g._bonusScreenDone) {
        g.shopOpened = true;
        if (g.burjAlive) {
          recordWaveSummary(g);
          g.state = "shop";
          // Draft pick consumes seeded RNG here so replay stays in sync
          if (g._draftMode) {
            g._draftOffers = draftPick3(g, g._debugUpgradeForceShowFamilies ?? []);
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
    g._waveSummaryRecorded = false;
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
  updateRedirectedProjectiles(g, onEvent);
  updateInterceptors(g, dt, onEvent);
  updateExplosions(g, dt, onEvent);
  updatePlanes(g, dt, allThreats, onEvent);
  updateBurjFireParticles(g, dt);

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
  processRootExplosionCombo(g);

  // Cleanup
  g.missiles = g.missiles.filter((m) => m.alive);
  g.drones = g.drones.filter((d) => d.alive);
  g.interceptors = g.interceptors.filter((ic) => ic.alive);
  g.explosions = g.explosions.filter((ex) => ex.alpha > 0);
  g.particles = g.particles.filter((p) => p.life > 0);
  g.planes = g.planes.filter((p) => p.alive);
}

const EMP_BURJ_X = 462;
const EMP_BURJ_Y = 1047;
const EMP_BURJ_MAX_RADIUS = [650, 1040];
const EMP_LAUNCHER_MAX_RADIUS = 500;
const EMP_RANK2_EXPAND_RATE = 1.5;

export function fireFlareSalvo(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
  if (!g.flareReadyThisWave || g.upgrades.flare <= 0) return false;
  const lvl = g.upgrades.flare;
  const originY = ov("upgrade.flares.y", 837);
  const lureRadius = ov("flare.lureRadius", 600);
  g.flareReadyThisWave = false;
  g.flareSalvoClaims = new Set();

  const isL2 = lvl >= 2;
  const dropCount = Math.max(1, Math.round(ov(isL2 ? "flare.salvoCountL2" : "flare.salvoCountL1", isL2 ? 6 : 3)));
  const drops = Math.max(1, Math.round(ov(isL2 ? "flare.salvoDropsL2" : "flare.salvoDropsL1", 3)));
  const spacing = Math.max(
    1,
    Math.round(ov(isL2 ? "flare.salvoSpacingTicksL2" : "flare.salvoSpacingTicksL1", isL2 ? 60 : 30)),
  );
  const initial = launchFlareSalvo(g, dropCount);
  applyFlareLurePass(g, initial, { centerX: BURJ_X, centerY: originY, radius: lureRadius });
  g.flareSalvoQueue = Array.from({ length: Math.max(0, drops - 1) }, (_, i) => ({
    fireAt: g.waveTick + spacing * (i + 1),
    count: dropCount,
  }));
  if (isL2) {
    const ammoCap = getAmmoCapacity(g.wave, g.upgrades.launcherKit);
    for (let i = 0; i < LAUNCHERS.length; i++) {
      if (g.launcherHP[i] > 0) g.ammo[i] = ammoCap;
    }
  }

  if (onEvent) onEvent("sfx", { name: "flareLaunch" });
  return true;
}

export function fireEmp(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
  if (!g.empReadyThisWave || g.upgrades.emp <= 0) return false;
  const lvl = g.upgrades.emp;
  g.empReadyThisWave = false;
  const expandRate = lvl >= 2 ? EMP_RANK2_EXPAND_RATE : 1;
  pushEmpRingBurst(g, {
    kind: "burj",
    x: EMP_BURJ_X,
    y: EMP_BURJ_Y,
    radius: 0,
    maxRadius: EMP_BURJ_MAX_RADIUS[lvl - 1],
    damage: lvl,
    expandRate,
  });
  if (lvl >= 2) {
    const ammoCap = getAmmoCapacity(g.wave, g.upgrades.launcherKit);
    for (let i = 0; i < LAUNCHERS.length; i++) {
      if (g.launcherHP[i] <= 0) continue;
      pushEmpRingBurst(g, {
        kind: "launcher",
        x: LAUNCHERS[i].x,
        y: GAMEPLAY_SCENIC_LAUNCHER_Y,
        radius: 0,
        maxRadius: EMP_LAUNCHER_MAX_RADIUS,
        damage: lvl,
        expandRate,
      });
      g.empLauncherFlares.push({
        id: _empFxId++,
        x: LAUNCHERS[i].x,
        y: GAMEPLAY_SCENIC_LAUNCHER_Y,
        life: 6,
        maxLife: 6,
        seed: _empFxId + LAUNCHERS[i].x * 13 + GAMEPLAY_SCENIC_LAUNCHER_Y,
        alive: true,
      });
      g.ammo[i] = ammoCap;
    }
  }
  applyShake(g, EMP_SHAKE_TIMER, EMP_SHAKE_INTENSITY);
  g.empScrubTicks = Math.max(g.empScrubTicks, EMP_SCRUB_TICKS);
  g.empGlitchTimer = EMP_GLITCH_TICKS;
  g.empGlitchMax = EMP_GLITCH_TICKS;
  g.empZoomTimer = EMP_ZOOM_TICKS;
  g.empZoomMax = EMP_ZOOM_TICKS;
  if (onEvent) onEvent("sfx", { name: "empBlast" });
  return true;
}

function spawnF15Formation(
  g: GameState,
  goRight: boolean,
  lvl: number,
  onEvent: ((type: string, data?: unknown) => void) | null | undefined,
) {
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

export function fireF15Pair(g: GameState, onEvent?: ((type: string, data?: unknown) => void) | null) {
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

export {
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  draftPick3,
  grantReplayUpgrade,
  repairLauncher,
  repairSite,
} from "./game-sim-shop.js";
