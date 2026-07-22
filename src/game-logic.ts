import {
  DESTROYED_TYPE_KEYS,
  shahed136HasDive,
  type RNG,
  type StatefulRNG,
  type GameState,
  type DefenseSite,
  type Threat,
  type Missile,
  type Drone,
  type Building,
  type ExplosionVisualType,
  type UpgradeNodeId,
  type DestroyedByTypeStats,
  type DestroyedTypeKey,
  type GameStats,
} from "./types";
import { getFireChargeCount, spendFireCharge, syncFireChargeState } from "./player-fire-limiter";
import { getExplosionParticleVariantId, getWhiteSmokeParticleVariantId } from "./smoke-particle-assets";

export const CANVAS_W = 900;
export const CANVAS_H = 1600;
export const GROUND_Y = 1530;
export const CITY_Y = GROUND_Y;
export const GAMEPLAY_SCENIC_GROUND_Y = GROUND_Y - 120;
export const GAMEPLAY_SCENIC_BASE_Y = GAMEPLAY_SCENIC_GROUND_Y - 6;
export const GAMEPLAY_SCENIC_LAUNCHER_Y = GROUND_Y - 138;
export const WATER_SURFACE_OFFSET = 8;
export const GAMEPLAY_WATERLINE_Y = GAMEPLAY_SCENIC_GROUND_Y + WATER_SURFACE_OFFSET;
export const GAMEPLAY_SCENIC_THREAT_FLOOR_Y = GAMEPLAY_SCENIC_GROUND_Y + 6;
export const GAMEPLAY_SUPPORT_SITE_Y = GAMEPLAY_SCENIC_GROUND_Y - 2;
export const BURJ_MAX_HEALTH = 7;
export const EMP_RING_SPEED_INITIAL = 40;
export const EMP_RING_SPEED_MID = 25;
export const EMP_RING_SPEED_TAIL = 12;
export const INTERCEPTOR_TAP_FUSE_RADIUS = 72;
export const INTERCEPTOR_SOLO_TAP_FUSE_RADIUS = 144;

export const COL = {
  sky1: "#0a0e1a",
  sky2: "#1a1040",
  sky3: "#2a1050",
  ground: "#1a1a2e",
  sand: "#2d2845",
  burj: "#c0c8d8",
  burjGlow: "#4488ff",
  building: "#1a2040",
  buildingLit: "#ffdd66",
  missile: "#ff3333",
  drone: "#ff6600",
  interceptor: "#c8f0ff",
  explosion: "#ffaa00",
  plane: "#ffffff",
  planeLight: "#ff0000",
  text: "#ffffff",
  hud: "#00ffcc",
  warning: "#ff4444",
  gold: "#ffd700",
  upgradeBg: "#0c1225",
  panelBg: "#111a30",
  panelBorder: "#1a3060",
  laser: "#ff2200",
  flare: "#ff8833",
  hornet: "#ffcc00",
  roadrunner: "#44aaff",
  phalanx: "#ff8844",
  patriot: "#88ff44",
  launcherKit: "#66aaff",
  emp: "#cc44ff",
  mirv: "#dd4422",
};

export function createEmptyDestroyedByTypeStats(): DestroyedByTypeStats {
  return Object.fromEntries(DESTROYED_TYPE_KEYS.map((key) => [key, 0])) as DestroyedByTypeStats;
}

export function cloneDestroyedByTypeStats(stats?: Partial<DestroyedByTypeStats>): DestroyedByTypeStats {
  return {
    ...createEmptyDestroyedByTypeStats(),
    ...(stats ?? {}),
  };
}

export function createEmptyGameStats(): GameStats {
  return {
    missileKills: 0,
    droneKills: 0,
    shotsFired: 0,
    destroyedByType: createEmptyDestroyedByTypeStats(),
    multiShots: 0,
    maxCombo: 1,
  };
}

export function normalizeGameStats(stats: Partial<GameStats>): GameStats {
  return {
    missileKills: stats.missileKills ?? 0,
    droneKills: stats.droneKills ?? 0,
    shotsFired: stats.shotsFired ?? 0,
    destroyedByType: cloneDestroyedByTypeStats(stats.destroyedByType),
    multiShots: stats.multiShots ?? 0,
    maxCombo: stats.maxCombo ?? 1,
  };
}

export function getDestroyedTypeKey(target: Threat): DestroyedTypeKey {
  if (target.type === "drone") {
    return target.subtype === "shahed238" ? "shahed238" : "shahed136";
  }
  if (target.type === "mirv") return "mirv";
  if (target.type === "mirv_warhead") return "mirvWarhead";
  if (target.type === "stack2" || target.type === "stack3" || target.type === "stack_child") return "stackedMissile";
  if (target.type === "bomb") return "bomb";
  if (target.type === "missile") return "ballisticMissile";
  return "other";
}

export function getDestroyedByTypeDelta(
  current: Partial<DestroyedByTypeStats> | undefined,
  baseline: Partial<DestroyedByTypeStats> | undefined,
): DestroyedByTypeStats {
  const currentStats = cloneDestroyedByTypeStats(current);
  const baselineStats = cloneDestroyedByTypeStats(baseline);
  return Object.fromEntries(
    DESTROYED_TYPE_KEYS.map((key) => [key, Math.max(0, currentStats[key] - baselineStats[key])]),
  ) as DestroyedByTypeStats;
}

export function recordThreatDestroyed(g: GameState, target: Threat): void {
  g.stats = normalizeGameStats(g.stats);
  const typeKey = getDestroyedTypeKey(target);
  if (target.type === "drone") {
    g.stats.droneKills++;
  } else {
    g.stats.missileKills++;
  }
  g.stats.destroyedByType[typeKey]++;
}

