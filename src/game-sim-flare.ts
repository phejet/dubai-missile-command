import { BURJ_X, COL, GROUND_Y, LAUNCHERS, dist, getAmmoCapacity, getRng, ov, rand } from "./game-logic.js";
import type { Drone, Flare, GameState, Missile, SimEventSink, Threat } from "./types.js";

type FlareThreat = Missile | Drone;

export interface FlareDeps {
  boom: (
    g: GameState,
    x: number,
    y: number,
    radius: number,
    color: string,
    playerCaused: boolean,
    onEvent: SimEventSink | null | undefined,
    initialRadius?: number,
    options?: Record<string, unknown>,
  ) => void;
  destroyThreat: (g: GameState, threat: FlareThreat) => void;
  recordNeutralized: (g: GameState, threat: FlareThreat) => void;
  onEvent?: SimEventSink | null;
}

// Flare tuning lives here so feel work does not require archaeology through the sim monolith.
const FLARE_HOT_RADIUS = 60;
const FLARE_CONTROL_PATIENCE = 200;
const FLARE_LURE_MISSILE_TURN = 0.2;
const FLARE_LURE_DRONE_TURN = 0.15;
const FLARE_TURNCOAT_TURN = 0.24;
const FLARE_REACQUIRE_RADIUS = 80;

function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function isDrone(threat: FlareThreat): threat is Drone {
  return threat.type === "drone";
}

function collectAirborneThreats(g: GameState): FlareThreat[] {
  return [...g.missiles.filter((m) => m.alive), ...g.drones.filter((d) => d.alive)];
}

function steerTowardPoint(
  entity: { x: number; y: number; vx: number; vy: number },
  tx: number,
  ty: number,
  dt: number,
  turnRate: number,
): number {
  const dx = tx - entity.x;
  const dy = ty - entity.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return len;
  const speed = Math.max(0.001, Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy));
  const currentHeading = Math.atan2(entity.vy, entity.vx);
  const desiredHeading = Math.atan2(dy, dx);
  const headingDelta = normalizeAngle(desiredHeading - currentHeading);
  const maxTurn = turnRate * dt;
  const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
  const nextHeading = currentHeading + appliedTurn;
  entity.vx = Math.cos(nextHeading) * speed;
  entity.vy = Math.sin(nextHeading) * speed;
  return len;
}

function getLiveFlare(g: GameState, flareId: number | null | undefined): Flare | null {
  if (flareId == null) return null;
  return g.flares.find((f) => f.id === flareId && f.alive) || null;
}

function launchFlareSalvo(g: GameState, count: number): Flare[] {
  const originY = ov("upgrade.flares.y", 837);
  const flareLife = ov("flare.flareLife", 150);
  const spawned: Flare[] = [];
  const safeCount = Math.max(1, Math.round(count));
  const fanAngle = ov("flare.fanAngle", Math.PI * 0.78);
  const ejectSpeed = ov("flare.ejectSpeed", 3.6);
  const flareDrag = ov("flare.drag", 0.993);

  for (let i = 0; i < safeCount; i++) {
    const t = safeCount === 1 ? 0.5 : i / (safeCount - 1);
    const centered = t - 0.5;
    const angle = centered * fanAngle + rand(-0.07, 0.07);
    const speed = ejectSpeed * rand(0.85, 1.15);
    const flare: Flare = {
      id: g.nextFlareId++,
      x: BURJ_X + rand(-6, 6),
      y: originY + rand(-4, 4),
      vx: Math.sin(angle) * speed,
      vy: -Math.cos(angle) * speed,
      drag: flareDrag,
      life: flareLife,
      maxLife: flareLife,
      alive: true,
      hotRadius: FLARE_HOT_RADIUS,
      trail: [],
    };
    g.flares.push(flare);
    spawned.push(flare);
  }

  return spawned;
}

function nearestFlareForThreat(threat: Threat, flares: Flare[], maxDistance = Infinity): Flare | null {
  let best: Flare | null = null;
  let bestDist = maxDistance;
  for (const flare of flares) {
    if (!flare.alive) continue;
    const d = dist(threat.x, threat.y, flare.x, flare.y);
    if (d < bestDist) {
      best = flare;
      bestDist = d;
    }
  }
  return best;
}

