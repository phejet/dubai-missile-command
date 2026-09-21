import { CANVAS_W, getRng, rand } from "./game-logic";
import type { GameState, Missile, SpawnEntry } from "./types";
import {
  entryRoutePool,
  evaluateMissileRoute,
  missileAssets,
  visiblePoint,
  type EntrySide,
  type MissileRoute,
  type Point,
  type RouteTarget,
} from "./missile-routing";
import {
  choosePressureCategory,
  commitPressure,
  createPressureLedger,
  finishPressure,
  reservePressure,
  recordPressureInvariantFailure,
  TARGET_PRESSURE,
  type PressureLedger,
} from "./target-pressure";

type MissileKind = "missile" | "mirv" | "stack2" | "stack3";
interface ChildSample {
  speed: number;
  offset: Point;
  roll: number;
}
export interface PendingMissileSpawn {
  key: string;
  retryAt: number;
  side: EntrySide;
  preferred: Point;
  speed: number;
  accel: number;
  speedMul: number;
  variant: "normal" | "fast";
  splitY: number;
  count: number;
  roll: number;
  children: ChildSample[];
}
export interface PressureChildPlan {
  unitId: number;
  target: RouteTarget;
  offset: Point;
  speed: number;
  accel: number;
  warningTicks: number;
}
export interface PressureMissilePlan {
  unitIds: number[];
  visibleTicks: number;
  children: PressureChildPlan[];
}

export function pressureLedger(g: GameState): PressureLedger {
  if (!g.targetPressure || g.targetPressure.wave !== g.wave) {
    g.targetPressure = createPressureLedger(g.wave);
    g.pendingMissileSpawn = undefined;
  }
  return g.targetPressure;
}
function sampleSpawn(
  g: GameState,
  kind: MissileKind,
  overrides: SpawnEntry["overrides"],
  key: string,
): PendingMissileSpawn {
  const mirv = kind === "mirv",
    speedMul = overrides?.speedMul ?? 1;
  const speed = (mirv ? rand(0.6, 0.9) + g.wave * 0.05 : rand(0.5, 1) + g.wave * 0.08) * 2 * speedMul;
  let side: EntrySide = mirv ? "top" : (overrides?.side ?? "top");
  if (!mirv && !overrides?.side && g.wave >= 2 && getRng()() < Math.min(0.4, (g.wave - 1) * 0.1))
    side = getRng()() > 0.5 ? "left" : "right";
  const preferred =
    side === "top"
      ? { x: rand(mirv ? 100 : 50, CANVAS_W - (mirv ? 100 : 50)), y: mirv ? -20 : -10 }
      : { x: side === "left" ? -10 : CANVAS_W + 10, y: rand(...TARGET_PRESSURE.sideY) };
  const count = mirv
    ? 5 + Math.min(3, Math.max(0, Math.floor((g.wave - 8) / 3)))
    : kind === "stack3"
      ? 3
      : kind === "stack2"
        ? 2
        : 1;
  return {
    key,
    side,
    preferred,
    speed,
    speedMul,
    accel: mirv ? 1.018 : 1.0045 + g.wave * 0.0009,
    variant: overrides?.variant ?? "normal",
    splitY: mirv ? rand(180, 300) : 0,
    count,
    roll: getRng()(),
    retryAt: 0,
    children: Array.from({ length: mirv ? count : count - 1 }, () => ({
      speed: mirv ? (rand(0.8, 1.2) + g.wave * 0.06) * speedMul : 0,
      offset: mirv ? { x: rand(-20, 20), y: rand(-10, 10) } : { x: 0, y: 0 },
      roll: getRng()(),
    })),
  };
}

/** Category precedes distance/variation; short warning cannot displace a fair route in that category. */
function chooseRoute(
  ledger: PressureLedger,
  routes: MissileRoute[],
  livingNonTower: boolean,
  roll: number,
  emptyFlankFallback = false,
) {
  const choice = choosePressureCategory(
    ledger.units.length,
    routes.map((r) => r.target.category),
    livingNonTower,
    emptyFlankFallback,
  );
  if (!choice) return null;
  const eligible = routes.filter((r) => r.target.category === choice.category);
  if (!eligible.length) return null;
  const fair = eligible.filter((r) => r.visibleTicks >= TARGET_PRESSURE.warningTicks);
  const bestWarning = Math.max(...eligible.map((r) => r.visibleTicks));
  const pool = fair.length ? fair : eligible.filter((r) => r.visibleTicks === bestWarning);
  if (!pool.length) return null;
  return { route: pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))], choice };
}
function splitPosition(route: MissileRoute, splitY: number, splitDistance: number) {
  let x = route.start.x,
    y = route.start.y,
    vx = route.vx,
    vy = route.vy,
    travel = 0,
    visible = 0;
  for (let tick = 1; tick <= route.impactTicks; tick++) {
    if (visiblePoint({ x, y })) visible++;
    vx *= route.accel;
    vy *= route.accel;
    x += vx;
    y += vy;
    travel += Math.hypot(vx, vy);
    if (y >= splitY || travel >= splitDistance) return { x, y, vx, vy, visible, tick };
  }
  return null;
}