export const SCENIC_BUILDING_LAYOUT = [
  { x: 92, w: 34, h: 198, windows: 2, roof: "roundedCrownL", glow: 0.12, profile: "leftLandmark" },
  { x: 150, w: 34, h: 174, windows: 2, roof: "twinCrown", glow: 0.1, profile: "twinSpire" },
  { x: 190, w: 60, h: 110, windows: 1, roof: "tapered", glow: 0.1, profile: "slantedBlock" },
  { x: 262, w: 34, h: 144, windows: 1, roof: "flat", glow: 0.1, profile: "twinSpire" },
  { x: 320, w: 38, h: 152, windows: 1, roof: "flat", glow: 0.08, profile: "eggTower" },
  { x: 582, w: 72, h: 224, windows: 2, roof: "slantR", glow: 0.08, profile: "slantedBlock" },
  { x: 660, w: 46, h: 202, windows: 1, roof: "curvedR", glow: 0.08, profile: "eggTower" },
  { x: 710, w: 28, h: 198, windows: 1, roof: "curvedL", glow: 0.09, profile: "bladeTower" },
  { x: 740, w: 34, h: 100, windows: 1, roof: "curvedL", glow: 0.09, profile: "bladeTower" },
  { x: 780, w: 48, h: 168, windows: 1, roof: "roundedCrownL", glow: 0.1, profile: "twinSpire" },
] as const;

export function createScenicBuildings(): Building[] {
  return SCENIC_BUILDING_LAYOUT.map((tower) => ({
    x: tower.x,
    w: tower.w,
    h: tower.h,
    windows: tower.windows,
    alive: true,
  }));
}

export const BURJ_X = 460;
export const BURJ_H = 340;
export const MAX_PARTICLES = 500;

// Burj half-width at a given y — matches the rendered tapered silhouette
// Rendered shape: spire tip at y=GROUND_Y-BURJ_H-30 (w=0),
// then ±3 at top of tower, tapering to ±15 at base
export const BURJ_SHAPE: [number, number][] = [
  [1.0, 3],
  [0.7, 7],
  [0.4, 11],
  [0.15, 13],
  [0, 15],
];
export function burjHalfW(py: number): number {
  if (py < GROUND_Y - BURJ_H - 30 || py > GROUND_Y) return 0;
  if (py < GROUND_Y - BURJ_H) return 1; // spire
  const t = (GROUND_Y - py) / BURJ_H; // 1=top, 0=base
  for (let i = 0; i < BURJ_SHAPE.length - 1; i++) {
    const [t0, w0] = BURJ_SHAPE[i],
      [t1, w1] = BURJ_SHAPE[i + 1];
    if (t <= t0 && t >= t1) return w1 + ((t - t1) / (t0 - t1)) * (w0 - w1);
  }
  return 15;
}

export const LAUNCHERS: { x: number; y: number }[] = [
  { x: 60, y: GROUND_Y - 5 },
  { x: 860, y: GROUND_Y - 5 },
];

// ── Iron Beam ──
export const IRON_BEAM_EMITTER_Y = 959;
// Spare-beam strafing radius around the emitter, per level.
export const IRON_BEAM_RANGE = [219, 280, 368] as const;
export const IRON_BEAM_CHARGE_TIME = [360, 240, 180] as const;
// How close to impact (in ticks) a Burj-bound threat must be before the beam
// takes the shot. Holding until the last moment leaves interceptors and other
// systems room to claim the kill first, so a charged beam is reserved for
// whatever actually gets through.
export const IRON_BEAM_FIRE_WINDOW = 60;

export function getGameplayLauncherPosition(index: number): { x: number; y: number } {
  return { x: LAUNCHERS[index].x, y: GAMEPLAY_SCENIC_LAUNCHER_Y };
}

export function getDefenseSitePlacement(key: string): { x: number; y: number; hw: number; hh: number } | null {
  switch (key) {
    case "patriot":
      return { x: 334, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 38, hh: 24 };
    case "wildHornetsLeft":
      return { x: 206, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 };
    case "wildHornetsRight":
      return { x: 622, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 };
    case "roadrunner":
      return { x: 711, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 };
    case "phalanx":
      return { x: 553, y: GAMEPLAY_SUPPORT_SITE_Y - 13, hw: 10, hh: 15 };
    case "launcherKit":
      return { x: 800, y: GAMEPLAY_SUPPORT_SITE_Y + 2, hw: 30, hh: 24 };
    case "ironBeam":
      return { x: BURJ_X, y: IRON_BEAM_EMITTER_Y, hw: 10, hh: 15 };
    default:
      return null;
  }
}

export function getGameplayBuildingBounds(building: Building): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  return {
    left: building.x,
    right: building.x + building.w,
    top: GAMEPLAY_SCENIC_BASE_Y - building.h,
    bottom: GAMEPLAY_SCENIC_BASE_Y,
  };
}

export function getGameplayBurjCollisionTop(artScale = 2): number {
  return GAMEPLAY_SCENIC_BASE_Y - (BURJ_H + 30) * artScale;
}

// The rendered tower flares into a wide stepped pedestal over roughly the
// bottom 12% of its height. Hits down there read as ground impacts, so the
// gameplay hit area stops above the pedestal.
export const BURJ_PEDESTAL_FRAC = 0.12;

export function getGameplayBurjCollisionBottom(artScale = 2): number {
  return GAMEPLAY_SCENIC_BASE_Y - BURJ_H * BURJ_PEDESTAL_FRAC * artScale;
}

// Threats that target the Burj aim at a spot on the tower trunk, comfortably
// above the pedestal, so strikes visibly hit the body instead of the ground.
export function getBurjBodyAimPoint(artScale = 2): { x: number; y: number } {
  return { x: BURJ_X, y: GAMEPLAY_SCENIC_BASE_Y - BURJ_H * artScale * rand(0.25, 0.55) };
}

export function getGameplayBurjHalfW(py: number, artScale = 2): number {
  const canonicalY = GROUND_Y + (py - GAMEPLAY_SCENIC_BASE_Y) / artScale;
  return burjHalfW(canonicalY) * artScale;
}