function spawnFlareLureSparks(g: GameState, x: number, y: number): void {
  for (let i = 0; i < 5; i++) {
    g.particles.push({
      x,
      y,
      vx: rand(-1.5, 1.5),
      vy: rand(-1.5, 1.5),
      life: 20,
      maxLife: 20,
      color: "#ffaa44",
      size: 1.5,
    });
  }
}

function seduceThreat(g: GameState, threat: FlareThreat, flare: Flare): void {
  if (!threat.alive || threat.flareControl) return;
  threat.flareControl = {
    mode: "seduced",
    flareId: flare.id,
    patience: FLARE_CONTROL_PATIENCE,
  };
  spawnFlareLureSparks(g, threat.x, threat.y);
}

function seduceNearFlares(
  g: GameState,
  flares: Flare[],
  opts: { centerX?: number; centerY?: number; radius: number },
): void {
  if (flares.length === 0) return;
  for (const threat of collectAirborneThreats(g)) {
    if (threat.flareControl) continue;
    if (
      opts.centerX != null &&
      opts.centerY != null &&
      dist(threat.x, threat.y, opts.centerX, opts.centerY) > opts.radius
    ) {
      continue;
    }
    const flare = nearestFlareForThreat(threat, flares, opts.centerX == null ? opts.radius : Infinity);
    if (flare) seduceThreat(g, threat, flare);
  }
}

function claimedVictims(g: GameState, self?: FlareThreat): Set<FlareThreat> {
  const claimed = new Set<FlareThreat>();
  for (const threat of collectAirborneThreats(g)) {
    if (threat === self) continue;
    const victim = threat.flareControl?.mode === "turncoat" ? threat.flareControl.victim : null;
    if (victim?.alive) claimed.add(victim);
  }
  return claimed;
}

function pickTurncoatVictim(g: GameState, attacker: FlareThreat, maxDistance = Infinity): FlareThreat | null {
  const claimed = claimedVictims(g, attacker);
  const candidates = collectAirborneThreats(g)
    .filter((target) => target !== attacker && !target.flareControl && !claimed.has(target))
    .sort((a, b) => dist(attacker.x, attacker.y, a.x, a.y) - dist(attacker.x, attacker.y, b.x, b.y))
    .filter((target) => dist(attacker.x, attacker.y, target.x, target.y) <= maxDistance);

  const candidateCap = Math.max(1, Math.round(ov("flare.redirectCandidates", 3)));
  const capped = candidates.slice(0, candidateCap);
  if (capped.length === 0) return null;
  return capped[Math.floor(getRng()() * capped.length)] ?? null;
}

// Lost guidance or timed out: the threat wandered off without reaching a payoff
// point, so it dies harmlessly and unscored (it was never really "killed").
function selfNeutralize(g: GameState, threat: FlareThreat, deps: FlareDeps): void {
  if (!threat.alive) return;
  threat.alive = false;
  threat.flareControl = null;
  deps.recordNeutralized(g, threat);
  deps.boom(g, threat.x, threat.y, 15, COL.flare, false, deps.onEvent, 0, { harmless: true });
}

// Spent itself with no target to turn against: the threat reached its payoff but
// found nothing to redirect onto, so it detonates in place as a scored kill.
function spendThreat(g: GameState, threat: FlareThreat, deps: FlareDeps): void {
  if (!threat.alive) return;
  threat.flareControl = null;
  deps.destroyThreat(g, threat);
  deps.boom(g, threat.x, threat.y, 65, COL.flare, true, deps.onEvent, 15);
}

function consumeAtFlare(g: GameState, threat: FlareThreat, flare: Flare, deps: FlareDeps): void {
  flare.alive = false;
  threat.flareControl = null;
  deps.destroyThreat(g, threat);
  deps.boom(g, flare.x, flare.y, 65, COL.flare, true, deps.onEvent, 15);
}

