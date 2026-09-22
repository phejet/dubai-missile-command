import {
  BURJ_X,
  BURJ_H,
  BURJ_SHAPE,
  CANVAS_W,
  CANVAS_H,
  GAMEPLAY_WATERLINE_Y,
  GAMEPLAY_SCENIC_BASE_Y,
  getGameplayBuildingBounds,
  getGameplayLauncherPosition,
  getGameplayBurjCollisionTop,
  getGameplayBurjCollisionBottom,
  getGameplayBurjHalfW,
  hitsBurjBody,
} from "./game-logic";
import type { GameState } from "./types";
import { TARGET_PRESSURE, type PressureCategory } from "./target-pressure";

export interface Point {
  x: number;
  y: number;
}
export interface RouteTarget extends Point {
  id: string;
  category: PressureCategory;
  bounds: { left: number; right: number; top: number; bottom: number };
}
export interface MissileRoute {
  start: Point;
  target: RouteTarget;
  vx: number;
  vy: number;
  accel: number;
  impactTicks: number;
  visibleTicks: number;
}
export interface RouteMotion {
  speed: number;
  accel: number;
  inheritedWarning?: number;
  minimumWarning?: number;
}
export type EntrySide = "left" | "right" | "top";

export function missileAssets(g: GameState): RouteTarget[] {
  const out: RouteTarget[] = [];
  if (g.burjAlive)
    out.push({
      id: "tower",
      category: "tower",
      x: BURJ_X,
      y: GAMEPLAY_SCENIC_BASE_Y - BURJ_H * 0.8,
      bounds: {
        left: BURJ_X - 30,
        right: BURJ_X + 30,
        top: getGameplayBurjCollisionTop(),
        bottom: getGameplayBurjCollisionBottom(),
      },
    });
  g.buildings.forEach((b, i) => {
    if (!b.alive) return;
    const bounds = getGameplayBuildingBounds(b);
    out.push({
      id: `building:${i}`,
      category: "building",
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
      bounds,
    });
  });
  g.defenseSites.forEach((s) => {
    if (!s.alive || !s.hw || !s.hh) return;
    out.push({
      id: `site:${s.key}`,
      category: "infrastructure",
      x: s.x,
      y: s.y,
      bounds: { left: s.x - s.hw, right: s.x + s.hw, top: s.y - s.hh, bottom: s.y + s.hh },
    });
  });
  g.launcherHP.forEach((hp, i) => {
    if (hp <= 0) return;
    const p = getGameplayLauncherPosition(i);
    out.push({
      id: `launcher:${i}`,
      category: "infrastructure",
      x: p.x,
      y: p.y,
      bounds: { left: p.x - 45, right: p.x + 45, top: p.y - 36, bottom: GAMEPLAY_WATERLINE_Y },
    });
  });
  return out;
}

/** Parametric line clipping: each constraint is a + b*t >= 0. */
function clipLine(constraints: Array<[number, number]>): number | null {
  let low = 0,
    high = 1;
  for (const [a, b] of constraints) {
    if (Math.abs(b) <= TARGET_PRESSURE.geometryEpsilon) {
      if (a < 0) return null;
    } else if (b > 0) low = Math.max(low, -a / b);
    else high = Math.min(high, -a / b);
  }
  return low <= high && high >= 0 && low <= 1 ? Math.max(0, low) : null;
}
export function rectEntry(a: Point, b: Point, r: RouteTarget["bounds"], margin = 0): number | null {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return clipLine([
    [a.x - r.left + margin, dx],
    [r.right + margin - a.x, -dx],
    [a.y - r.top + margin, dy],
    [r.bottom + margin - a.y, -dy],
  ]);
}

