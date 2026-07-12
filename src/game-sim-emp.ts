import {
  COL,
  EMP_RING_SPEED_INITIAL,
  EMP_RING_SPEED_MID,
  EMP_RING_SPEED_TAIL,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  LAUNCHERS,
  MAX_PARTICLES,
  applyShake,
  damageTarget,
  dist,
  getAmmoCapacity,
  getRng,
  rand,
} from "./game-logic";
import type { EmpRing, GameState, SimEventSink, Threat } from "./types";

const EMP_SHAKE_TIMER = 22;
const EMP_SHAKE_INTENSITY = 14;
const EMP_SCRUB_TICKS = 7;
const EMP_GLITCH_TICKS = 12;
const EMP_ZOOM_TICKS = 10;
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

const EMP_BURJ_X = 462;
const EMP_BURJ_Y = 1047;
const EMP_BURJ_MAX_RADIUS = [650, 1040];
const EMP_LAUNCHER_MAX_RADIUS = 500;
const EMP_RANK2_EXPAND_RATE = 1.5;

export function empScrubScale(remainingTicks: number): number {
  if (remainingTicks <= 0) return 1;
  if (remainingTicks > 4) return 0;
  return 0.25;
}

function empRingExpansionSpeed(age: number): number {
  if (age <= 3) return EMP_RING_SPEED_INITIAL;
  if (age <= 8) return EMP_RING_SPEED_MID;
  return EMP_RING_SPEED_TAIL;
}

export function updateEmpVisualFx(g: GameState, dt: number): void {
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
  const seedBase = g.nextEmpFxId + x * 17 + y * 31 + originX * 7 + originY * 3;
  g.empBurstFlashes.push({
    id: g.nextEmpFxId++,
    x,
    y,
    life: 4,
    maxLife: 4,
    seed: seedBase,
    alive: true,
  });
  g.empArcs.push({
    id: g.nextEmpFxId++,
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

export function updateEmpRings(g: GameState, dt: number, allThreats: Threat[]): void {
  if (g.empRings.length > 0) {
    // Update active rings
    g.empRings.forEach((ring) => {
      const prevRadius = ring.radius;
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
      // Damage threats across the full annulus the front swept this tick (from
      // prevRadius to the new radius), not just a thin shell at the new radius.
      // The front can advance >30px/tick (rank-2 expandRate, or large dt), so a
      // fixed ±15 band leaves gaps that fast/close threats — e.g. diving Shaheds
      // bearing down on the Burj — tunnel straight through. hitSet keeps it once-per-threat.
      const bandInner = prevRadius - 15;
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

export function fireEmp(g: GameState, onEvent?: SimEventSink | null) {
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
        id: g.nextEmpFxId++,
        x: LAUNCHERS[i].x,
        y: GAMEPLAY_SCENIC_LAUNCHER_Y,
        life: 6,
        maxLife: 6,
        seed: g.nextEmpFxId + LAUNCHERS[i].x * 13 + GAMEPLAY_SCENIC_LAUNCHER_Y,
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
