import { LAUNCHERS, GROUND_Y, dist } from "../game-logic.js";

const INTERCEPTOR_SPEED = 5;

export function leadTarget(tx, ty, tvx, tvy, config) {
  const iterations = config.leadShot.iterations;
  const timeScale = config.leadShot.timeScaleFactor;
  let aimX = tx,
    aimY = ty;
  for (let iter = 0; iter < iterations; iter++) {
    let best = Infinity;
    for (const l of LAUNCHERS) {
      const d = Math.sqrt((aimX - l.x) ** 2 + (aimY - l.y) ** 2);
      if (d < best) best = d;
    }
    const frames = (best / INTERCEPTOR_SPEED) * timeScale;
    aimX = tx + tvx * frames;
    aimY = Math.min(ty + tvy * frames, GROUND_Y - 25);
  }
  return { x: aimX, y: aimY };
}

export function botDecideAction(g, config, lastFireTick, tick) {
  const cfg = config.targeting;
  const inFlight = g.interceptors.filter((i) => i.alive).length;
  const allThreats = [];

  // Diving shaheds — highest priority
  for (const d of g.drones) {
    if (!d.alive) continue;
    if (d.diving && d.y > cfg.minThreatY) {
      const led = leadTarget(d.x, d.y, d.vx, d.vy, config);
      allThreats.push({ ...led, priority: 0 });
    }
  }
  // Missiles
  for (const m of g.missiles) {
    if (!m.alive) continue;
    if (m.y < cfg.minThreatY) continue;
    const led = leadTarget(m.x, m.y, m.vx, m.vy, config);
    const priority = m.y > cfg.missileYThresholds.urgent ? 0 : m.y > cfg.missileYThresholds.medium ? 1 : 2;
    allThreats.push({ ...led, priority });
  }

  const totalAmmo = g.ammo.reduce((s, a) => s + a, 0);
  const threatCount = allThreats.length;
  const maxInFlight = threatCount > cfg.highThreatThreshold ? cfg.maxInFlightHigh : cfg.maxInFlightBase;
  const cooldown =
    totalAmmo < cfg.lowAmmoThreshold
      ? cfg.cooldownLowAmmo
      : threatCount > cfg.highThreatThreshold
        ? cfg.cooldownHighThreat
        : cfg.cooldownNormal;

  if (allThreats.length === 0 || inFlight >= maxInFlight || tick - lastFireTick < cooldown) {
    return null;
  }

  allThreats.sort((a, b) => a.priority - b.priority);

  // Find best cluster shot
  let bestPoint = null;
  let bestScore = 0;
  for (const t of allThreats) {
    let score = 0;
    for (const o of allThreats) {
      const d = Math.sqrt((t.x - o.x) ** 2 + (t.y - o.y) ** 2);
      if (d < cfg.clusterRadius) score += 1;
    }
    score += 4 - t.priority;
    if (score > bestScore) {
      bestScore = score;
      bestPoint = t;
    }
  }

  // Avoid hitting planes
  if (bestPoint && g.planes) {
    const tooClose = g.planes.some(
      (p) => p.alive && Math.sqrt((bestPoint.x - p.x) ** 2 + (bestPoint.y - p.y) ** 2) < config.planeAvoidance.radius,
    );
    if (tooClose) return null;
  }

  if (bestPoint) {
    return {
      x: Math.max(20, Math.min(880, bestPoint.x)),
      y: Math.max(20, Math.min(545, bestPoint.y)),
    };
  }
  return null;
}

export function botDecideUpgrades(g, config) {
  const toBuy = [];
  for (const key of config.upgradePriority) {
    toBuy.push(key);
  }
  return toBuy;
}
