import { CANVAS_W, computeShahed136StraightPath, rand } from "./game-logic";
import {
  evaluateMissileRoute,
  missileAssets,
  visiblePoint,
  type MissileRoute,
  type RouteTarget,
} from "./missile-routing";
import { pressureLedger } from "./pressure-missiles";
import {
  choosePressureCategory,
  commitPressure,
  finishPressure,
  reservePressure,
  TARGET_PRESSURE,
  type PressureCategory,
} from "./target-pressure";
import { continuationPool, droneRoutePool, droneWarningTicks, type DroneRoute } from "./drone-routing";
import type { Drone, GameState } from "./types";

export interface DroneBombPlan {
  unitId: number;
  vy: number;
  target?: RouteTarget;
  transferred: boolean;
}
export interface DronePressurePlan {
  unitId?: number;
  route?: DroneRoute;
  committed: boolean;
  speed: number;
  dir: number;
  visibleTicks: number;
  bombs: DroneBombPlan[];
  legacy?: boolean;
}

function cancel(g: GameState, id: number, outcome: "no-route" | "target-lost") {
  const unit = pressureLedger(g).units[id];
  if (unit?.state === "reserved") {
    unit.state = "cancelled";
    unit.outcome = outcome;
  }
}
function reserveChoice(g: GameState, targets: RouteTarget[], family: string) {
  const ledger = pressureLedger(g);
  const choice = choosePressureCategory(
    ledger.units.length,
    targets.map((t) => t.category),
    missileAssets(g).some((a) => a.category !== "tower"),
  );
  const requested = TARGET_PRESSURE.sequence[ledger.units.length % TARGET_PRESSURE.sequence.length];
  const selected = choice ?? { requested, category: requested };
  const id = reservePressure(ledger, selected, "unreachable", family, g.waveTick);
  if (!choice) cancel(g, id, "no-route");
  return { id, category: selected.category, eligible: !!choice };
}

export function bombRoutePool(
  g: GameState,
  d: Pick<Drone, "x" | "y">,
  vy: number,
  inheritedWarning = 0,
): MissileRoute[] {
  const assets = missileAssets(g);
  return assets.flatMap((target) => {
    // Aim just inside roofs: retain vertical velocity and existing point collision/damage.
    const aim = { ...target, y: target.category === "tower" ? target.y : target.bounds.top + 1 };
    if (aim.y <= d.y) return [];
    const vx = ((aim.x - d.x) * vy) / (aim.y - d.y);
    const route = evaluateMissileRoute(g, assets, d, aim, {
      speed: Math.hypot(vx, vy),
      accel: 1,
      minimumWarning: 0,
      inheritedWarning,
    });
    return route ? [route] : [];
  });
}
function chooseRoute<T extends { target: RouteTarget }>(
  routes: T[],
  category: PressureCategory,
  preferred?: string,
  roll = 0,
): T | undefined {
  const eligible = routes.filter((r) => r.target.category === category);
  return (
    eligible.find((r) => r.target.id === preferred) ??
    eligible[Math.min(eligible.length - 1, Math.floor(roll * eligible.length))]
  );
}

export function planDronePressure(g: GameState, d: Drone, speed: number, diving: boolean, bombCount: number): void {
  const jet = d.subtype === "shahed238",
    dir = d.vx > 0 ? 1 : -1;
  const plan: DronePressurePlan = { committed: false, speed, dir, visibleTicks: 0, bombs: [] };
  d.pressure = plan;
  if (diving) {
    const routes = droneRoutePool(g, d, dir, speed, jet);
    const choice = reserveChoice(
      g,
      routes.map((r) => r.target),
      jet ? "jet-dive" : "prop-dive",
    );
    plan.unitId = choice.id;
    const route = choice.eligible ? chooseRoute(routes, choice.category, undefined, rand(0, 1)) : undefined;
    if (route) {
      plan.route = route;
      pressureLedger(g).units[choice.id].destination = route.target.id;
      d.waypoints = route.waypoints;
      d.diveStartIndex = route.diveStartIndex;
      // Provisional aim remains internal until the visible commitment.
    }
  }
  if (!plan.route) {
    d.waypoints = computeShahed136StraightPath(
      d.x,
      d.y,
      speed * (jet || !diving ? 1 : TARGET_PRESSURE.drone.propCruiseSpeed),
      { x: dir > 0 ? CANVAS_W + 80 : -80, y: d.y },
    );
  }
  d.pathIndex = 0;
  d.bombsDropped = 0;
  const cruiseEnd = d.diveStartIndex ?? d.waypoints!.length - 1;
  d.bombIndices =
    bombCount === 2
      ? [
          Math.max(1, Math.floor(cruiseEnd * TARGET_PRESSURE.drone.jetFirstBombFraction)),
          Math.max(
            2,
            Math.min(
              cruiseEnd - 1,
              Math.floor(cruiseEnd * TARGET_PRESSURE.drone.jetFirstBombFraction) +
                Math.min(
                  TARGET_PRESSURE.drone.jetBombSeparationTicks,
                  Math.floor(cruiseEnd * TARGET_PRESSURE.drone.jetBombSeparationFraction),
                ),
            ),
          ),
        ]
      : bombCount === 1
        ? [Math.max(1, Math.floor(cruiseEnd * TARGET_PRESSURE.drone.propBombCruiseFraction))]
        : [];
  for (const index of d.bombIndices) {
    const vy = rand(...TARGET_PRESSURE.drone.bombVy);
    const routes = bombRoutePool(g, d.waypoints![index], vy, index);
    const choice = reserveChoice(
      g,
      routes.map((r) => r.target),
      "bomb",
    );
    const route = choice.eligible ? chooseRoute(routes, choice.category, undefined, rand(0, 1)) : undefined;
    if (route) pressureLedger(g).units[choice.id].destination = route.target.id;
    plan.bombs.push({ unitId: choice.id, vy, target: route?.target, transferred: false });
  }
}

