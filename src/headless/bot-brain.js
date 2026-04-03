import { CANVAS_W, LAUNCHERS, GROUND_Y, getRng } from "../game-logic.js";
const HUMAN_CURSOR_START_X = CANVAS_W * 0.5;
const HUMAN_CURSOR_START_Y = 800;

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
      cursorX: HUMAN_CURSOR_START_X,
      cursorY: HUMAN_CURSOR_START_Y,
      moveFromX: HUMAN_CURSOR_START_X,
      moveFromY: HUMAN_CURSOR_START_Y,
      moveTargetX: HUMAN_CURSOR_START_X,
      moveTargetY: HUMAN_CURSOR_START_Y,
      moveStartTick: 0,
      moveEndTick: 0,
      pendingTargetRef: null,
      pendingAimX: HUMAN_CURSOR_START_X,
      pendingAimY: HUMAN_CURSOR_START_Y,
      pendingRawX: HUMAN_CURSOR_START_X,
      pendingRawY: HUMAN_CURSOR_START_Y,
      pendingReadyTick: -Infinity,
      clickReadyTick: -Infinity,
      lastClickTick: -Infinity,
      burstShots: 0,
      burstWindowUntil: -Infinity,
      burstCooldownUntil: -Infinity,
      lastTargetRef: null,
      lastLane: 1,
      lastTick: 0,
    };
  }
  return g._botHumanState;
}

function getLaneForX(x) {
  if (x < CANVAS_W / 3) return 0;
  if (x < (CANVAS_W * 2) / 3) return 1;
  return 2;
}

function updateHumanCursorState(state, tick) {
  if (tick < state.lastTick) return;
  if (state.moveEndTick > state.moveStartTick && tick < state.moveEndTick) {
    const t = clamp((tick - state.moveStartTick) / (state.moveEndTick - state.moveStartTick), 0, 1);
    state.cursorX = state.moveFromX + (state.moveTargetX - state.moveFromX) * t;
    state.cursorY = state.moveFromY + (state.moveTargetY - state.moveFromY) * t;
  } else if (tick >= state.moveEndTick) {
    state.cursorX = state.moveTargetX;
    state.cursorY = state.moveTargetY;
  }
  state.lastTick = tick;
}

function scheduleHumanAim(state, human, point, desiredAim, tick, rng) {
  const sameTarget = state.pendingTargetRef === point.targetRef || state.lastTargetRef === point.targetRef;
  const lane = getLaneForX(desiredAim.x);
  const prevLane = state.lastLane ?? getLaneForX(state.cursorX);
  const laneDelta = Math.abs(lane - prevLane);
  let attentionTicks = randIntRange(rng, human.attentionShiftMin, human.attentionShiftMax);
  if (sameTarget) {
    attentionTicks *= human.sameTargetAttentionMultiplier;
  } else if (lane === prevLane) {
    attentionTicks *= human.sameLaneAttentionMultiplier;
  }
  if (point.priority === 0) {
    attentionTicks *= human.urgentReactionMultiplier;
  }
  attentionTicks += laneDelta * human.laneSwitchPenalty;

  const distance = Math.sqrt((desiredAim.x - state.cursorX) ** 2 + (desiredAim.y - state.cursorY) ** 2);
  const moveSpeed = sameTarget ? human.cursorTrackSpeedPxPerTick : human.cursorSpeedPxPerTick;
  let moveTicks = distance / Math.max(1, moveSpeed);
  if (sameTarget) moveTicks *= human.sameTargetMoveMultiplier;
  let settleTicks = randIntRange(rng, human.settleTicksMin, human.settleTicksMax);
  if (sameTarget) settleTicks = Math.max(0, Math.round(settleTicks * human.sameTargetMoveMultiplier));

  state.moveFromX = state.cursorX;
  state.moveFromY = state.cursorY;
  state.moveTargetX = desiredAim.x;
  state.moveTargetY = desiredAim.y;
  state.moveStartTick = tick;
  state.moveEndTick = tick + Math.max(0, Math.round(moveTicks + settleTicks));
  state.pendingTargetRef = point.targetRef;
  state.pendingAimX = desiredAim.x;
  state.pendingAimY = desiredAim.y;
  state.pendingRawX = point.x;
  state.pendingRawY = point.y;
  state.pendingReadyTick = Math.max(state.moveEndTick, tick + Math.max(0, Math.round(attentionTicks)));
}

