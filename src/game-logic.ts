import {
  DESTROYED_TYPE_KEYS,
  type RNG,
  type GameState,
  type DefenseSite,
  type Threat,
  type Building,
  type ExplosionVisualType,
  type UpgradeNodeId,
  type DestroyedByTypeStats,
  type DestroyedTypeKey,
  type GameStats,
} from "./types";

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

export function getGameplayLauncherPosition(index: number): { x: number; y: number } {
  return { x: LAUNCHERS[index].x, y: GAMEPLAY_SCENIC_LAUNCHER_Y };
}

export function getDefenseSitePlacement(key: string): { x: number; y: number; hw: number; hh: number } | null {
  switch (key) {
    case "patriot":
      return { x: 334, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 38, hh: 24 };
    case "wildHornets":
      return { x: 206, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 };
    case "roadrunner":
      return { x: 678, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 };
    case "phalanx":
      return { x: 553, y: GAMEPLAY_SUPPORT_SITE_Y - 13, hw: 10, hh: 15 };
    case "launcherKit":
      return { x: 772, y: GAMEPLAY_SUPPORT_SITE_Y + 2, hw: 30, hh: 24 };
    case "ironBeam":
      return { x: BURJ_X, y: 959, hw: 10, hh: 15 };
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

export function getGameplayBurjHalfW(py: number, artScale = 2): number {
  const canonicalY = GROUND_Y + (py - GAMEPLAY_SCENIC_BASE_Y) / artScale;
  return burjHalfW(canonicalY) * artScale;
}

// Default Y range for Shahed-136 level-flight spawns. Inset by ±5% of the raw
// Burj-bracketed band so spawns aren't pinned to the visual silhouette edges.
export function getShahed136LevelFlightYRange(): [number, number] {
  const top = getGameplayBurjCollisionTop(2);
  const bot = GAMEPLAY_SCENIC_BASE_Y - BURJ_H;
  const half = (bot - top) / 2;
  const center = (top + bot) / 2;
  const expanded = half * 1.1;
  return [center - expanded, center + expanded];
}

let _rng: RNG = Math.random;
export function setRng(fn: RNG): void {
  _rng = fn;
}
export function getRng(): RNG {
  return _rng;
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
  // 30% chance to target Burj
  if (g.burjAlive && _rng() < 0.3) return { x: BURJ_X, y: CITY_Y };
  // 70% target defense sites / launchers, closest first
  const all: { x: number; y: number }[] = [];
  g.defenseSites.forEach((s) => {
    if (s.alive) all.push({ x: s.x, y: s.y });
  });
  LAUNCHERS.forEach((_, i) => {
    if (g.launcherHP[i] > 0) all.push(getGameplayLauncherPosition(i));
  });
  if (all.length === 0) {
    if (g.burjAlive) return { x: BURJ_X, y: CITY_Y };
    return null;
  }
  all.sort((a, b) => Math.abs(a.x - fromX) - Math.abs(b.x - fromX));
  const pick = Math.min(all.length - 1, _rng() < 0.7 ? 0 : 1);
  return all[pick];
}

export function fireInterceptor(
  g: GameState,
  targetX: number,
  targetY: number,
  tick = g._replayTick ?? 0,
  ignoreLauncherReload = false,
): boolean {
  const selectedIdx = targetX < CANVAS_W / 2 ? 0 : 1;
  const fallbackIdx = selectedIdx === 0 ? 1 : 0;
  const bestIdx = g.launcherHP[selectedIdx] > 0 ? selectedIdx : g.launcherHP[fallbackIdx] > 0 ? fallbackIdx : -1;
  if (bestIdx === -1) return false;
  if (!ignoreLauncherReload && tick < g.launcherReloadUntilTick[bestIdx]) return false;
  const l = getGameplayLauncherPosition(bestIdx);
  const targetAngle = Math.atan2(targetY - l.y, targetX - l.x);
  const launchAngle = -Math.PI / 2 + (targetAngle + Math.PI / 2) * 0.32;
  const velocityMultiplier = getInterceptorVelocityMultiplier(g);
  const speed = 7.46 * velocityMultiplier;
  const dx = targetX - l.x;
  const dy = targetY - l.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return false;
  g.stats = normalizeGameStats(g.stats);
  g.stats.shotsFired++;
  g.launcherFireTick[bestIdx] = tick;
  g.launcherReloadUntilTick[bestIdx] = tick + getLauncherReloadTicks(g);
  g.interceptors.push({
    x: l.x,
    y: l.y,
    targetX,
    targetY,
    vx: Math.cos(launchAngle) * speed,
    vy: Math.sin(launchAngle) * speed,
    heading: launchAngle,
    speed,
    accel: 2.5 * velocityMultiplier,
    maxSpeed: 25 * velocityMultiplier,
    turnRate: 0.22,
    trail: [],
    alive: true,
  });
  return true;
}

// Editor override helper — returns override value if editor is active, otherwise fallback
export function ov<T>(key: string, fallback: T): T {
  const o =
    typeof window !== "undefined" &&
    (window as Window & { __editorOverrides?: Record<string, unknown> }).__editorOverrides;
  return (o && key in o ? o[key] : fallback) as T;
}

let _explosionId = 0;

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
  const id = _explosionId++;
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
  // Dot particles (smoke puffs)
  const dotCount = Math.min(
    Math.round((heavy ? ov("particle.dotCountHeavy", 10) : ov("particle.dotCountLight", 6)) * radiusScale),
    budget,
  );
  for (let i = 0; i < dotCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1, heavy ? 6 : 4);
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
export const LAUNCHER_RAPID_RELOAD_TICKS = 18;
export const LAUNCHER_HIGH_VELOCITY_MULTIPLIER = 1.4;

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
  const multiplier = hasOwnedLauncherNode(g, LAUNCHER_DOUBLE_MAGAZINE_NODE) ? 2 : 1;
  const naturalCap = Math.ceil(activeLauncherCount * multiplier);
  const floor = hasOwnedLauncherNode(g, LAUNCHER_DOUBLE_MAGAZINE_NODE) ? 6 : 3;
  return Math.max(floor, naturalCap);
}

function getInterceptorVelocityMultiplier(g: Pick<GameState, "ownedUpgradeNodes">): number {
  return hasOwnedLauncherNode(g, LAUNCHER_HIGH_VELOCITY_NODE) ? LAUNCHER_HIGH_VELOCITY_MULTIPLIER : 1;
}

export function getLauncherReadiness(
  g: GameState,
  tick: number,
): {
  readyCount: number;
  availableCount: number;
} {
  let readyCount = 0;
  let availableCount = 0;
  for (let i = 0; i < LAUNCHERS.length; i++) {
    if (g.launcherHP[i] <= 0) continue;
    availableCount++;
    if (tick >= g.launcherReloadUntilTick[i]) readyCount++;
  }
  return { readyCount, availableCount };
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
      g.score += getKillReward(target);
      recordThreatDestroyed(g, target);
      if (!noExplosion) createExplosion(g, target.x, target.y, radius, color, false, 0, { visualType: "drone" });
    }
  } else if (target.type === "mirv") {
    (target as { health: number }).health -= damage;
    if ((target as { health: number }).health <= 0) {
      target.alive = false;
      g.score += getKillReward(target);
      recordThreatDestroyed(g, target);
      if (!noExplosion) createExplosion(g, target.x, target.y, 60, color, false, 0, { visualType: "missile" });
    }
  } else {
    target.alive = false;
    g.score += getKillReward(target);
    recordThreatDestroyed(g, target);
    if (!noExplosion) createExplosion(g, target.x, target.y, radius, color, false, 0, { visualType: "missile" });
  }
}