function promoteToTurncoat(g: GameState, threat: FlareThreat, flare: Flare, deps: FlareDeps): void {
  const victim = pickTurncoatVictim(g, threat);
  if (!victim) {
    // Nothing to turn it against — take the kill at the decoy instead of fizzling.
    consumeAtFlare(g, threat, flare, deps);
    return;
  }
  flare.alive = false;
  threat.flareControl = {
    mode: "turncoat",
    victim,
    patience: FLARE_CONTROL_PATIENCE,
  };
}

function detonateTurncoat(
  g: GameState,
  threat: FlareThreat,
  victim: FlareThreat,
  impactRadius: number,
  deps: FlareDeps,
): void {
  const x = (threat.x + victim.x) / 2;
  const y = (threat.y + victim.y) / 2;
  threat.flareControl = null;
  deps.destroyThreat(g, threat);
  deps.destroyThreat(g, victim);
  deps.boom(g, x, y, impactRadius, COL.flare, true, deps.onEvent, impactRadius * 0.55, {
    visualType: victim.type === "drone" ? "drone" : "missile",
  });
  const rootEx = g.explosions[g.explosions.length - 1];
  if (rootEx) {
    rootEx.kills = (rootEx.kills ?? 0) + 2;
    rootEx.heroPulse = Math.min(1.6, 0.65 + rootEx.kills * 0.18);
  }
}

function pushControlledTrail(threat: FlareThreat): void {
  if (isDrone(threat)) {
    threat.trail ??= [];
    threat.trail.push({ x: threat.x, y: threat.y });
    if (threat.trail.length > (threat.subtype === "shahed238" ? 13 : 10)) threat.trail.shift();
    return;
  }

  threat.trail.push({ x: threat.x, y: threat.y });
  if (threat.trail.length > 21) threat.trail.shift();
}

function driveSeducedThreat(g: GameState, threat: FlareThreat, dt: number, deps: FlareDeps): void {
  const control = threat.flareControl;
  if (!control || control.mode !== "seduced") return;
  const flare = getLiveFlare(g, control.flareId);
  if (!flare) {
    selfNeutralize(g, threat, deps);
    return;
  }

  const turnRate = isDrone(threat) ? FLARE_LURE_DRONE_TURN : FLARE_LURE_MISSILE_TURN;
  const beforeDist = steerTowardPoint(threat, flare.x, flare.y, dt, turnRate);
  if (beforeDist <= flare.hotRadius) {
    if (g.upgrades.flare >= 2) promoteToTurncoat(g, threat, flare, deps);
    else consumeAtFlare(g, threat, flare, deps);
    return;
  }

  pushControlledTrail(threat);
  threat.x += threat.vx * dt;
  threat.y += threat.vy * dt;

  if (dist(threat.x, threat.y, flare.x, flare.y) <= flare.hotRadius) {
    if (g.upgrades.flare >= 2) promoteToTurncoat(g, threat, flare, deps);
    else consumeAtFlare(g, threat, flare, deps);
    return;
  }

  control.patience -= dt;
  if (control.patience <= 0) selfNeutralize(g, threat, deps);
}

function driveTurncoatThreat(g: GameState, threat: FlareThreat, dt: number, deps: FlareDeps): void {
  const control = threat.flareControl;
  if (!control || control.mode !== "turncoat") return;
  let victim = control.victim;
  if (!victim?.alive) {
    victim = pickTurncoatVictim(g, threat, FLARE_REACQUIRE_RADIUS) ?? undefined;
    if (!victim) {
      // Lost its target with nothing in reach — detonate in place as a scored kill.
      spendThreat(g, threat, deps);
      return;
    }
    control.victim = victim;
  }

  const impactRadius = ov("flare.redirectAOE", 45);
  if (dist(threat.x, threat.y, victim.x, victim.y) <= impactRadius) {
    detonateTurncoat(g, threat, victim, impactRadius, deps);
    return;
  }

  steerTowardPoint(threat, victim.x, victim.y, dt, FLARE_TURNCOAT_TURN);
  pushControlledTrail(threat);
  threat.x += threat.vx * dt;
  threat.y += threat.vy * dt;

  if (dist(threat.x, threat.y, victim.x, victim.y) <= impactRadius) {
    detonateTurncoat(g, threat, victim, impactRadius, deps);
    return;
  }

  control.patience -= dt;
  if (control.patience <= 0) selfNeutralize(g, threat, deps);
}

