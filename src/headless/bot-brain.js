import { CANVAS_W, LAUNCHERS, GROUND_Y, getRng } from "../game-logic.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

function randIntRange(rng, min, max) {
  return Math.round(randRange(rng, min, max));
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function resolveBotConfig(baseConfig, presetName = null) {
  const { presets = {}, defaultPreset = "perfect", ...config } = baseConfig;
  const resolvedPreset = presetName || defaultPreset;
  const presetOverrides = presets[resolvedPreset];
  if (!presetOverrides) {
    throw new Error(`Unknown bot preset: ${resolvedPreset}`);
  }
  const resolved = deepMerge(config, presetOverrides);
  resolved.activePreset = resolvedPreset;
  return resolved;
}

function getHumanState(g) {
  if (!g._botHumanState) {
    g._botHumanState = {
      focusCenterX: CANVAS_W * 0.5,
      focusWidth: CANVAS_W * 0.45,
      focusUntil: 0,
      reactionDelay: 0,
      seenTicks: new WeakMap(),
      committedTargetRef: null,
      committedUntil: -Infinity,
    };
  }
  return g._botHumanState;
}

function refreshHumanFocus(state, human, tick, rng, committedTargetRef) {
  if (tick < state.focusUntil) return;
  const centers = [CANVAS_W * 0.2, CANVAS_W * 0.5, CANVAS_W * 0.8];
  const nextCenter =
    tick === 0 && state.focusUntil === 0
      ? CANVAS_W * 0.5
      : committedTargetRef && committedTargetRef.alive && rng() < 0.4
        ? clamp(committedTargetRef.x, CANVAS_W * 0.18, CANVAS_W * 0.82)
        : centers[Math.floor(rng() * centers.length)];
  state.focusCenterX = nextCenter;
  state.focusWidth = CANVAS_W * human.focusWidthRatio;
  state.focusUntil = tick + randIntRange(rng, human.focusDurationMin, human.focusDurationMax);
  state.reactionDelay = randIntRange(rng, human.reactionDelayMin, human.reactionDelayMax);
}

function humanizeThreats(g, threats, human, tick) {
  const rng = getRng();
  const state = getHumanState(g);
  if (g.wave < human.startWave || threats.length < human.minThreatCount) {
    return {
      state,
      perceived: threats.map((threat) => ({ ...threat, inFocus: true })),
    };
  }
  refreshHumanFocus(state, human, tick, rng, state.committedTargetRef);

  const perceived = [];
  for (const threat of threats) {
    if (!threat.targetRef?.alive) continue;
    const inFocus = Math.abs(threat.rawX - state.focusCenterX) <= state.focusWidth / 2;
    const highSalience = threat.isMirv || threat.priority <= 1 || threat.targetRef.diving;
    const urgentPeripheral = threat.rawY >= human.peripheralUrgentY;
    const urgentNoticeChance = threat.priority === 0 ? human.urgentNoticeChance : human.peripheralNoticeChance;
    const noticed = highSalience || inFocus || (urgentPeripheral && rng() < urgentNoticeChance);
    if (!noticed) continue;

    if (!state.seenTicks.has(threat.targetRef)) {
      state.seenTicks.set(threat.targetRef, tick);
    }
    const seenTick = state.seenTicks.get(threat.targetRef);
    const reactionDelay =
      threat.priority === 0 ? 0 : highSalience ? Math.floor(state.reactionDelay * 0.5) : state.reactionDelay;
    if (tick - seenTick < reactionDelay) continue;

    const priorityPenalty = !inFocus && !highSalience ? 1 : 0;
    perceived.push({ ...threat, inFocus, priority: Math.min(threat.priority + priorityPenalty, 3) });
  }

  return { state, perceived };
}

function applyHumanAim(point, human) {
  const rng = getRng();
  const leadBlend = randRange(rng, human.leadBlendMin, human.leadBlendMax);
  const jitterX = randRange(rng, -human.aimJitter, human.aimJitter);
  const jitterY = randRange(rng, -human.aimJitter, human.aimJitter);
  return {
    x: clamp(point.rawX + (point.x - point.rawX) * leadBlend + jitterX, 20, 880),
    y: clamp(point.rawY + (point.y - point.rawY) * leadBlend + jitterY, 20, 545),
  };
}

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
  const human = config.humanization?.enabled ? config.humanization : null;
  const rng = getRng();
  const interceptorSpeed = 5;

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
      allThreats.push({ ...led, rawX: d.x, rawY: d.y, priority: 0, targetRef: d });
    } else if (d.bombDropped && !d.diving) {
      // Transitional: bomb dropped but not yet diving — still a threat
      const led = leadTarget(d.x, d.y, d.vx, d.vy, config, interceptorSpeed, g);
      allThreats.push({ ...led, rawX: d.x, rawY: d.y, priority: 1, targetRef: d });
    } else if (d.y > cfg.minThreatY && !d.bombDropped) {
      // Engage horizontal drones before they drop bombs
      const [minX, maxX] = cfg.droneEngageRange;
      if ((d.vx > 0 && d.x > minX) || (d.vx < 0 && d.x < maxX)) {
        const led = leadTarget(d.x, d.y, d.vx, d.vy, config, interceptorSpeed, g);
        allThreats.push({ ...led, rawX: d.x, rawY: d.y, priority: 1, targetRef: d });
      }
    }
  }
  // Missiles — bombs get elevated priority, skip lured missiles
  for (const m of g.missiles) {
    if (!m.alive) continue;
    if (m.y < cfg.minThreatY) continue;
    if (m.luredByFlare) continue; // heading to flare, will miss — save ammo
    if (m.type === "mirv") {
      // MIRVs are always top priority — must kill before split
      const led = leadTarget(m.x, m.y, m.vx, m.vy, config, interceptorSpeed, g, m.accel || 1);
      allThreats.push({ ...led, rawX: m.x, rawY: m.y, priority: 0, isMirv: true, targetRef: m });
      continue;
    }
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
    allThreats.push({ ...led, rawX: m.x, rawY: m.y, priority, targetRef: m });
  }

  // Deprioritize threats that already have interceptors heading toward them
  const COVERED_RADIUS = 55; // slightly larger than explosion radius (49)
  for (const t of allThreats) {
    t.coveredBy = 0;
    for (const ic of g.interceptors) {
      if (!ic.alive) continue;
      const d = Math.sqrt((ic.targetX - t.x) ** 2 + (ic.targetY - t.y) ** 2);
      if (d < COVERED_RADIUS) t.coveredBy++;
    }
    // Demote covered threats: each existing interceptor adds 1 to priority (lower = more urgent)
    // MIRVs need multiple hits — never demote them
    if (t.isMirv) continue;
    const respectsCover = !human || rng() >= human.ignoreCoverChance;
    if (respectsCover && t.coveredBy > 0 && t.priority > 0) {
      t.priority = Math.min(t.priority + t.coveredBy, 3);
    }
  }

  let candidateThreats = allThreats;
  let humanState = null;
  if (human) {
    const humanized = humanizeThreats(g, allThreats, human, tick);
    humanState = humanized.state;
    candidateThreats = humanized.perceived;
  }

  const totalAmmo = g.ammo.reduce((s, a) => s + a, 0);
  const threatCount = candidateThreats.length;
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

  // Rapid fire when MIRV present — must kill before split
  const hasMirv = candidateThreats.some((t) => t.isMirv);
  if (hasMirv) cooldown = Math.floor(cooldown * (config.mirv?.cooldownMultiplier || 0.4));

  // Never fully throttle when there's an urgent (priority-0) threat
  const hasUrgentThreat = candidateThreats.some((t) => t.priority === 0);
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

  function finalizeAim(point) {
    const aimed = human ? applyHumanAim(point, human) : point;
    if (human && humanState && point.targetRef) {
      humanState.committedTargetRef = point.targetRef;
      humanState.committedUntil = tick + randIntRange(rng, human.commitmentDurationMin, human.commitmentDurationMax);
    }
    return {
      x: clamp(aimed.x, 20, 880),
      y: clamp(aimed.y, 20, 545),
    };
  }

  if (human && humanState && humanState.committedTargetRef && tick < humanState.committedUntil) {
    const committedThreat = candidateThreats.find((t) => t.targetRef === humanState.committedTargetRef);
    if (
      committedThreat &&
      tick - lastFireTick >= cooldown &&
      inFlight < maxInFlight &&
      rng() < human.commitmentChance &&
      isSafeFromPlanes(committedThreat)
    ) {
      return finalizeAim(committedThreat);
    }
  }

  // Urgent fast-path: bypass inFlight cap for priority-0 threats
  if (hasUrgentThreat && tick - lastFireTick >= cooldown) {
    const urgentThreats = candidateThreats.filter((t) => t.priority === 0);
    urgentThreats.sort((a, b) => b.y - a.y);
    for (const ut of urgentThreats) {
      if (isSafeFromPlanes(ut)) {
        return finalizeAim(ut);
      }
    }
  }

  if (candidateThreats.length === 0 || inFlight >= maxInFlight || tick - lastFireTick < cooldown) {
    return null;
  }

  // Fast-exit: solo priority-0 threat — skip cluster scoring
  const p0Threats = candidateThreats.filter((t) => t.priority === 0);
  if (p0Threats.length === 1 && isSafeFromPlanes(p0Threats[0])) {
    return finalizeAim(p0Threats[0]);
  }

  candidateThreats.sort((a, b) => a.priority - b.priority);

  // Find best cluster shot
  let bestPoint = null;
  let bestScore = 0;
  for (const t of candidateThreats) {
    let score = 0;
    for (const o of candidateThreats) {
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
    const sorted = candidateThreats
      .map((t) => {
        let score = 0;
        for (const o of candidateThreats) {
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
    return finalizeAim(bestPoint);
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
  let priority;
  if (config.upgradeStrategy === "random") {
    const rng = getRng();
    const pool = config.upgradePriority.filter((key) => {
      if (key === "burjRepair") return false;
      return true;
    });
    // Fisher-Yates shuffle
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    priority = shuffled;
  } else {
    priority = config.upgradePriority.filter((key) => {
      if (key === "burjRepair" && g.burjHealth >= 5) return false;
      return true;
    });
  }
  return { repairs, priority };
}