export function prepareDroneCommitment(g: GameState, d: Drone, dt: number): void {
  const plan = d.pressure;
  if (!plan) return;
  if (visiblePoint(d)) plan.visibleTicks += dt;
  if (!plan.route || plan.committed || (d.pathIndex ?? 0) < plan.route.tellIndex) return;
  const unit = pressureLedger(g).units[plan.unitId!];
  const routes = continuationPool(g, plan.route, plan.dir, plan.speed, d.subtype === "shahed238");
  const route = chooseRoute(routes, unit.category, unit.destination);
  if (!route) {
    cancel(g, plan.unitId!, "target-lost");
    // Keep the flown prefix, and extend the exact same cruise line through the exit.
    const prefix = d.waypoints!.slice(0, plan.route.diveStartIndex + 1);
    const last = prefix[prefix.length - 1];
    d.waypoints = prefix.concat(
      computeShahed136StraightPath(
        last.x,
        last.y,
        plan.speed * (d.subtype === "shahed238" ? 1 : TARGET_PRESSURE.drone.propCruiseSpeed),
        { x: plan.dir > 0 ? CANVAS_W + 80 : -80, y: last.y },
      ).slice(1),
    );
    d.diveStartIndex = undefined;
    plan.route = undefined;
    return;
  }
  unit.destination = route.target.id;
  if (
    !commitPressure(pressureLedger(g), plan.unitId!, g.waveTick, droneWarningTicks(g, route, d.subtype === "shahed238"))
  )
    return;
  plan.route = route;
  plan.committed = true;
  d.waypoints = route.waypoints;
  d.diveTarget = { x: route.target.x, y: route.target.y };
}

export function dropPressureBomb(g: GameState, d: Drone): void {
  if (!d.pressure) {
    d.pressure = {
      committed: false,
      speed: Math.abs(d.vx),
      dir: Math.sign(d.vx),
      visibleTicks: 0,
      bombs: [],
      legacy: true,
    };
  }
  const plan = d.pressure;
  if (plan.legacy && !plan.bombs[d.bombsDropped ?? 0]) {
    const vy = rand(...TARGET_PRESSURE.drone.bombVy);
    const routes = bombRoutePool(g, d, vy);
    const choice = reserveChoice(
      g,
      routes.map((r) => r.target),
      "bomb",
    );
    const target = choice.eligible ? chooseRoute(routes, choice.category)?.target : undefined;
    plan.bombs[d.bombsDropped ?? 0] = { unitId: choice.id, vy, target, transferred: false };
  }
  const bomb = plan.bombs[d.bombsDropped ?? 0];
  if (!bomb || bomb.transferred) return;
  const ledger = pressureLedger(g),
    unit = ledger.units[bomb.unitId];
  if (unit.state !== "reserved") return;
  const routes = bombRoutePool(g, d, bomb.vy, plan.visibleTicks);
  const route = chooseRoute(routes, unit.category, unit.destination);
  if (!route) {
    cancel(g, bomb.unitId, "target-lost");
    return;
  }
  unit.destination = route.target.id;
  if (!commitPressure(ledger, bomb.unitId, g.waveTick, route.visibleTicks)) return;
  bomb.transferred = true;
  bomb.target = route.target;
  g.missiles.push({
    x: d.x,
    y: d.y,
    vx: route.vx,
    vy: route.vy,
    accel: 1,
    trail: [],
    alive: true,
    type: "bomb",
    targetX: route.target.x,
    targetY: route.target.y,
    variant: d.variant ?? "normal",
    speedMul: d.speedMul ?? 1,
    _hitByExplosions: new Set(),
    pressure: { unitIds: [bomb.unitId], visibleTicks: plan.visibleTicks, children: [] },
  });
}

export function settleDronePressure(g: GameState): void {
  if (!g.targetPressure) return;
  for (const d of g.drones) {
    if (d.alive || !d.pressure) continue;
    const ids = d.pressure.bombs.filter((b) => !b.transferred).map((b) => b.unitId);
    if (d.pressure.unitId !== undefined) ids.push(d.pressure.unitId);
    finishPressure(g.targetPressure, ids, !!d.killedBy);
  }
}