// Default Y range for Shahed-136 level-flight spawns. Keep straight flyers in
// the rendered Burj band; higher lanes are just inert flyovers until a bombing
// variant owns that space properly.
export function getShahed136LevelFlightYRange(): [number, number] {
  const top = getGameplayBurjCollisionTop(2);
  const bot = GAMEPLAY_SCENIC_BASE_Y - BURJ_H;
  return [top, bot];
}

function isStatefulRng(fn: RNG): fn is StatefulRNG {
  const maybe = fn as Partial<StatefulRNG>;
  return typeof maybe.getState === "function" && typeof maybe.setState === "function";
}

let _rng: RNG = Math.random;
export function setRng(fn: RNG): void {
  _rng = fn;
}
export function getRng(): RNG {
  return _rng;
}
export function getRngState(): number | null {
  return isStatefulRng(_rng) ? _rng.getState() : null;
}
export function setRngState(state: number): boolean {
  if (!isStatefulRng(_rng)) return false;
  _rng.setState(state);
  return true;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
export function rand(a: number, b: number): number {
  return a + _rng() * (b - a);
}
export function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function pickTarget(g: GameState, fromX: number): { x: number; y: number } | null {
  // 30% chance to target Burj — aim at the tower trunk, not the pedestal/ground
  if (g.burjAlive && _rng() < 0.3) return getBurjBodyAimPoint();
  // 70% target defense sites / launchers, closest first
  const all: { x: number; y: number }[] = [];
  g.defenseSites.forEach((s) => {
    if (s.alive) all.push({ x: s.x, y: s.y });
  });
  LAUNCHERS.forEach((_, i) => {
    if (g.launcherHP[i] > 0) all.push(getGameplayLauncherPosition(i));
  });
  if (all.length === 0) {
    if (g.burjAlive) return getBurjBodyAimPoint();
    return null;
  }
  all.sort((a, b) => Math.abs(a.x - fromX) - Math.abs(b.x - fromX));
  const pick = Math.min(all.length - 1, _rng() < 0.7 ? 0 : 1);
  return all[pick];
}

// Dropped bombs go after the city skyline only — never the Burj. Aims at an
// alive building's roof, closest-to-drop 70% of the time. Returns null when no
// building is left (caller simply skips the drop rather than diverting to the Burj).
export function pickBuildingTarget(g: GameState, fromX: number): { x: number; y: number } | null {
  const alive: { x: number; y: number }[] = [];
  g.buildings.forEach((b) => {
    if (!b.alive) return;
    const bounds = getGameplayBuildingBounds(b);
    alive.push({ x: (bounds.left + bounds.right) / 2, y: bounds.top });
  });
  if (alive.length === 0) return null;
  alive.sort((a, b) => Math.abs(a.x - fromX) - Math.abs(b.x - fromX));
  const pick = Math.min(alive.length - 1, _rng() < 0.7 ? 0 : 1);
  return alive[pick];
}

function isThreatWithinTapRadius(target: Threat, targetX: number, targetY: number, radius: number): boolean {
  const threatRadius = target.type === "drone" ? target.collisionRadius : 0;
  return dist(targetX, targetY, target.x, target.y) <= radius + threatRadius;
}

function collectIntendedTargetsInRadius(g: GameState, targetX: number, targetY: number, radius: number): Threat[] {
  const intended: Threat[] = [];
  for (const m of g.missiles) {
    if (m.alive && isThreatWithinTapRadius(m, targetX, targetY, radius)) {
      intended.push(m);
    }
  }
  for (const d of g.drones) {
    if (d.alive && isThreatWithinTapRadius(d, targetX, targetY, radius)) {
      intended.push(d);
    }
  }
  return intended;
}

function collectIntendedTargets(g: GameState, targetX: number, targetY: number): Threat[] {
  const intended = collectIntendedTargetsInRadius(g, targetX, targetY, INTERCEPTOR_TAP_FUSE_RADIUS);
  if (intended.length > 0) return intended;
  const soloCandidate = collectIntendedTargetsInRadius(g, targetX, targetY, INTERCEPTOR_SOLO_TAP_FUSE_RADIUS);
  return soloCandidate.length === 1 ? soloCandidate : [];
}

export function fireInterceptor(g: GameState, targetX: number, targetY: number, tick = g._replayTick ?? 0): boolean {
  const selectedIdx = targetX < CANVAS_W / 2 ? 0 : 1;
  const fallbackIdx = selectedIdx === 0 ? 1 : 0;
  const bestIdx = g.launcherHP[selectedIdx] > 0 ? selectedIdx : g.launcherHP[fallbackIdx] > 0 ? fallbackIdx : -1;
  if (bestIdx === -1) return false;
  const l = getGameplayLauncherPosition(bestIdx);
  const targetAngle = Math.atan2(targetY - l.y, targetX - l.x);
  const launchAngle = -Math.PI / 2 + (targetAngle + Math.PI / 2) * 0.32;
  const velocityMultiplier = getInterceptorVelocityMultiplier(g);
  const speed = 7.7584 * velocityMultiplier;
  const dx = targetX - l.x;
  const dy = targetY - l.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return false;
  syncFireChargeForTick(g, tick);
  if (getFireChargeCount(g.fireChargeState) <= 0) return false;
  if (!spendFireCharge(g.fireChargeState, tick, getLauncherReloadTicks(g))) return false;
  g.stats = normalizeGameStats(g.stats);
  g.stats.shotsFired++;
  // Render-only: Pixi uses this for muzzle flash decay.
  g.launcherFireTick[bestIdx] = tick;
  const intendedTargets = collectIntendedTargets(g, targetX, targetY);
  g.interceptors.push({
    x: l.x,
    y: l.y,
    targetX,
    targetY,
    vx: Math.cos(launchAngle) * speed,
    vy: Math.sin(launchAngle) * speed,
    heading: launchAngle,
    speed,
    accel: 2.6 * velocityMultiplier,
    maxSpeed: 26 * velocityMultiplier,
    turnRate: 0.22,
    trail: [],
    alive: true,
    ...(intendedTargets.length > 0 ? { intendedTargets } : {}),
  });
  return true;
}

export const OVERRIDE_KEY_REGISTRY = {
  "burjFire.emberAlphaMul": true,
  "burjFire.emberLife": true,
  "burjFire.emberRate": true,
  "burjFire.emberSize": true,
  "burjFire.flameAlphaMul": true,
  "burjFire.flameLife": true,
  "burjFire.flameRate": true,
  "burjFire.flameSize": true,
  "burjFire.flameSizeMul": true,
  "burjFire.flicker": true,
  "burjFire.hitFlashFlameMul": true,
  "burjFire.hitFlashSmokeMul": true,
  "burjFire.hotspotSpread": true,
  "burjFire.smokeAlphaMul": true,
  "burjFire.smokeBase": true,
  "burjFire.smokeDamageMul": true,
  "burjFire.smokeDrift": true,
  "burjFire.smokeGrowth": true,
  "burjFire.smokeLife": true,
  "burjFire.smokeRate": true,
  "burjFire.smokeRise": true,
  "burjFire.smokeRiseDamageBoost": true,
  "burjFire.smokeSize": true,
  "burjFire.smokeSizeMul": true,
  "burjFire.smokeYOffset": true,
  "explosion.coreAlpha": true,
  "explosion.coreRadiusMul": true,
  "explosion.fadeRate": true,
  "explosion.fireballAlpha": true,
  "explosion.fireballRadiusMul": true,
  "explosion.lightIntensity": true,
  "explosion.lightRadiusMul": true,
  "explosion.ringExpandRate": true,
  "explosion.ringFadeRate": true,
  "explosion.splashIntensity": true,
  "explosion.splashRadiusMul": true,
  "flare.drag": true,
  "flare.ejectSpeed": true,
  "flare.fanAngle": true,
  "flare.flareLife": true,
  "flare.gravity": true,
  "flare.lureRadius": true,
  "flare.redirectAOE": true,
  "flare.redirectCandidates": true,
  "flare.salvoCountL1": true,
  "flare.salvoCountL2": true,
  "flare.salvoDropsL1": true,
  "flare.salvoDropsL2": true,
  "flare.salvoSpacingTicksL1": true,
  "flare.salvoSpacingTicksL2": true,
  "flare.tickLureRadius": true,
  "flare.trailLength": true,
  "particle.debrisCount": true,
  "particle.debrisDrag": true,
  "particle.debrisGravity": true,
  "particle.dotCountHeavy": true,
  "particle.dotCountLight": true,
  "particle.sparkCountHeavy": true,
  "particle.sparkCountLight": true,
  "particle.sparkDrag": true,
  "upgrade.emp.x": true,
  "upgrade.emp.y": true,
  "upgrade.empRange": true,
  "upgrade.flares.x": true,
  "upgrade.flares.y": true,
  "upgrade.hornetsLeft.x": true,
  "upgrade.hornetsLeft.y": true,
  "upgrade.hornetsRight.x": true,
  "upgrade.hornetsRight.y": true,
  "upgrade.ironBeam.x": true,
  "upgrade.ironBeam.y": true,
  "upgrade.ironBeamRange": true,
  "upgrade.launcherKit.x": true,
  "upgrade.launcherKit.y": true,
  "upgrade.patriot.x": true,
  "upgrade.patriot.y": true,
  "upgrade.phalanx1.x": true,
  "upgrade.phalanx1.y": true,
  "upgrade.phalanx2.x": true,
  "upgrade.phalanx2.y": true,
  "upgrade.phalanx3.x": true,
  "upgrade.phalanx3.y": true,
  "upgrade.phalanxRange": true,
  "upgrade.roadrunner.x": true,
  "upgrade.roadrunner.y": true,
} as const satisfies Record<string, true>;

export type OverrideKey = keyof typeof OVERRIDE_KEY_REGISTRY;
export const OVERRIDE_KEYS = Object.keys(OVERRIDE_KEY_REGISTRY) as OverrideKey[];
export type EditorOverrideValue = number | boolean | string;
export type EditorOverrideMap = Partial<Record<OverrideKey, EditorOverrideValue>>;

declare global {
  interface Window {
    __editorOverrides?: EditorOverrideMap | null;
  }
}

function getEditorOverrides(): EditorOverrideMap | null | undefined {
  return typeof window !== "undefined" ? window.__editorOverrides : undefined;
}

export function hasEditorOverrides(): boolean {
  const overrides = getEditorOverrides();
  return !!overrides && Object.keys(overrides).length > 0;
}

export function assertNoEditorOverridesForDeterministicRun(context: string): void {
  if (!hasEditorOverrides()) return;
  throw new Error(`${context} cannot run deterministically while window.__editorOverrides is set`);
}

// Editor override helper — returns override value if editor is active, otherwise fallback.
export function ov<T>(key: OverrideKey, fallback: T): T {
  const overrides = getEditorOverrides();
  return (overrides && key in overrides ? overrides[key] : fallback) as T;
}

interface ExplosionOptions {
  harmless?: boolean;
  chain?: boolean;
  rootExplosionId?: number | null;
  visualType?: ExplosionVisualType;
}

export function createExplosion(
  g: GameState,
  x: number,
  y: number,
  radius: number,
  color: string | null | undefined,
  playerCaused?: boolean,
  initialRadius = 0,
  options: ExplosionOptions = {},
): void {
  const id = g.nextExplosionId++;
  g.explosions.push({
    id,
    x,
    y,
    radius: initialRadius,
    maxRadius: radius,
    growing: true,
    alpha: 1,
    color: color || COL.explosion,
    playerCaused: !!playerCaused,
    harmless: !!options.harmless,
    chain: !!options.chain,
    visualType: options.visualType,
    rootExplosionId: options.rootExplosionId ?? null,
    ringRadius: 0,
    ringAlpha: 1,
  });
  let budget = MAX_PARTICLES - g.particles.length;
  const heavy = !playerCaused; // threat explosions get more/bigger particles
  // Large blasts (e.g. Patriot, big chains) get proportionally more particles so they don't look thin
  const radiusScale = Math.min(2, Math.max(1, radius / 56));
  // Dot particles / interceptor smoke puffs
  const dotCount = Math.min(
    Math.round((heavy ? ov("particle.dotCountHeavy", 10) : ov("particle.dotCountLight", 6)) * radiusScale),
    budget,
  );
  const interceptorSmoke = playerCaused && !options.chain;
  const droneExplosionPuffs = options.visualType === "drone";
  for (let i = 0; i < dotCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1, heavy ? 6 : 4);
    if (droneExplosionPuffs) {
      const life = rand(20, heavy ? 70 : 50);
      const puffRoll = _rng();
      const sizeSeed = rand(heavy ? 2 : 1, heavy ? 5 : 3);
      const sizeT = heavy ? (sizeSeed - 2) / 3 : (sizeSeed - 1) / 2;
      g.particles.push({
        x,
        y,
        vx: Math.cos(angle) * sp * 0.72,
        vy: Math.sin(angle) * sp * 0.72 - (0.2 + puffRoll * 0.65),
        life,
        maxLife: heavy ? 70 : 50,
        color: color || "#ff8800",
        size: (heavy ? 5.4 : 4.2) + sizeT * (heavy ? 5.2 : 3.4),
        type: "explosionPuff",
        angle: angle + puffRoll * Math.PI,
        spin: (sizeT - 0.5) * 0.11,
        gravity: 0.015,
        drag: 0.965,
        textureVariant: getExplosionParticleVariantId(id * 11 + i),
      });
      continue;
    }
    if (interceptorSmoke) {
      const life = rand(20, 50);
      const puffRoll = _rng();
      const sizeSeed = rand(1, 3);
      const sizeT = (sizeSeed - 1) / 2;
      g.particles.push({
        x,
        y,
        vx: Math.cos(angle) * sp * 0.55,
        vy: Math.sin(angle) * sp * 0.55 - (0.35 + puffRoll * 0.8),
        life,
        maxLife: 50,
        color: color || COL.interceptor,
        size: 4.2 + sizeT * 3.2,
        type: "smokePuff",
        angle: angle + puffRoll * Math.PI,
        spin: (sizeT - 0.5) * 0.07,
        gravity: -0.008,
        drag: 0.975,
        textureVariant: getWhiteSmokeParticleVariantId(id * 17 + i),
      });
      continue;
    }
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(20, heavy ? 70 : 50),
      maxLife: heavy ? 70 : 50,
      color: _rng() > 0.5 ? "#ffcc00" : "#ff6600",
      size: rand(heavy ? 2 : 1, heavy ? 5 : 3),
    });
  }
  budget -= dotCount;
  // Debris shards — spinning triangular fragments (skip for interceptor detonation)
  const debrisCount =
    playerCaused && !options.chain ? 0 : Math.min(Math.round(ov("particle.debrisCount", 16) * radiusScale), budget);
  for (let i = 0; i < debrisCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1.5, 4);
    const dark = _rng() > 0.4;
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp - rand(0.5, 2),
      life: rand(30, 60),
      maxLife: 60,
      color: dark ? "#666" : _rng() > 0.5 ? "#994400" : "#aa5500",
      size: rand(1, 4),
      type: "debris",
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.25, 0.25),
      gravity: ov("particle.debrisGravity", 0.15),
      w: rand(2, 4),
      h: rand(2, 5),
      drag: ov("particle.debrisDrag", 0.96),
    });
  }
  budget -= debrisCount;
  // Sparks — fast bright particles with drag
  const sparkCount = Math.min(
    Math.round((heavy ? ov("particle.sparkCountHeavy", 14) : ov("particle.sparkCountLight", 8)) * radiusScale),
    budget,
  );
  for (let i = 0; i < sparkCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(4, heavy ? 12 : 8);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(10, heavy ? 35 : 25),
      maxLife: heavy ? 35 : 25,
      color: _rng() > 0.5 ? "#fff" : "#ffee88",
      size: rand(0.5, heavy ? 2.5 : 1.5),
      type: "spark",
      drag: ov("particle.sparkDrag", 0.93),
      gravity: 0.02,
    });
  }
  applyShake(g, 8, radius / 10);
}

