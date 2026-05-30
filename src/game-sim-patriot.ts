import { CANVAS_H, CANVAS_W, COL, GROUND_Y, dist, getDefenseSitePlacement, rand } from "./game-logic.js";
import type { GameState, PatriotLaunchQueueItem, PatriotMissile, SimEventSink, Threat } from "./types.js";

type BurjImpactPredicate = (targetX: number | undefined, targetY: number | undefined) => boolean;
type PatriotDetonate = (x: number, y: number, radius: number, initialRadius: number) => void;

function getNearestThreatDistance(target: Threat, picked: readonly Threat[]): number {
  if (picked.length === 0) return Infinity;
  return picked.reduce((minDist, other) => Math.min(minDist, dist(target.x, target.y, other.x, other.y)), Infinity);
}

function getSpreadBonus(target: Threat, picked: readonly Threat[], cap: number, scale: number): number {
  const nearest = getNearestThreatDistance(target, picked);
  if (!Number.isFinite(nearest)) return 0;
  return Math.min(nearest, cap) * scale;
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

function isPatriotUrgentThreat(t: Threat, isBurjImpactTarget: BurjImpactPredicate): boolean {
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
  onEvent?: SimEventSink | null,
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
  onEvent?: SimEventSink | null,
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

function drainPatriotLaunchQueue(g: GameState, dt: number, allThreats: Threat[], onEvent?: SimEventSink | null): void {
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
  isBurjImpactTarget: BurjImpactPredicate,
  onEvent?: SimEventSink | null,
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

  const shouldFireNow =
    targets.length >= g.patriotReserveShots ||
    targets.some((target) => isPatriotUrgentThreat(target, isBurjImpactTarget));
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

export function updatePatriotSystem(
  g: GameState,
  dt: number,
  allThreats: Threat[],
  siteAlive: boolean,
  isBurjImpactTarget: BurjImpactPredicate,
  onEvent: SimEventSink | null | undefined,
  detonate: PatriotDetonate,
): void {
  // Patriot launching — only if site alive
  if (g.upgrades.patriot > 0 && siteAlive) {
    updatePatriotBattery(g, dt, allThreats, isBurjImpactTarget, onEvent);
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
      detonate(p.x, p.y, p.blastRadius * 0.5, p.blastRadius * 0.2);
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
      detonate(pTarget.x, pTarget.y, p.blastRadius, p.blastRadius * 0.4);
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
}
