let state,
  boundsFn,
  tick,
  records,
  refs,
  deaths,
  contacts,
  enabled = false,
  pendingTarget = null;
export function start(g, bounds) {
  state = g;
  boundsFn = bounds;
  tick = 0;
  records = [];
  refs = new Map();
  deaths = [];
  contacts = [];
  enabled = true;
  pendingTarget = null;
  for (const t of [...g.missiles, ...g.drones]) spawn(t, "initial");
}
export function clock(t) {
  tick = t;
}
export function segment(a, b, r) {
  let lo = 0,
    hi = 1;
  for (const [p, d, min, max] of [
    [a.x, b.x - a.x, r.left, r.right],
    [a.y, b.y - a.y, r.top, r.bottom],
  ]) {
    if (d === 0) {
      if (p < min || p > max) return false;
      continue;
    }
    const u = (min - p) / d,
      v = (max - p) / d;
    lo = Math.max(lo, Math.min(u, v));
    hi = Math.min(hi, Math.max(u, v));
    if (lo > hi) return false;
  }
  return true;
}
export function selected(point) {
  if (enabled) pendingTarget = { ...point };
  return point;
}
export function spawn(t, source, parent = null) {
  if (!enabled || refs.has(t)) return t;
  const target = state.buildings.findIndex(
    (b) => b.alive && t.targetX === b.x + b.w / 2 && t.targetY === boundsFn(b).top,
  );
  const r = {
    id: records.length + 1,
    type: t.type,
    subtype: t.subtype ?? null,
    wave: state.wave,
    born: tick,
    source,
    target: target >= 0 ? target : null,
    aim: { x: t.targetX ?? t.diveTarget?.x ?? null, y: t.targetY ?? t.diveTarget?.y ?? null },
    start: { x: t.x, y: t.y, vx: t.vx, vy: t.vy },
    outcome: null,
    hitBuilding: null,
    trajectory: [],
  };
  if (target >= 0) {
    r.bounds = boundsFn(state.buildings[target]);
    const end = { x: t.x + t.vx * 10000, y: t.y + t.vy * 10000 };
    r.initialRayHits = segment(t, end, r.bounds);
    r.roofX = t.vy ? t.x + (t.vx * (r.bounds.top - t.y)) / t.vy : null;
  }
  r.parent = parent ? (refs.get(parent)?.id ?? null) : null;
  if (t.type === "bomb" && source !== "initial") {
    if (!pendingTarget || pendingTarget.x !== t.targetX || pendingTarget.y !== t.targetY || target < 0)
      throw Error("Bomb selector provenance missing");
    r.selectedAtSpawn = true;
    pendingTarget = null;
  }
  records.push(r);
  refs.set(t, r);
  return t;
}
export function death(t, source, context = {}) {
  if (!enabled || !t.alive) return;
  const r = refs.get(t);
  if (r && !r.outcome) {
    r.outcome = source;
    r.context = context.actor ? {} : context;
    r.end = {
      tick,
      x: t.x,
      y: t.y,
      targetAlive: r.target === null ? null : state.buildings[r.target].alive,
      flare: !!t.flareControl,
    };
    if (r.type === "bomb") r.trajectory.push([tick, t.x, t.y]);
  }
  const bi = state.buildings.indexOf(t);
  if (bi >= 0)
    deaths.push({
      building: bi,
      tick,
      wave: state.wave,
      source,
      actor: context.actor ? (refs.get(context.actor)?.id ?? null) : null,
    });
}
export function hit(t, b) {
  const r = refs.get(t);
  if (r) r.hitBuilding = state.buildings.indexOf(b);
}
export function contact(t, dx, dy) {
  if (!enabled) return;
  const r = refs.get(t);
  if (!r) return;
  if (r.type === "bomb" && (tick - r.born) % 20 === 0) r.trajectory.push([tick, t.x, t.y]);
  for (const [i, b] of state.buildings.entries()) {
    if (!b.alive) continue;
    const box = boundsFn(b);
    if (segment({ x: t.x - dx, y: t.y - dy }, t, box)) {
      const point = t.x >= box.left && t.x <= box.right && t.y >= box.top && t.y <= box.bottom;
      contacts.push({
        id: r.id,
        tick,
        building: i,
        point,
        eligible: t.alive,
        priorOutcome: r.outcome,
        previous: { x: t.x - dx, y: t.y - dy },
        current: { x: t.x, y: t.y },
        velocity: { vx: t.vx, vy: t.vy },
        bounds: box,
      });
    }
  }
}
export function finish(g) {
  for (const [t, r] of refs)
    if (!r.outcome) {
      r.outcome = t.alive ? "unresolved" : "unobserved-removal";
      r.end = {
        tick,
        x: t.x,
        y: t.y,
        targetAlive: r.target === null ? null : g.buildings[r.target].alive,
        flare: !!t.flareControl,
      };
    }
  enabled = false;
  return {
    records,
    deaths,
    contacts,
    buildings: g.buildings.map((b, i) => ({ id: i, bounds: boundsFn(b), alive: b.alive })),
  };
}
