import {
  predictBurjImpactTicks,
  countAliveLaunchers,
  getLauncherBurstChargeCap,
  getLauncherReloadTicks,
} from "../../src/game-logic.ts";
import { syncFireChargeState } from "../../src/player-fire-limiter.ts";
// Research-only observer. Imported exclusively by the generated analysis bundle.
// Every identity, lineage and contribution lives here, never on GameState/entities.
let current = null;
export function start({ quality = false } = {}) {
  current = {
    events: [],
    quality,
    frames: [],
    shotRefs: new Map(),
    assetBefore: null,
    stack: [],
    entities: new WeakMap(),
    nextEntity: 1,
    projectiles: new WeakMap(),
    explosions: new Map(),
    damage: new WeakMap(),
    shots: [],
    scoredTargets: new Set(),
    tick: 0,
  };
  return current;
}
export function stop() {
  const result = current;
  current = null;
  return result;
}
export function clock(tick) {
  if (current) current.tick = tick;
}
function emit(g, event) {
  if (current) current.events.push({ tick: current.tick, wave: g.wave, ...event });
}
function id(entity) {
  if (!entity || !current) return null;
  if (!current.entities.has(entity)) current.entities.set(entity, current.nextEntity++);
  return current.entities.get(entity);
}
function context() {
  return current?.stack[current.stack.length - 1] ?? { source: "unattributed", shotId: null, rootId: null };
}
function origin(ex) {
  return ex && current
    ? (current.explosions.get(ex.id) ?? { source: "unattributed", shotId: null, rootId: ex.id })
    : context();
}
export function pushSource(source) {
  if (current) current.stack.push({ source, shotId: null, rootId: null });
}
export function pushExplosion(g, ex) {
  if (current) current.stack.push(origin(ex));
}
export function pushProjectile(g, projectile) {
  if (current)
    current.stack.push(
      projectile.fromF15
        ? { source: "f15", shotId: null, rootId: null }
        : (current.projectiles.get(projectile) ?? { source: "unattributed", shotId: null, rootId: null }),
    );
}
export function pop() {
  if (current) current.stack.pop();
}
export function withSource(source, fn) {
  pushSource(source);
  try {
    return fn();
  } finally {
    pop();
  }
}
export function shot(g, projectile) {
  if (!current) return;
  const shotId = current.shots.length + 1;
  const data = { shotId, tick: current.tick, wave: g.wave, aimX: projectile.targetX, aimY: projectile.targetY };
  current.shots.push(data);
  current.projectiles.set(projectile, { source: "player", shotId, rootId: null });
  if (current.quality) {
    data.intended = (projectile.intendedTargets ?? []).map(id);
    data.overlap = [
      ...new Set(
        g.interceptors
          .filter((p) => p !== projectile && p.alive && !p.fromF15)
          .flatMap((p) =>
            (p.intendedTargets ?? []).filter((t) => (projectile.intendedTargets ?? []).includes(t)).map(id),
          ),
      ),
    ];
    data.threats = g.missiles.filter((t) => t.alive).length + g.drones.filter((t) => t.alive).length;
    data.chargesAfter = g.fireChargeState.burstCharges;
    current.shotRefs.set(shotId, { projectile, seenRoot: false, wave: g.wave, ended: false });
  }
  emit(g, { type: "shot", ...data });
}
export function explosion(g, ex) {
  if (!current) return;
  const parent = context();
  // Inherit the observed parent even if the sim's root has left its live array.
  const chained = ex.chain || ex.rootExplosionId !== null;
  const meta = {
    source: parent.source,
    shotId: parent.shotId,
    rootId: chained ? (parent.rootId ?? ex.rootExplosionId) : ex.id,
  };
  current.explosions.set(ex.id, meta);
  if (current.quality && meta.shotId) current.shotRefs.get(meta.shotId).seenRoot = true;
  emit(g, {
    type: "explosion",
    ...meta,
    explosionId: ex.id,
    gameRootId: ex.rootExplosionId,
    chain: chained,
    playerCaused: ex.playerCaused,
    harmless: ex.harmless,
  });
}
export function damage(g, target, requested, ex = null) {
  if (!current) return;
  const meta = origin(ex);
  const before = target.health ?? 1;
  const applied = Math.max(0, Math.min(before, requested));
  const contribution = { tick: current.tick, ...meta, damage: applied };
  const detail = current.quality
    ? { x: target.x, y: target.y, projectedBurjImpactTicks: predictBurjImpactTicks(g, target, 60) }
    : {};
  const history = current.damage.get(target) ?? [];
  history.push(contribution);
  current.damage.set(target, history);
  emit(g, {
    type: "damage",
    ...detail,
    targetId: id(target),
    threatType: target.type,
    subtype: target.subtype ?? null,
    requested,
    applied,
    healthBefore: before,
    ...meta,
    explosionId: ex?.id ?? null,
  });
}
export function reward(g, amount, kind, target = null, ex = null, detail = null) {
  // Preserve the exact original arithmetic; observations occur after the mutation.
  g.score += amount;
  if (!current) return;
  const meta = origin(ex);
  const targetId = id(target);
  const event = {
    type: "reward",
    kind,
    amount,
    balance: g.score,
    ...meta,
    explosionId: ex?.id ?? null,
    chain: !!ex?.chain,
    targetId,
    detail,
  };
  if (kind === "kill") {
    if (!current.damage.has(target)) throw Error("Kill without damage evidence");
    if (meta.source === "unattributed") throw Error("Unattributed kill at " + current.tick);
    const base = amount / g.combo;
    Object.assign(event, {
      base,
      combo: g.combo,
      uplift: amount - base,
      threatType: target.type,
      subtype: target.subtype ?? null,
      contributors: (current.damage.get(target) ?? []).map((x) => ({ ...x })),
    });
    if (current.scoredTargets.has(targetId)) throw new Error("Duplicate scored target " + targetId);
    current.scoredTargets.add(targetId);
  }
  emit(g, event);
}
export function destroyed(g, target, typeKey) {
  if (!current) return;
  const targetId = id(target);
  emit(g, {
    type: "destroyed",
    typeKey,
    targetId,
    threatType: target.type,
    ...context(),
    scored: current.scoredTargets.has(targetId),
  });
}
export function combo(g, value, ex) {
  const before = g.combo;
  g.combo = value;
  emit(g, { type: "combo", before, after: value, ...origin(ex), explosionId: ex.id, reportedRootKills: ex.kills ?? 0 });
}
export function active(g, source) {
  emit(g, { type: "active", source });
}