// Shake envelope decay normalises against the peak timer of the current event,
// so a quick 8-tick rumble decays as fast as it should and a 22-tick EMP rumble
// decays slow. Without this, a fixed renderer-side normalizer (e.g. divide by
// EMP_SHAKE_TIMER) silently makes short shakes feel like a typo.
export function applyShake(
  g: Pick<GameState, "shakeTimer" | "shakeIntensity" | "shakePeakTimer">,
  timer: number,
  intensity: number,
): void {
  if (timer >= g.shakeTimer) {
    g.shakeTimer = timer;
    g.shakePeakTimer = timer;
  }
  g.shakeIntensity = Math.max(g.shakeIntensity, intensity);
}

export interface GameplayViewTransform {
  shakeX: number;
  shakeY: number;
  zoom: number;
}

const EMP_ZOOM_SCALE_VIEW = 0.04;
const EMP_ZOOM_ATTACK_TICKS = 3;

// Single source of truth for the gameplay-scene transform. Used by the Pixi
// renderer to position the gameplay container, and by the input handler to
// invert the transform when mapping pointer events to game-space coordinates.
export function getGameplayViewTransform(
  game: Pick<GameState, "time" | "shakeTimer" | "shakeIntensity" | "shakePeakTimer" | "empZoomTimer" | "empZoomMax">,
): GameplayViewTransform {
  const peak = Math.max(1, game.shakePeakTimer || 0);
  const shakeT = game.shakeTimer > 0 ? Math.max(0, Math.min(1, game.shakeTimer / peak)) : 0;
  const shakeAmp = (game.shakeIntensity ?? 0) * shakeT * shakeT;
  const tick = game.time;
  const shakeX = shakeAmp > 0 ? (Math.sin(tick * 2.17) * 0.65 + Math.sin(tick * 5.03 + 1.7) * 0.35) * shakeAmp : 0;
  const shakeY =
    shakeAmp > 0 ? (Math.cos(tick * 2.41 + 0.4) * 0.55 + Math.sin(tick * 4.31 + 2.4) * 0.45) * shakeAmp : 0;

  let zoom = 1;
  const zoomMax = game.empZoomMax ?? 0;
  const zoomTimer = game.empZoomTimer ?? 0;
  if (zoomTimer > 0 && zoomMax > 0) {
    const elapsed = zoomMax - zoomTimer;
    const release = Math.max(1, zoomMax - EMP_ZOOM_ATTACK_TICKS);
    const amount =
      elapsed < EMP_ZOOM_ATTACK_TICKS
        ? elapsed / EMP_ZOOM_ATTACK_TICKS
        : 1 - (elapsed - EMP_ZOOM_ATTACK_TICKS) / release;
    zoom += EMP_ZOOM_SCALE_VIEW * Math.max(0, Math.min(1, amount));
  }
  return { shakeX, shakeY, zoom };
}