function updateFlarePhysics(g: GameState, dt: number): void {
  const flareGravity = ov("flare.gravity", 0.024);
  const flareTrailMax = Math.max(4, Math.round(ov("flare.trailLength", 22)));
  for (const flare of g.flares) {
    if (!flare.alive) continue;
    flare.trail.push({ x: flare.x, y: flare.y });
    if (flare.trail.length > flareTrailMax) flare.trail.shift();
    flare.x += flare.vx * dt;
    flare.y += flare.vy * dt;
    flare.vy += flareGravity * dt;
    flare.vx *= flare.drag ** dt;
    flare.life -= dt;
    if (flare.life <= 0 || flare.y >= GROUND_Y - 10) flare.alive = false;
    flare.sparkAccum = (flare.sparkAccum || 0) + dt;
    if (flare.life > 24 && flare.sparkAccum >= 4) {
      flare.sparkAccum -= 4;
      g.particles.push({
        x: flare.x,
        y: flare.y,
        vx: rand(-0.7, 0.7),
        vy: rand(0.1, 1.1),
        life: 12,
        maxLife: 12,
        color: COL.flare,
        size: rand(1, 2),
      });
    }
  }
  g.flares = g.flares.filter((flare) => flare.alive);
}

function updateFlareSalvoQueue(g: GameState): void {
  if (g.flareSalvoQueue.length === 0) return;
  const ready = g.flareSalvoQueue.filter((drop) => drop.fireAt <= g.waveTick);
  g.flareSalvoQueue = g.flareSalvoQueue.filter((drop) => drop.fireAt > g.waveTick);
  for (const drop of ready) {
    const flares = launchFlareSalvo(g, drop.count);
    seduceNearFlares(g, flares, {
      centerX: BURJ_X,
      centerY: ov("upgrade.flares.y", 837),
      radius: ov("flare.lureRadius", 600),
    });
  }
}

export function updateFlares(g: GameState, dt: number, deps: FlareDeps): void {
  updateFlareSalvoQueue(g);
  updateFlarePhysics(g, dt);
  seduceNearFlares(g, g.flares, { radius: ov("flare.tickLureRadius", 200) });

  for (const threat of collectAirborneThreats(g)) {
    if (!threat.flareControl) continue;
    if (threat.flareControl.mode === "seduced") driveSeducedThreat(g, threat, dt, deps);
    else driveTurncoatThreat(g, threat, dt, deps);
  }
}

export function fireFlareSalvo(g: GameState, onEvent?: SimEventSink | null): boolean {
  if (!g.flareReadyThisWave || g.upgrades.flare <= 0) return false;
  const lvl = g.upgrades.flare;
  const originY = ov("upgrade.flares.y", 837);
  const lureRadius = ov("flare.lureRadius", 600);
  g.flareReadyThisWave = false;

  const isL2 = lvl >= 2;
  const dropCount = Math.max(1, Math.round(ov(isL2 ? "flare.salvoCountL2" : "flare.salvoCountL1", isL2 ? 6 : 3)));
  const drops = Math.max(1, Math.round(ov(isL2 ? "flare.salvoDropsL2" : "flare.salvoDropsL1", 3)));
  const spacing = Math.max(
    1,
    Math.round(ov(isL2 ? "flare.salvoSpacingTicksL2" : "flare.salvoSpacingTicksL1", isL2 ? 60 : 30)),
  );
  const initial = launchFlareSalvo(g, dropCount);
  seduceNearFlares(g, initial, { centerX: BURJ_X, centerY: originY, radius: lureRadius });
  g.flareSalvoQueue = Array.from({ length: Math.max(0, drops - 1) }, (_, i) => ({
    fireAt: g.waveTick + spacing * (i + 1),
    count: dropCount,
  }));

  if (isL2) {
    const ammoCap = getAmmoCapacity(g.wave, g.upgrades.launcherKit);
    for (let i = 0; i < LAUNCHERS.length; i++) {
      if (g.launcherHP[i] > 0) g.ammo[i] = ammoCap;
    }
  }

  if (onEvent) onEvent("sfx", { name: "flareLaunch" });
  return true;
}