/** Piecewise-linear tower silhouette, including the spire/body width discontinuity. */
export function towerRouteEntry(a: Point, b: Point, margin = 0): number | null {
  const top = getGameplayBurjCollisionTop(),
    bottom = getGameplayBurjCollisionBottom();
  const ys = [top, ...BURJ_SHAPE.map(([fraction]) => GAMEPLAY_SCENIC_BASE_Y - BURJ_H * 2 * fraction), bottom]
    .filter((y) => y >= top && y <= bottom)
    .sort((x, y) => x - y);
  let result: number | null = null;
  for (let i = 0; i < ys.length - 1; i++) {
    const lo = ys[i],
      hi = ys[i + 1];
    if (hi <= lo) continue;
    const w0 = getGameplayBurjHalfW(lo + 1e-8),
      w1 = getGameplayBurjHalfW(hi - 1e-8);
    const slope = (w1 - w0) / (hi - lo);
    const w = w0 + (a.y - lo) * slope + margin + TARGET_PRESSURE.geometryEpsilon;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const hit = clipLine([
      [a.y - lo + margin, dy],
      [hi + margin - a.y, -dy],
      [BURJ_X + w - a.x, slope * dy - dx],
      [a.x - BURJ_X + w, dx + slope * dy],
    ]);
    if (hit !== null && (result === null || hit < result)) result = hit;
  }
  return result;
}
export function firstRouteAsset(g: GameState, assets: RouteTarget[], p: Point): RouteTarget | undefined {
  // Same point-sample order and strict boundaries as updateMissiles.
  return assets.find((a) => {
    if (a.category === "tower") return hitsBurjBody(g, p.x, p.y);
    const r = a.bounds;
    if (a.id.startsWith("site:")) return p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
    if (a.id.startsWith("launcher:")) return p.x > r.left && p.x < r.right && p.y >= r.top;
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  });
}
export function visiblePoint(p: Point): boolean {
  return p.x >= 0 && p.x <= CANVAS_W && p.y >= 0 && p.y <= CANVAS_H;
}

export function evaluateMissileRoute(
  g: GameState,
  assets: RouteTarget[],
  start: Point,
  target: RouteTarget,
  motion: RouteMotion,
  clearance = 0,
): MissileRoute | null {
  const dx = target.x - start.x,
    dy = target.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || dy <= 0) return null;
  const vx = (dx / length) * motion.speed,
    vy = (dy / length) * motion.speed;
  // A lost destination must not uncover a tower crossing farther down the same ray.
  const ground = { x: start.x + (dx / dy) * (GAMEPLAY_WATERLINE_Y - start.y), y: GAMEPLAY_WATERLINE_Y };
  if (target.category !== "tower" && g.burjAlive && towerRouteEntry(start, ground, clearance) !== null) return null;
  // Reject an intervening asset even if a fast tick could tunnel through it.
  const targetEntry =
    target.category === "tower" ? towerRouteEntry(start, ground) : rectEntry(start, ground, target.bounds);
  if (targetEntry === null) return null;
  for (const asset of assets) {
    if (asset.id === target.id || asset.category === "tower") continue;
    const hit = rectEntry(start, ground, asset.bounds, clearance);
    if (hit !== null && hit < targetEntry - TARGET_PRESSURE.geometryEpsilon) return null;
  }
  let x = start.x,
    y = start.y,
    speedX = vx,
    speedY = vy,
    visible = motion.inheritedWarning ?? 0;
  for (let tick = 1; tick <= TARGET_PRESSURE.horizonTicks; tick++) {
    if (visiblePoint({ x, y })) visible++;
    speedX *= motion.accel;
    speedY *= motion.accel;
    x += speedX;
    y += speedY;
    const hit = firstRouteAsset(g, assets, { x, y });
    if (hit)
      return hit.id === target.id && visible >= (motion.minimumWarning ?? TARGET_PRESSURE.warningTicks)
        ? { start, target, vx, vy, accel: motion.accel, impactTicks: tick, visibleTicks: visible }
        : null;
    if (y >= GAMEPLAY_WATERLINE_Y || x < -50 || x > CANVAS_W + 50 || y > CANVAS_H + 50) return null;
  }
  return null;
}

/**
 * How readable an approach is, 0..3, from geometry alone — no simulation needed.
 *
 * Every route `evaluateMissileRoute` returns already clears the visible-warning floor, so
 * ranking is free to optimise for what the player can actually track. Because this depends
 * only on the endpoints, candidates can be ordered before the expensive evaluation and the
 * first feasible one is then provably the best, which costs fewer evaluations than scanning.
 */