export function destroyDefenseSite(g: GameState, site: DefenseSite): void {
  void g;
  site.alive = false;
  // isSiteAlive() prevents new spawns; existing in-flight entities finish naturally
}

export function getPhalanxTurrets(level: number): { x: number; y: number }[] {
  const turrets: { x: number; y: number }[] = [{ x: 553, y: 1498 }];
  if (level >= 2) turrets.push({ x: 860, y: 1504 });
  if (level >= 3) turrets.push({ x: 59, y: GROUND_Y - 30 });
  return turrets;
}

export function getKillReward(target: Threat): number {
  if (target.type === "drone") return (target as { subtype?: string }).subtype === "shahed238" ? 40 : 20;
  if (target.type === "mirv") return 100;
  if (target.type === "bomb") return 42;
  if (target.type === "mirv_warhead") return 56;
  if (target.type === "stack3") return 72;
  if (target.type === "stack2") return 56;
  return 28;
}

export function getAmmoCapacity(wave: number, launcherKitLevel: number): number {
  void launcherKitLevel;
  const base = 11 + Math.floor(wave / 3);
  return Math.min(base, 24);
}

export const LAUNCHER_RELOAD_TICKS = 30;
export const LAUNCHER_RAPID_RELOAD_TICKS = 15;
export const LAUNCHER_HIGH_VELOCITY_MULTIPLIER = 1.5;