function prepareHumanAim(state, human, point, tick, rng) {
  updateHumanCursorState(state, tick);
  const desiredAim = applyHumanAim(point, human);
  const retargetThreshold = human.retargetAimThreshold ?? 24;
  const needsNewPlan =
    state.pendingTargetRef !== point.targetRef ||
    Math.sqrt((point.x - state.pendingRawX) ** 2 + (point.y - state.pendingRawY) ** 2) > retargetThreshold;

  if (needsNewPlan) {
    scheduleHumanAim(state, human, point, desiredAim, tick, rng);
    if (tick < state.pendingReadyTick) return null;
  }

  if (tick < state.pendingReadyTick || tick < state.clickReadyTick || tick < state.burstCooldownUntil) {
    return null;
  }

  if (tick > state.burstWindowUntil) {
    state.burstShots = 0;
  }
  state.burstShots += 1;
  state.burstWindowUntil = tick + human.burstWindowTicks;
  if (state.burstShots >= human.maxBurstShots) {
    state.burstShots = 0;
    state.burstCooldownUntil = tick + randIntRange(rng, human.burstRecoveryMin, human.burstRecoveryMax);
  }

  state.cursorX = state.pendingAimX;
  state.cursorY = state.pendingAimY;
  state.moveFromX = state.cursorX;
  state.moveFromY = state.cursorY;
  state.moveTargetX = state.cursorX;
  state.moveTargetY = state.cursorY;
  state.moveStartTick = tick;
  state.moveEndTick = tick;
  state.clickReadyTick = tick + human.minClickInterval;
  state.lastClickTick = tick;
  state.lastTargetRef = point.targetRef;
  state.lastLane = getLaneForX(state.pendingAimX);

  return {
    x: clamp(state.pendingAimX, 20, 880),
    y: clamp(state.pendingAimY, 20, GROUND_Y - 25),
  };
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
    y: clamp(point.rawY + (point.y - point.rawY) * leadBlend + jitterY, 20, GROUND_Y - 25),
  };
}