export function spawnPressureMissile(g: GameState, kind: MissileKind, overrides?: SpawnEntry["overrides"]): boolean {
  const ledger = pressureLedger(g);
  const key = JSON.stringify([g.wave, kind, overrides ?? null]);
  let pending = g.pendingMissileSpawn;
  if (!pending || pending.key !== key) pending = g.pendingMissileSpawn = sampleSpawn(g, kind, overrides, key);
  if (g.waveTick < pending.retryAt) return false;
  const assets = missileAssets(g),
    livingNonTower = assets.some((a) => a.category !== "tower");
  const routes = entryRoutePool(g, pending.side, pending.preferred, {
    speed: pending.speed,
    accel: pending.accel,
    minimumWarning: 0,
  });
  const mirv = kind === "mirv";
  const emptyFlankFallback =
    pending.side !== "top" &&
    !g.missiles.some((m) => m.alive) &&
    !g.drones.some((d) => d.alive) &&
    !routes.some((r) => r.target.category !== "tower");
  const first = chooseRoute(ledger, routes, livingNonTower, pending.roll, emptyFlankFallback);
  // MIRV carriers aren't quota units. Their pre-split segment is validated below.
  let parents = mirv ? routes : first ? routes.filter((r) => r.target.category === first.choice.category) : [];
  if (!mirv && first) parents = [first.route, ...parents.filter((r) => r !== first.route)];
  if (mirv && parents.length) {
    const rotation = Math.floor(pending.roll * parents.length);
    parents = [...parents.slice(rotation), ...parents.slice(0, rotation)];
  }
  let bestPlan: {
    route: MissileRoute;
    transaction: PressureLedger;
    unitIds: number[];
    children: PressureChildPlan[];
    splitAfterDist: number;
    shortfall: number;
  } | null = null;
  for (const route of parents) {
    const transaction: PressureLedger = { ...ledger, units: ledger.units.slice() };
    const unitIds: number[] = [],
      children: PressureChildPlan[] = [];
    const splitAfterDist = Math.hypot(route.target.x - route.start.x, route.target.y - route.start.y) * 0.2;
    if (!mirv) {
      const choice = choosePressureCategory(
        transaction.units.length,
        [route.target.category],
        livingNonTower,
        emptyFlankFallback,
      );
      if (!choice) continue;
      const id = reservePressure(transaction, choice, route.target.id, kind, g.waveTick);
      if (!commitPressure(transaction, id, g.waveTick, route.visibleTicks)) continue;
      unitIds.push(id);
    }
    if (pending.count > 1) {
      const split = splitPosition(route, mirv ? pending.splitY : Infinity, mirv ? Infinity : splitAfterDist);
      if (!split || split.tick >= route.impactTicks) continue;
      let failed = false;
      for (let i = 0; i < pending.children.length; i++) {
        const sample = pending.children[i];
        const speed = mirv ? sample.speed : Math.hypot(split.vx, split.vy);
        const accel = mirv ? 1.018 + g.wave * 0.0036 : pending.accel;
        const candidates: Array<{ route: MissileRoute; offset: Point }> = [];
        for (const target of assets) {
          const dx = target.x - split.x,
            dy = target.y - split.y,
            len = Math.hypot(dx, dy);
          const magnitude = (i - (pending.children.length - 1) / 2) * 8;
          const offset = mirv ? sample.offset : { x: (-dy / len) * magnitude, y: (dx / len) * magnitude };
          const start = { x: split.x + offset.x, y: split.y + offset.y };
          const child = evaluateMissileRoute(g, assets, start, target, {
            speed,
            accel,
            inheritedWarning: split.visible,
            minimumWarning: 0,
          });
          if (child) candidates.push({ route: child, offset });
        }
        const selected = chooseRoute(
          transaction,
          candidates.map((c) => c.route),
          livingNonTower,
          sample.roll,
          emptyFlankFallback,
        );
        if (!selected) {
          failed = true;
          break;
        }
        const candidate = candidates.find((c) => c.route === selected.route)!;
        const id = reservePressure(transaction, selected.choice, selected.route.target.id, kind, g.waveTick);
        unitIds.push(id);
        children.push({
          unitId: id,
          target: selected.route.target,
          offset: candidate.offset,
          speed,
          accel,
          warningTicks: selected.route.visibleTicks,
        });
      }
      if (failed) continue;
    }
    const shortfall =
      children.reduce((sum, c) => sum + Math.max(0, TARGET_PRESSURE.warningTicks - c.warningTicks), 0) +
      (mirv ? 0 : Math.max(0, TARGET_PRESSURE.warningTicks - route.visibleTicks));
    if (!bestPlan || shortfall < bestPlan.shortfall)
      bestPlan = { route, transaction, unitIds, children, splitAfterDist, shortfall };
    if (shortfall === 0) break;
  }
  if (bestPlan) {
    const { route, transaction, unitIds, children, splitAfterDist } = bestPlan;
    ledger.units = transaction.units;
    ledger.lastConflict = undefined;
    g.pendingMissileSpawn = undefined;
    g.missiles.push({
      ...route.start,
      vx: route.vx,
      vy: route.vy,
      accel: pending.accel,
      trail: [],
      alive: true,
      type: kind,
      targetX: route.target.x,
      targetY: route.target.y,
      variant: pending.variant,
      speedMul: pending.speedMul,
      ...(mirv
        ? { health: 1, maxHealth: 1, splitY: pending.splitY, warheadCount: pending.count, splitTriggered: false }
        : pending.count > 1
          ? { splitTriggered: false, splitAfterDist, travelDist: 0 }
          : {}),
      pressure: { unitIds, visibleTicks: 0, children },
      _hitByExplosions: new Set(),
    });
    return true;
  }
  ledger.deferredAttempts++;
  ledger.lastConflict = `${kind}:${pending.side}:no-eligible-route`;
  pending.retryAt = g.waveTick + TARGET_PRESSURE.retryTicks;
  return false;
}