export const LAUNCHER_RAPID_RELOAD_NODE: UpgradeNodeId = "launcherRapidReload";
export const LAUNCHER_ARMOR_NODE: UpgradeNodeId = "launcherArmorKit";
export const LAUNCHER_HIGH_VELOCITY_NODE: UpgradeNodeId = "launcherHighVelocity";
export const LAUNCHER_DOUBLE_MAGAZINE_NODE: UpgradeNodeId = "launcherDoubleMagazine";

function hasOwnedLauncherNode(g: Pick<GameState, "ownedUpgradeNodes">, nodeId: UpgradeNodeId): boolean {
  return !!g.ownedUpgradeNodes?.has(nodeId);
}

export function getLauncherReloadTicks(g: Pick<GameState, "ownedUpgradeNodes">): number {
  return hasOwnedLauncherNode(g, LAUNCHER_RAPID_RELOAD_NODE) ? LAUNCHER_RAPID_RELOAD_TICKS : LAUNCHER_RELOAD_TICKS;
}

export function getLauncherMaxHp(g: Pick<GameState, "ownedUpgradeNodes">): number {
  return hasOwnedLauncherNode(g, LAUNCHER_ARMOR_NODE) ? 2 : 1;
}

export function getLauncherBurstChargeCap(
  g: Pick<GameState, "ownedUpgradeNodes">,
  activeLauncherCount: number,
): number {
  if (activeLauncherCount <= 0) return 0;
  const multiplier = hasOwnedLauncherNode(g, LAUNCHER_DOUBLE_MAGAZINE_NODE) ? 4 : 2;
  return activeLauncherCount * multiplier;
}

export function countAliveLaunchers(g: Pick<GameState, "launcherHP">): number {
  let count = 0;
  for (let i = 0; i < g.launcherHP.length; i++) {
    if (g.launcherHP[i] > 0) count++;
  }
  return count;
}

export function syncFireChargeForTick(g: GameState, tick: number): void {
  const activeLauncherCount = countAliveLaunchers(g);
  const cap = getLauncherBurstChargeCap(g, activeLauncherCount);
  syncFireChargeState(g.fireChargeState, tick, cap, getLauncherReloadTicks(g));
}

function getInterceptorVelocityMultiplier(g: Pick<GameState, "ownedUpgradeNodes">): number {
  return hasOwnedLauncherNode(g, LAUNCHER_HIGH_VELOCITY_NODE) ? LAUNCHER_HIGH_VELOCITY_MULTIPLIER : 1;
}

export function getMultiKillBonus(kills: number): number {
  if (kills >= 4) return 700;
  if (kills === 3) return 350;
  if (kills === 2) return 150;
  return 0;
}