export function leadTarget(tx, ty, tvx, tvy, config, interceptorSpeed = 5, g = null, accel = 1) {
  const iterations = config.leadShot.iterations;
  const timeScale = config.leadShot.timeScaleFactor;

  const { x: launcherX, y: launcherY } = pickLauncher(tx, ty, g);

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

function pickLauncher(tx, ty, g = null) {
  let launcherX = 450;
  let launcherY = GROUND_Y;
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
  return { x: launcherX, y: launcherY, dist: bestDist };
}

function sampleWaypoints(waypoints, pathIndex) {
  const clampedIndex = clamp(pathIndex, 0, waypoints.length - 1);
  const i0 = Math.floor(clampedIndex);
  const frac = clampedIndex - i0;
  const i1 = Math.min(i0 + 1, waypoints.length - 1);
  return {
    x: waypoints[i0].x + (waypoints[i1].x - waypoints[i0].x) * frac,
    y: waypoints[i0].y + (waypoints[i1].y - waypoints[i0].y) * frac,
  };
}

function leadShahed238Target(drone, config, interceptorSpeed, g) {
  if (!drone.waypoints?.length || drone.luredByFlare) {
    return leadTarget(drone.x, drone.y, drone.vx, drone.vy, config, interceptorSpeed, g);
  }

  const { x: launcherX, y: launcherY } = pickLauncher(drone.x, drone.y, g);
  const iterations = config.leadShot.iterations;
  const timeScale = config.leadShot.timeScaleFactor;
  const pathStepPerTick = drone.empSlowTimer > 0 ? 0.4 : 1;

  let aim = { x: drone.x, y: drone.y };
  for (let iter = 0; iter < iterations; iter++) {
    const d = Math.sqrt((aim.x - launcherX) ** 2 + (aim.y - launcherY) ** 2);
    const frames = (d / interceptorSpeed) * timeScale;
    const futureIndex = (drone.pathIndex ?? 0) + frames * pathStepPerTick;
    aim = sampleWaypoints(drone.waypoints, futureIndex);
  }

  return { x: aim.x, y: Math.min(aim.y, GROUND_Y - 25) };
}

function leadThreatTarget(targetRef, config, interceptorSpeed, g, accel = 1) {
  if (targetRef.type === "drone" && targetRef.subtype === "shahed238") {
    return leadShahed238Target(targetRef, config, interceptorSpeed, g);
  }
  return leadTarget(targetRef.x, targetRef.y, targetRef.vx, targetRef.vy, config, interceptorSpeed, g, accel);
}

function getThreatReservationLimit(threat) {
  if (threat?.isMirv) return 2;
  return 1;
}

function getActiveBotReservations(g, tick) {
  const active = (g._botTargetReservations || []).filter(
    (reservation) => reservation.targetRef?.alive && reservation.untilTick > tick,
  );
  g._botTargetReservations = active;
  return active;
}

export function reserveBotTarget(g, targetRef, untilTick, tick) {
  if (!targetRef || !Number.isFinite(untilTick) || untilTick <= tick) return;
  const reservations = getActiveBotReservations(g, tick);
  const existing = reservations.find((reservation) => reservation.targetRef === targetRef);
  if (existing) {
    existing.untilTick = Math.max(existing.untilTick, untilTick);
    return;
  }
  reservations.push({ targetRef, untilTick });
}

export function botDecideAction(g, config, lastFireTick, tick) {
  const cfg = config.targeting;
  const human = config.humanization?.enabled ? config.humanization : null;
  const rng = getRng();
  // Interceptors start at 10.88 px/tick, accelerate to 18.56 over ~18 ticks.
  // Average across a typical 60-80 tick flight is ~16 px/tick.
  const interceptorSpeed = 16;

  // Check if any launcher has ammo
  const hasAmmo = g.ammo.some((a, i) => a > 0 && g.launcherHP[i] > 0);
  if (!hasAmmo) return null;
  const humanState = human ? getHumanState(g) : null;
  if (humanState) {
    updateHumanCursorState(humanState, tick);
    g.crosshairX = humanState.cursorX;
    g.crosshairY = humanState.cursorY;
  }

  const inFlight = g.interceptors.filter((i) => i.alive).length;
  const reservations = getActiveBotReservations(g, tick);
  const allThreats = [];

  // Drones — diving ones are always priority 0, engage non-diving ones early
  for (const d of g.drones) {
    if (!d.alive) continue;
    if (d.diving) {
      const led = leadThreatTarget(d, config, interceptorSpeed, g);
      allThreats.push({ ...led, rawX: d.x, rawY: d.y, priority: 0, targetRef: d });
    } else if (d.bombDropped && !d.diving) {
      // Transitional: bomb dropped but not yet diving — still a threat
      const led = leadThreatTarget(d, config, interceptorSpeed, g);
      allThreats.push({ ...led, rawX: d.x, rawY: d.y, priority: 1, targetRef: d });
    } else if (d.y > cfg.minThreatY && !d.bombDropped) {
      // Engage horizontal drones before they drop bombs
      const [minX, maxX] = cfg.droneEngageRange;
      if ((d.vx > 0 && d.x > minX) || (d.vx < 0 && d.x < maxX)) {
        const led = leadThreatTarget(d, config, interceptorSpeed, g);
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
      const led = leadThreatTarget(m, config, interceptorSpeed, g, m.accel || 1);
      allThreats.push({ ...led, rawX: m.x, rawY: m.y, priority: 0, isMirv: true, targetRef: m });
      continue;
    }
    const led = leadThreatTarget(m, config, interceptorSpeed, g, m.accel || 1);
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

  // Deprioritize threats that already have interceptors heading toward them.
  // Actual explosion radius is 74px; proximity fuse is 72px. Scale coverage to account
  // for lead-shot prediction drift as the threat falls between consecutive shots.
  const COVERED_RADIUS = 120;
  for (const t of allThreats) {
    t.reservationLimit = getThreatReservationLimit(t);
    t.coveredBy = 0;
    for (const ic of g.interceptors) {
      if (!ic.alive) continue;
      const d = Math.sqrt((ic.targetX - t.x) ** 2 + (ic.targetY - t.y) ** 2);
      if (d < COVERED_RADIUS) t.coveredBy++;
    }
    t.reservedBy =
      t.reservationLimit > 0 ? reservations.filter((reservation) => reservation.targetRef === t.targetRef).length : 0;
    if (t.reservedBy > 0) {
      t.coveredBy = Math.max(t.coveredBy, t.reservedBy);
    }
    t.blocked = t.reservationLimit > 0 && t.reservedBy >= t.reservationLimit;
    // Demote covered threats: each existing interceptor adds 1 to priority (lower = more urgent)
    // MIRVs need multiple hits — never demote them
    if (t.isMirv) continue;
    const respectsCover = !human || rng() >= human.ignoreCoverChance;
    if (respectsCover && t.coveredBy > 0 && t.priority > 0) {
      t.priority = Math.min(t.priority + t.coveredBy, 3);
    }
  }

  let candidateThreats = allThreats;
  if (human) {
    const humanized = humanizeThreats(g, allThreats, human, tick);
    candidateThreats = humanized.perceived;
  }
  candidateThreats = candidateThreats.filter((threat) => !threat.blocked);

  const totalAmmo = g.ammo.reduce((s, a) => s + a, 0);
  const threatCount = candidateThreats.length;
  const maxInFlight = threatCount > cfg.highThreatThreshold ? cfg.maxInFlightHigh : cfg.maxInFlightBase;
  const fireRecoveryTicks = human ? 0 : cfg.fireRecoveryTicks || 0;
  let cooldown =
    totalAmmo < cfg.lowAmmoThreshold
      ? cfg.cooldownLowAmmo
      : threatCount > cfg.highThreatThreshold
        ? cfg.cooldownHighThreat
        : cfg.cooldownNormal;
  if (fireRecoveryTicks > cooldown) cooldown = fireRecoveryTicks;

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
    if (human && humanState && point.targetRef) {
      humanState.committedTargetRef = point.targetRef;
      humanState.committedUntil = tick + randIntRange(rng, human.commitmentDurationMin, human.commitmentDurationMax);
    }
    const result = human ? prepareHumanAim(humanState, human, point, tick, rng) : { x: point.x, y: point.y };
    if (!result) return null;
    if (point.reservationLimit > 0) {
      const { dist } = pickLauncher(result.x, result.y, g);
      const frames = (dist / interceptorSpeed) * config.leadShot.timeScaleFactor;
      const reserveFraction = point.priority === 0 ? 0.3 : 0.5;
      result.targetRef = point.targetRef;
      result.reservationUntil = tick + Math.max(cooldown + 1, Math.ceil(frames * reserveFraction));
    }
    return result;
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
      const committedAim = finalizeAim(committedThreat);
      if (committedAim) return committedAim;
    }
  }

  // Urgent fast-path: bypass inFlight cap for priority-0 threats, but still respect cover
  if (hasUrgentThreat && tick - lastFireTick >= cooldown) {
    const urgentThreats = candidateThreats.filter((t) => t.priority === 0);
    urgentThreats.sort((a, b) => b.y - a.y);
    for (const ut of urgentThreats) {
      if (!ut.isMirv && ut.coveredBy > 0) continue;
      if (isSafeFromPlanes(ut)) {
        const urgentAim = finalizeAim(ut);
        if (urgentAim) return urgentAim;
      }
    }
  }

  if (candidateThreats.length === 0 || inFlight >= maxInFlight || tick - lastFireTick < cooldown) {
    return null;
  }

  // Fast-exit: solo priority-0 threat — skip cluster scoring
  const p0Threats = candidateThreats.filter((t) => t.priority === 0);
  if (p0Threats.length === 1 && isSafeFromPlanes(p0Threats[0])) {
    const fastAim = finalizeAim(p0Threats[0]);
    if (fastAim) return fastAim;
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