/**
 * A steep descent that also spends its whole visible life inside the outer band reads as a
 * glitch rather than an attack: the player never sees it travel. This is a hard rejection,
 * not a preference, because even a rare one looks like a bug. Steepness alone is fine — a
 * route that crosses from the interior out to an edge target is still readable — and so is
 * an edge entry that slants inward. Only the combination is barred.
 *
 * If it bars every candidate for a target, that target simply offers no route this spawn and
 * the shared ledger redistributes to another asset in the same category.
 */
export function isUnreadableApproach(start: Point, target: Point): boolean {
  const dy = target.y - start.y;
  if (dy <= 0) return true;
  const slope = Math.abs(target.x - start.x) / dy;
  if (slope >= TARGET_PRESSURE.readableSlope) return false;
  const midX = (start.x + target.x) / 2;
  return Math.min(midX, CANVAS_W - midX) < TARGET_PRESSURE.edgeBandFrac * CANVAS_W;
}

export function approachLegibility(start: Point, target: Point): number {
  const dy = target.y - start.y;
  if (dy <= 0) return 0;
  const slopeScore = Math.min(1, Math.abs(target.x - start.x) / dy / TARGET_PRESSURE.readableSlope);
  const edgeBand = TARGET_PRESSURE.edgeBandFrac * CANVAS_W;
  const midX = (start.x + target.x) / 2;
  const interiorScore = Math.min(1, Math.max(0, Math.min(midX, CANVAS_W - midX) / edgeBand));
  // Slope dominates: it is what lets the player lead the shot at all. Staying out of the
  // outer band breaks ties, and is what makes a forced-steep route readable rather than lost.
  return slopeScore * 2 + interiorScore;
}

export function entryRoutePool(g: GameState, side: EntrySide, preferred: Point, motion: RouteMotion): MissileRoute[] {
  const readable = buildEntryRoutes(g, side, preferred, motion, false);
  // Readability must never be able to stall a wave. When an entry side can reach nothing
  // legibly — a lone surviving building tucked into that same corner, say — an unreadable
  // approach beats no attack at all. In ordinary play some asset is always reachable, so
  // this fallback stays unused rather than quietly becoming the normal path.
  return readable.length > 0 ? readable : buildEntryRoutes(g, side, preferred, motion, true);
}

function buildEntryRoutes(
  g: GameState,
  side: EntrySide,
  preferred: Point,
  motion: RouteMotion,
  allowUnreadable: boolean,
): MissileRoute[] {
  const assets = missileAssets(g),
    routes: MissileRoute[] = [];
  for (const target of assets) {
    const origins: Point[] = [preferred];
    for (let i = 0; i < TARGET_PRESSURE.entrySamples; i++) {
      const t = i / (TARGET_PRESSURE.entrySamples - 1);
      origins.push(
        side === "top"
          ? { x: 50 + t * (CANVAS_W - 100), y: preferred.y }
          : {
              x: side === "left" ? -10 : CANVAS_W + 10,
              y: TARGET_PRESSURE.sideY[0] + t * (TARGET_PRESSURE.sideY[1] - TARGET_PRESSURE.sideY[0]),
            },
      );
    }
    // Straight down onto the target always works geometrically and is the least readable
    // route there is, so it is scored like any other candidate and ends up last.
    if (side === "top") origins.push({ x: Math.max(50, Math.min(CANVAS_W - 50, target.x)), y: preferred.y });

    const ranked = origins
      .filter((start) => allowUnreadable || !isUnreadableApproach(start, target))
      .map((start) => ({ start, score: approachLegibility(start, target) }))
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) continue;
    // Keep the randomised preferred origin in front while it is nearly as readable as the
    // best candidate, so repeat attacks on one target do not all fly the identical line.
    const preferredIndex = ranked.findIndex((c) => c.start === preferred);
    if (preferredIndex > 0 && ranked[preferredIndex].score >= ranked[0].score - TARGET_PRESSURE.legibilitySlack) {
      ranked.unshift(...ranked.splice(preferredIndex, 1));
    }

    let best: MissileRoute | null = null;
    for (const { start } of ranked) {
      // Candidates are ordered by legibility, so the first feasible one is the best one.
      best = evaluateMissileRoute(g, assets, start, target, motion);
      if (best) break;
    }
    if (best) routes.push(best);
  }
  return routes;
}