export function multiShot(g, ex) {
  emit(g, { type: "multiShot", ...origin(ex), explosionId: ex.id });
}

// Project recharge on a copy: the real firing call synchronizes before spending.
export function availableCharges(g, tick) {
  const state = { ...g.fireChargeState };
  syncFireChargeState(state, tick, getLauncherBurstChargeCap(g, countAliveLaunchers(g)), getLauncherReloadTicks(g));
  return state.burstCharges;
}
function assets(g) {
  return {
    burj: g.burjHealth,
    buildings: g.buildings.map((b) => b.alive),
    launchers: [...g.launcherHP],
    sites: Object.fromEntries(g.defenseSites.map((s) => [s.key, s.alive])),
  };
}
export function qualityBefore(g, tick) {
  if (!current?.quality) return;
  current.assetBefore = { wave: g.wave, ...assets(g) };
  if (g.state !== "playing" || g.waveComplete || !g.burjAlive || g.gameOverTimer > 0) return;
  const threats = [...g.missiles, ...g.drones].filter((t) => t.alive);
  const covered = threats.filter((t) =>
    g.explosions.some(
      (ex) =>
        ex.alpha > 0.2 &&
        !ex.harmless &&
        Math.hypot(t.x - ex.x, t.y - ex.y) < ex.maxRadius + (t.type === "drone" ? t.collisionRadius : 0),
    ),
  );
  current.frames.push({
    tick,
    wave: g.wave,
    threats: threats.length,
    charges: availableCharges(g, tick),
    launchers: countAliveLaunchers(g),
    manualAirborne: g.interceptors.filter((p) => p.alive && !p.fromF15).length,
    blastCovered: covered.length,
    loadout: [...g.ownedUpgradeNodes].sort().join(","),
    empReady: g.empReadyThisWave,
    f15Ready: g.f15ReadyThisWave,
    burj: g.burjHealth,
  });
}
export function qualityAfter(g, phase) {
  if (!current?.quality) return;
  const before = current.assetBefore,
    after = assets(g);
  if (before && before.wave === g.wave) {
    const loss = {
      burj: Math.max(0, before.burj - after.burj),
      buildings: before.buildings.filter((v, i) => v && !after.buildings[i]).length,
      launcherHP: before.launchers.reduce((n, v, i) => n + Math.max(0, v - after.launchers[i]), 0),
      sites: Object.entries(before.sites).filter(([key, alive]) => alive && !after.sites[key]).length,
    };
    if (Object.values(loss).some((n) => n > 0)) emit(g, { type: "asset_damage", ...loss });
  }
  const active = new Set(g.explosions.filter((ex) => ex.alpha > 0).map((ex) => origin(ex).shotId));
  for (const [shotId, ref] of current.shotRefs) {
    if (ref.ended) continue;
    let status = null;
    if (g.wave !== ref.wave || phase === "shop") status = "boundary_cleared";
    else if (!ref.projectile.alive && ref.seenRoot && !active.has(shotId)) status = "resolved";
    if (status) {
      ref.ended = true;
      emit(g, { type: "shot_end", shotId, shotWave: ref.wave, status });
    }
  }
}
export function qualityFinish(g) {
  if (!current?.quality) return;
  for (const [shotId, ref] of current.shotRefs)
    if (!ref.ended) {
      ref.ended = true;
      emit(g, { type: "shot_end", shotId, shotWave: ref.wave, status: "terminal_unresolved" });
    }
}
