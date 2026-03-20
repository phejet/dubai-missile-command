import { LAUNCHERS, GROUND_Y } from "../game-logic.js";

export function leadTarget(tx, ty, tvx, tvy, config, interceptorSpeed = 5, g = null, accel = 1) {
  const iterations = config.leadShot.iterations;
  const timeScale = config.leadShot.timeScaleFactor;

  // Lock the firing launcher — pick closest to original target (matching fireInterceptor)
  let launcherX = 450,
    launcherY = GROUND_Y;
  let bestDist = Infinity;
  for (let i = 0; i < LAUNCHERS.length; i++) {
    if (g && (g.ammo[i] <= 0 || g.launcherHP[i] <= 0)) continue;
    const d = Math.sqrt((tx - LAUNCHERS[i].x) ** 2 + (ty - LAUNCHERS[i].y) ** 2);
    if (d < bestDist) {
      bestDist = d;
      launcherX = LAUNCHERS[i].x;
      launcherY = LAUNCHERS[i].y;
    }
  }

  // Initial distance estimate for accel factor (computed once, not compounded)
  const initDist = Math.sqrt((tx - launcherX) ** 2 + (ty - launcherY) ** 2);
  const initFrames = (initDist / interceptorSpeed) * timeScale;
  const accelFactor = accel !== 1 ? accel ** (initFrames / 2) : 1;

  let aimX = tx,
    aimY = ty;
  for (let iter = 0; iter < iterations; iter++) {
    const d = Math.sqrt((aimX - launcherX) ** 2 + (aimY - launcherY) ** 2);
    const frames = (d / interceptorSpeed) * timeScale;
    aimX = tx + tvx * accelFactor * frames;
    aimY = Math.min(ty + tvy * accelFactor * frames, GROUND_Y - 25);
  }
  return { x: aimX, y: aimY };
}