interface Point {
  x: number;
  y: number;
}

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function sampleCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, stepSize: number): Point[] {
  const N = 500;
  const fine: Point[] = [];
  for (let i = 0; i <= N; i++) {
    fine.push(cubicBezier(p0, p1, p2, p3, i / N));
  }
  // Compute cumulative arc lengths
  const arcLen: number[] = [0];
  for (let i = 1; i < fine.length; i++) {
    const dx = fine[i].x - fine[i - 1].x;
    const dy = fine[i].y - fine[i - 1].y;
    arcLen.push(arcLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  // Walk at uniform stepSize intervals
  const totalLen = arcLen[arcLen.length - 1];
  const waypoints: Point[] = [{ x: fine[0].x, y: fine[0].y }];
  let nextDist = stepSize;
  for (let i = 1; i < fine.length; i++) {
    while (nextDist <= arcLen[i] && nextDist <= totalLen) {
      const segStart = arcLen[i - 1];
      const segEnd = arcLen[i];
      const frac = segEnd > segStart ? (nextDist - segStart) / (segEnd - segStart) : 0;
      waypoints.push({
        x: fine[i - 1].x + (fine[i].x - fine[i - 1].x) * frac,
        y: fine[i - 1].y + (fine[i].y - fine[i - 1].y) * frac,
      });
      nextDist += stepSize;
    }
  }
  // Ensure endpoint is included
  const last = fine[fine.length - 1];
  const wLast = waypoints[waypoints.length - 1];
  if (Math.abs(wLast.x - last.x) > 0.5 || Math.abs(wLast.y - last.y) > 0.5) {
    waypoints.push({ x: last.x, y: last.y });
  }
  return waypoints;
}

export function computeShahed238Path(
  spawnX: number,
  spawnY: number,
  goingRight: boolean,
  speed: number,
  target: { x: number; y: number },
): { waypoints: Point[]; diveStartIndex: number; bombIndices: number[] } {
  const dir = goingRight ? 1 : -1;

  // Transition point — where cruise ends and dive arc begins
  const transX = spawnX + dir * CANVAS_W * 0.55;
  const transY = spawnY + rand(25, 50);

  // Cruise segment (horizontal flight with gentle descent)
  const cruiseWaypoints = sampleCubicBezier(
    { x: spawnX, y: spawnY },
    { x: spawnX + dir * CANVAS_W * 0.2, y: spawnY + rand(5, 15) },
    { x: transX - dir * 80, y: spawnY + rand(15, 30) },
    { x: transX, y: transY },
    speed,
  );

  const diveStartIndex = cruiseWaypoints.length;

  // Dive arc segment (smooth bank into target)
  const diveExtend = Math.abs(target.x - transX) * 0.5;
  const diveWaypoints = sampleCubicBezier(
    { x: transX, y: transY },
    { x: transX + dir * Math.max(diveExtend, 120), y: transY + 80 },
    { x: target.x + dir * 100, y: target.y - 150 },
    { x: target.x, y: target.y },
    speed * 1.2,
  );

  const waypoints = cruiseWaypoints.concat(diveWaypoints.slice(1));

  // Bomb drop positions: 35% and 65% through cruise
  const bombIdx0 = Math.floor(diveStartIndex * 0.35);
  const bombIdx1 = Math.min(diveStartIndex - 1, bombIdx0 + Math.min(90, Math.floor(diveStartIndex * 0.3)));
  const bombIndices = [Math.max(1, bombIdx0), Math.max(2, bombIdx1)];

  return { waypoints, diveStartIndex, bombIndices };
}

export function computeShahed136Path(
  spawnX: number,
  spawnY: number,
  goingRight: boolean,
  speed: number,
  target: { x: number; y: number },
): { waypoints: Point[]; diveStartIndex: number; bombIndices: number[] } {
  const dir = goingRight ? 1 : -1;

  // Earlier transition than the jet drone so the turn feels decisive, not lazy.
  const transX = spawnX + dir * CANVAS_W * rand(0.24, 0.36);
  const transY = spawnY + rand(-10, 24);

  const cruiseWaypoints = sampleCubicBezier(
    { x: spawnX, y: spawnY },
    { x: spawnX + dir * CANVAS_W * 0.12, y: spawnY + rand(-18, 12) },
    { x: transX - dir * rand(55, 95), y: transY + rand(-8, 14) },
    { x: transX, y: transY },
    speed * 1.08,
  );

  const diveStartIndex = cruiseWaypoints.length;

  const diveWaypoints = sampleCubicBezier(
    { x: transX, y: transY },
    { x: transX + dir * rand(60, 105), y: transY + rand(72, 120) },
    { x: target.x + dir * rand(20, 55), y: target.y - rand(70, 115) },
    { x: target.x, y: target.y },
    speed * 1.34,
  );

  const waypoints = cruiseWaypoints.concat(diveWaypoints.slice(1));
  const bombIndex = Math.max(1, Math.floor(diveStartIndex * rand(0.42, 0.62)));

  return { waypoints, diveStartIndex, bombIndices: [bombIndex] };
}

export function computeShahed136StraightPath(
  spawnX: number,
  spawnY: number,
  speed: number,
  target: { x: number; y: number },
): Point[] {
  const dx = target.x - spawnX;
  const dy = target.y - spawnY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(2, Math.ceil(len / Math.max(1, speed)));
  const waypoints: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    waypoints.push({ x: spawnX + dx * t, y: spawnY + dy * t });
  }
  return waypoints;
}

export function damageTarget(
  g: GameState,
  target: Threat,
  damage: number,
  color: string,
  radius: number,
  { noExplosion = false } = {},
): void {
  if (target.type === "drone") {
    target.health -= damage;
    if (target.health <= 0) {
      target.alive = false;
      g.score += getKillReward(target) * g.combo;
      recordThreatDestroyed(g, target);
      if (!noExplosion) createExplosion(g, target.x, target.y, radius, color, false, 0, { visualType: "drone" });
    }
  } else if (target.type === "mirv") {
    (target as { health: number }).health -= damage;
    if ((target as { health: number }).health <= 0) {
      target.alive = false;
      g.score += getKillReward(target) * g.combo;
      recordThreatDestroyed(g, target);
      if (!noExplosion) createExplosion(g, target.x, target.y, 60, color, false, 0, { visualType: "missile" });
    }
  } else {
    target.alive = false;
    g.score += getKillReward(target) * g.combo;
    recordThreatDestroyed(g, target);
    if (!noExplosion) createExplosion(g, target.x, target.y, radius, color, false, 0, { visualType: "missile" });
  }
}

// ── Burj impact prediction ──
// These predicates mirror the live collision rules in updateMissiles/updateDrones,
// so "will hit" here means the sim really would apply Burj damage on that course.

export function hitsBurjBody(g: GameState, x: number, y: number): boolean {
  return (
    g.burjAlive &&
    y >= getGameplayBurjCollisionTop(2) &&
    y <= getGameplayBurjCollisionBottom(2) &&
    Math.abs(x - BURJ_X) <= getGameplayBurjHalfW(y, 2)
  );
}

// Burj-targeted systems aim only at the visible tower body. Pedestal and ground
// impacts are deliberately excluded from gameplay damage.
export function isBurjImpactTarget(targetX: number | undefined, targetY: number | undefined): boolean {
  if (targetX === undefined || targetY === undefined) return false;
  return (
    Math.abs(targetX - BURJ_X) <= 40 &&
    targetY >= getGameplayBurjCollisionTop(2) &&
    targetY <= getGameplayBurjCollisionBottom(2)
  );
}

// Shahed dive impacts count as Burj hits when the dive was aimed at the tower.
export function isBurjDiveTarget(g: GameState, d: Drone): boolean {
  if (!g.burjAlive || !d.diveTarget) return false;
  return (
    Math.abs(d.diveTarget.x - BURJ_X) <= Math.max(36, d.collisionRadius) &&
    isBurjImpactTarget(d.diveTarget.x, d.diveTarget.y)
  );
}

// Predicts whether a threat's current course damages the Burj within `horizon`
// ticks by stepping the same motion model the sim uses. Returns the estimated
// tick count to impact, or null when the threat is no danger to the tower.
// Building/site/launcher shadowing is deliberately ignored: a threat that would
// die on a defense structure next to the tower is still worth the shot.
export function predictBurjImpactTicks(g: GameState, t: Threat, horizon: number): number | null {
  if (!t.alive || !g.burjAlive || t.flareControl) return null;
  const impactTicks =
    t.type === "drone" ? predictDroneBurjImpact(g, t, horizon) : predictMissileBurjImpact(g, t, horizon);
  if (impactTicks === null || impactTicks <= g.burjInvulnTimer) return null;
  return impactTicks;
}

function predictMissileBurjImpact(g: GameState, m: Missile, horizon: number): number | null {
  let x = m.x;
  let y = m.y;
  let vx = m.vx;
  let vy = m.vy;
  const splitY = m.type === "mirv" && !m.splitTriggered ? (m.splitY ?? Infinity) : Infinity;
  for (let tick = 1; tick <= horizon; tick++) {
    if (m.accel) {
      vx *= m.accel;
      vy *= m.accel;
    }
    x += vx;
    y += vy;
    if (y >= splitY) return null; // splits into warheads before reaching the tower
    if (hitsBurjBody(g, x, y)) return tick;
    if (y >= GAMEPLAY_WATERLINE_Y) return null;
    if (x < -50 || x > CANVAS_W + 50) return null;
  }
  return null;
}

function predictDroneBurjImpact(g: GameState, d: Drone, horizon: number): number | null {
  if (d.waypoints && d.waypoints.length >= 2) {
    const diveStart = d.diveStartIndex ?? Infinity;
    const isShahed136Diver = d.subtype === "shahed136" && shahed136HasDive(d.shahedVariant ?? "shahed-136-dive-bomber");
    let pathIndex = d.pathIndex ?? 0;
    let diveSpeed = d.diveSpeed ?? 1.0;
    for (let tick = 1; tick <= horizon; tick++) {
      let pathSpeed = 1;
      if (isShahed136Diver && pathIndex >= diveStart) {
        diveSpeed = Math.min(4.0, Math.max(diveSpeed, 1.0) * 1.06);
        pathSpeed = diveSpeed;
      }
      pathIndex = Math.min(pathIndex + pathSpeed, d.waypoints.length - 1);
      const i0 = Math.floor(pathIndex);
      const i1 = Math.min(i0 + 1, d.waypoints.length - 1);
      const frac = pathIndex - i0;
      const x = d.waypoints[i0].x + (d.waypoints[i1].x - d.waypoints[i0].x) * frac;
      const y = d.waypoints[i0].y + (d.waypoints[i1].y - d.waypoints[i0].y) * frac;
      if (x < -60 || x > CANVAS_W + 60 || y > CANVAS_H + 20) return null;
      if (hitsBurjBody(g, x, y)) return tick;
      const pathDone = pathIndex >= d.waypoints.length - 1;
      if (d.diveTarget) {
        const hitTarget = dist(x, y, d.diveTarget.x, d.diveTarget.y) < 20;
        if (hitTarget || y >= GAMEPLAY_WATERLINE_Y || pathDone) {
          return isBurjDiveTarget(g, d) && (hitTarget || pathDone) ? tick : null;
        }
      } else if (y >= GAMEPLAY_WATERLINE_Y || pathDone) {
        return null;
      }
    }
    return null;
  }
  // Straight movers without a waypoint path (legacy spawn/dive fallback).
  let x = d.x;
  let y = d.y;
  let vx = d.vx;
  let vy = d.vy;
  if (d.diving && d.diveTarget) {
    const diveSpeed = d.diveSpeed || Math.max(Math.abs(d.vx), 1.0) * 2.7;
    const dx = d.diveTarget.x - x;
    const dy = d.diveTarget.y - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return null;
    vx = (dx / len) * diveSpeed;
    vy = (dy / len) * diveSpeed;
  }
  for (let tick = 1; tick <= horizon; tick++) {
    x += vx;
    y += vy;
    if (x < -60 || x > CANVAS_W + 60 || y > CANVAS_H + 20) return null;
    if (hitsBurjBody(g, x, y)) return tick;
    const hitTarget = !!d.diveTarget && dist(x, y, d.diveTarget.x, d.diveTarget.y) < 20;
    if (d.diveTarget && (hitTarget || y >= GAMEPLAY_WATERLINE_Y)) {
      return hitTarget && isBurjDiveTarget(g, d) ? tick : null;
    }
    if (!d.diveTarget && y >= GAMEPLAY_WATERLINE_Y) return null;
  }
  return null;
}