/** Frozen targets, actual split origins. No target selection or new quota at split time. */
export function splitPressureMissile(g: GameState, m: Missile): void {
  const plan = m.pressure;
  const ledger = g.targetPressure ?? (g.targetPressure = createPressureLedger(g.wave));
  const mirv = m.type === "mirv";
  const expectedChildren = mirv ? m.warheadCount : m.type === "stack3" ? 2 : 1;
  // Validate the whole transfer before committing any child. Corrupt carriers retire;
  // they never invent replacement attacks or crash the player's frame loop.
  if (
    !plan ||
    ledger.wave !== g.wave ||
    plan.children.length !== expectedChildren ||
    new Set(plan.children.map((child) => child.unitId)).size !== plan.children.length ||
    plan.children.some(
      (child) =>
        !plan.unitIds.includes(child.unitId) ||
        ledger.units[child.unitId]?.state !== "reserved" ||
        ledger.units[child.unitId]?.destination !== child.target.id,
    )
  ) {
    recordPressureInvariantFailure(ledger, "Invalid pressure ownership at missile split; carrier retired");
    if (plan && ledger.wave === g.wave) finishPressure(ledger, plan.unitIds, false);
    m.alive = false;
    m.pressure = undefined;
    return;
  }
  for (const child of plan.children) {
    const x = m.x + child.offset.x,
      y = m.y + child.offset.y;
    const dx = child.target.x - x,
      dy = child.target.y - y,
      length = Math.hypot(dx, dy);
    const speed = mirv ? child.speed : Math.hypot(m.vx, m.vy);
    if (!commitPressure(ledger, child.unitId, g.waveTick, child.warningTicks)) continue;
    g.missiles.push({
      x,
      y,
      vx: (dx / length) * speed,
      vy: (dy / length) * speed,
      accel: child.accel,
      trail: [],
      alive: true,
      type: mirv ? "mirv_warhead" : "stack_child",
      targetX: child.target.x,
      targetY: child.target.y,
      variant: m.variant,
      speedMul: m.speedMul,
      pressure: { unitIds: [child.unitId], visibleTicks: plan.visibleTicks, children: [] },
      _hitByExplosions: new Set(),
    });
  }
  if (mirv) {
    m.alive = false;
    m.pressure = undefined;
  } else {
    m.type = "stack_child";
    m.trail = [];
    plan.unitIds = plan.unitIds.slice(0, 1);
    plan.children = [];
  }
}
export function settleMissilePressure(g: GameState): void {
  if (!g.targetPressure) return;
  for (const missile of g.missiles) {
    if (!missile.alive && missile.pressure)
      finishPressure(g.targetPressure, missile.pressure.unitIds, !!missile.killedBy);
  }
}