export function botDecideAction(g, config, lastFireTick, tick) {
  const cfg = config.targeting;
  const interceptorSpeed = g.upgrades.launcherKit >= 3 ? 7 : 5;

  // Check if any launcher has ammo
  const hasAmmo = g.ammo.some((a, i) => a > 0 && g.launcherHP[i] > 0);
  if (!hasAmmo) return null;

  const inFlight = g.interceptors.filter((i) => i.alive).length;
  const allThreats = [];

  // Drones — diving ones are always priority 0, engage non-diving ones early
  for (const d of g.drones) {
    if (!d.alive) continue;
    if (d.diving) {
      const led = leadTarget(d.x, d.y, d.vx, d.vy, config, interceptorSpeed, g);
      allThreats.push({ ...led, priority: 0 });
    } else if (d.bombDropped && !d.diving) {
      // Transitional: bomb dropped but not yet diving — still a threat
      const led = leadTarget(d.x, d.y, d.vx, d.vy, config, interceptorSpeed, g);
      allThreats.push({ ...led, priority: 1 });
    } else if (d.y > cfg.minThreatY && !d.bombDropped) {
      // Engage horizontal drones before they drop bombs
      const [minX, maxX] = cfg.droneEngageRange;
      if ((d.vx > 0 && d.x > minX) || (d.vx < 0 && d.x < maxX)) {
        const led = leadTarget(d.x, d.y, d.vx, d.vy, config, interceptorSpeed, g);
        allThreats.push({ ...led, priority: 1 });
      }
    }
  }
  // Missiles — bombs get elevated priority, skip lured missiles
  for (const m of g.missiles) {
    if (!m.alive) continue;
    if (m.y < cfg.minThreatY) continue;
    if (m.luredByFlare) continue; // heading to flare, will miss — save ammo
    const led = leadTarget(m.x, m.y, m.vx, m.vy, config, interceptorSpeed, g, m.accel || 1);
    const priority =
      m.type === "bomb"
        ? m.y > cfg.missileYThresholds.urgent
          ? 0
          : 1
        : m.y > cfg.missileYThresholds.urgent
          ? 0
          : m.y > cfg.missileYThresholds.medium
            ? 1
            : 2;
    allThreats.push({ ...led, priority });
  }

  const totalAmmo = g.ammo.reduce((s, a) => s + a, 0);
  const threatCount = allThreats.length;
  const maxInFlight = threatCount > cfg.highThreatThreshold ? cfg.maxInFlightHigh : cfg.maxInFlightBase;
  let cooldown =
    totalAmmo < cfg.lowAmmoThreshold
      ? cfg.cooldownLowAmmo
      : threatCount > cfg.highThreatThreshold
        ? cfg.cooldownHighThreat
        : cfg.cooldownNormal;

  // Fire faster when jet drones (multi-HP) are present
  const hasJetDrone = g.drones.some((d) => d.alive && d.subtype === "shahed238" && d.y > cfg.minThreatY);
  if (hasJetDrone) cooldown = Math.floor(cooldown * 0.6);

  // Never fully throttle when there's an urgent (priority-0) threat
  const hasUrgentThreat = allThreats.some((t) => t.priority === 0);
  if (hasUrgentThreat && cooldown > cfg.cooldownHighThreat) {
    cooldown = cfg.cooldownHighThreat;
  }

  // Avoid hitting planes helper
  function isSafeFromPlanes(point) {
    if (!g.planes) return true;
    return !g.planes.some(
      (p) => p.alive && Math.sqrt((point.x - p.x) ** 2 + (point.y - p.y) ** 2) < config.planeAvoidance.radius,
    );
  }

  // Urgent fast-path: bypass inFlight cap for priority-0 threats
  if (hasUrgentThreat && tick - lastFireTick >= cooldown) {
    const urgentThreats = allThreats.filter((t) => t.priority === 0);
    urgentThreats.sort((a, b) => b.y - a.y);
    for (const ut of urgentThreats) {
      if (isSafeFromPlanes(ut)) {
        return {
          x: Math.max(20, Math.min(880, ut.x)),
          y: Math.max(20, Math.min(545, ut.y)),
        };
      }
    }
  }

  if (allThreats.length === 0 || inFlight >= maxInFlight || tick - lastFireTick < cooldown) {
    return null;
  }

  // Fast-exit: solo priority-0 threat — skip cluster scoring
  const p0Threats = allThreats.filter((t) => t.priority === 0);
  if (p0Threats.length === 1 && isSafeFromPlanes(p0Threats[0])) {
    return {
      x: Math.max(20, Math.min(880, p0Threats[0].x)),
      y: Math.max(20, Math.min(545, p0Threats[0].y)),
    };
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
    score += (4 - t.priority) * 12;
    if (score > bestScore) {
      bestScore = score;
      bestPoint = t;
    }
  }

  if (bestPoint && !isSafeFromPlanes(bestPoint)) {
    // Try other threats as fallback
    const sorted = allThreats
      .map((t) => {
        let score = 0;
        for (const o of allThreats) {
          const d = Math.sqrt((t.x - o.x) ** 2 + (t.y - o.y) ** 2);
          if (d < cfg.clusterRadius) score += 1;
        }
        score += (4 - t.priority) * 12;
        return { point: t, score };
      })
      .sort((a, b) => b.score - a.score);
    bestPoint = null;
    for (const s of sorted) {
      if (isSafeFromPlanes(s.point)) {
        bestPoint = s.point;
        break;
      }
    }
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
  const repairs = [];
  // Prioritize repairing destroyed launchers
  for (let i = 0; i < g.launcherHP.length; i++) {
    if (g.launcherHP[i] <= 0) repairs.push({ type: "repairLauncher", index: i });
  }
  // Prioritize repairing destroyed defense sites
  if (g.defenseSites) {
    for (const site of g.defenseSites) {
      if (!site.alive) repairs.push({ type: "repairSite", key: site.key });
    }
  }
  const priority = config.upgradePriority.filter((key) => {
    if (key === "burjRepair" && g.burjHealth >= 5) return false;
    return true;
  });
  return { repairs, priority };
}
