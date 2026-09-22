/** Bounded cruise/turn/dive geometry. The same sampled path is followed by the sim. */
import {
  CANVAS_W,
  sampleCubicBezier,
  computeShahed136StraightPath,
  hitsBurjBody,
  getGameplayBurjCollisionTop,
  getGameplayBurjCollisionBottom,
  BURJ_X,
  BURJ_SHAPE,
} from "./game-logic";
import { missileAssets, rectEntry, towerRouteEntry, type Point, type RouteTarget } from "./missile-routing";
import { TARGET_PRESSURE } from "./target-pressure";
import type { GameState } from "./types";

export interface DroneRoute {
  target: RouteTarget;
  waypoints: Point[];
  diveStartIndex: number;
  tellIndex: number;
}
const cfg = TARGET_PRESSURE.drone;

export function diveCurve(start: Point, target: Point, dir: number, speed: number, jet: boolean): Point[] {
  return sampleCubicBezier(
    start,
    { x: start.x + dir * cfg.turnHandle, y: start.y },
    { x: target.x, y: target.y - cfg.terminalHandle },
    target,
    speed * (jet ? cfg.jetDiveSpeed : cfg.propDiveSpeed),
  );
}

/** Reject an earlier skyline collision, including between the waypoints. */
export function clearDronePath(assets: RouteTarget[], points: Point[], target: RouteTarget): boolean {
  let reached = false;
  const towerTop = getGameplayBurjCollisionTop(),
    towerBottom = getGameplayBurjCollisionBottom();
  const towerHalfWidth = Math.max(...BURJ_SHAPE.map(([, width]) => width)) * 2;
  const skylineTop = Math.min(towerTop, ...assets.map((a) => a.bounds.top));
  const segmentRect = (a: Point, b: Point, r: RouteTarget["bounds"]) =>
    Math.max(a.y, b.y) < r.top ||
    Math.min(a.y, b.y) > r.bottom ||
    Math.max(a.x, b.x) < r.left ||
    Math.min(a.x, b.x) > r.right
      ? null
      : rectEntry(a, b, r);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (b.x < -50 || b.x > CANVAS_W + 50) return false;
    if (Math.max(a.y, b.y) < skylineTop) continue;
    const tower =
      Math.max(a.y, b.y) < towerTop ||
      Math.min(a.y, b.y) > towerBottom ||
      Math.max(a.x, b.x) < BURJ_X - towerHalfWidth ||
      Math.min(a.x, b.x) > BURJ_X + towerHalfWidth
        ? null
        : towerRouteEntry(a, b);
    // Always protect the tower silhouette, even when checking a dead target continuation.
    if (target.category !== "tower" && tower !== null) return false;
    const intended = target.category === "tower" ? tower : segmentRect(a, b, target.bounds);
    for (const asset of assets) {
      if (asset.id === target.id || asset.category === "tower") continue;
      const hit = segmentRect(a, b, asset.bounds);
      if (hit !== null && !reached && (intended === null || hit < intended - TARGET_PRESSURE.geometryEpsilon))
        return false;
    }
    if (intended !== null) reached = true;
  }
  return reached;
}

export function droneRoutePool(g: GameState, start: Point, dir: number, speed: number, jet: boolean): DroneRoute[] {
  const assets = missileAssets(g),
    routes: DroneRoute[] = [];
  const cruiseSpeed = speed * (jet ? 1 : cfg.propCruiseSpeed);
  for (const target of assets) {
    for (const offset of cfg.diveOffsets) {
      const requestedX = target.x - dir * offset;
      const entryDistance = Math.max(0, dir > 0 ? cfg.tellInset - start.x : start.x - (CANVAS_W - cfg.tellInset));
      const distance = Math.max(entryDistance + cruiseSpeed * (cfg.tellTicks + 2), (requestedX - start.x) * dir);
      const transition = { x: start.x + dir * distance, y: start.y };
      if (transition.x < 0 || transition.x > CANVAS_W) continue;
      const cruise = computeShahed136StraightPath(start.x, start.y, cruiseSpeed, transition);
      const diveStartIndex = cruise.length - 1;
      const waypoints = cruise.concat(diveCurve(transition, target, dir, speed, jet).slice(1));
      if (!clearDronePath(assets, waypoints, target)) continue;
      routes.push({ target, waypoints, diveStartIndex, tellIndex: Math.max(0, diveStartIndex - cfg.tellTicks) });
      break;
    }
  }
  return routes;
}

/** Re-select only a feasible continuation of the already visible cruise. */
export function continuationPool(
  g: GameState,
  route: DroneRoute,
  dir: number,
  speed: number,
  jet: boolean,
): DroneRoute[] {
  const assets = missileAssets(g),
    prefix = route.waypoints.slice(0, route.diveStartIndex + 1);
  const start = prefix[prefix.length - 1];
  const candidates = assets.filter((a) => a.category === route.target.category);
  const preferred = candidates.find((a) => a.id === route.target.id);
  const ordered = preferred ? [preferred, ...candidates.filter((a) => a !== preferred)] : candidates;
  for (const target of ordered) {
    const waypoints = prefix.concat(diveCurve(start, target, dir, speed, jet).slice(1));
    if (clearDronePath(assets, waypoints, target)) return [{ ...route, target, waypoints }];
  }
  return [];
}

/** Remaining warning after the tell, including the propeller's real acceleration ramp. */
export function droneWarningTicks(g: GameState, route: DroneRoute, jet: boolean): number {
  let index = route.tellIndex,
    ramp = 1,
    ticks = 0;
  while (index < route.waypoints.length - 1 && ticks < TARGET_PRESSURE.horizonTicks) {
    if (!jet && index >= route.diveStartIndex) ramp = Math.min(cfg.propMaxRamp, ramp * cfg.propRamp);
    index = Math.min(index + ramp, route.waypoints.length - 1);
    ticks++;
    const i = Math.floor(index),
      f = index - i;
    const a = route.waypoints[i],
      b = route.waypoints[Math.min(i + 1, route.waypoints.length - 1)];
    const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    if (hitsBurjBody(g, p.x, p.y) || Math.hypot(p.x - route.target.x, p.y - route.target.y) < 20) break;
  }
  return ticks;
}
