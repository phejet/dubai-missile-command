import type { GameState, ReplayCheckpoint } from "./types";

function roundCoord(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function sortStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function encodeEntities<T extends { alive: boolean }>(entities: T[], projector: (e: T) => string): string[] {
  return entities
    .filter((entity) => entity.alive)
    .map(projector)
    .sort(sortStrings);
}

export function buildReplayCheckpoint(g: GameState, tick: number, reason: string | null = null): ReplayCheckpoint {
  const missiles = encodeEntities(
    g.missiles || [],
    (m) =>
      `${m.type || "missile"}:${roundCoord(m.x)}:${roundCoord(m.y)}:${roundCoord(m.vx)}:${roundCoord(m.vy)}:${m.health ?? 1}`,
  );
  const drones = encodeEntities(
    g.drones || [],
    (d) =>
      `${d.subtype || d.type || "drone"}:${roundCoord(d.x)}:${roundCoord(d.y)}:${roundCoord(d.vx)}:${roundCoord(d.vy)}:${d.health ?? 1}:${d.diving ? 1 : 0}`,
  );
  const interceptors = encodeEntities(
    g.interceptors || [],
    (i) => `${roundCoord(i.x)}:${roundCoord(i.y)}:${roundCoord(i.vx)}:${roundCoord(i.vy)}:${i.fromF15 ? 1 : 0}`,
  );
  const hornets = encodeEntities(
    g.hornets || [],
    (h) =>
      `${roundCoord(h.x)}:${roundCoord(h.y)}:${roundCoord(h.speed)}:${roundCoord(h.targetRef?.x)}:${roundCoord(h.targetRef?.y)}:${h.blastRadius ?? 0}`,
  );
  const roadrunners = encodeEntities(
    g.roadrunners || [],
    (r) =>
      `${roundCoord(r.x)}:${roundCoord(r.y)}:${roundCoord(r.heading)}:${r.phase || "track"}:${roundCoord(r.targetRef?.x)}:${roundCoord(r.targetRef?.y)}`,
  );
  const patriots = encodeEntities(
    g.patriotMissiles || [],
    (p) =>
      `${roundCoord(p.x)}:${roundCoord(p.y)}:${p.phase || "track"}:${roundCoord(p.targetRef?.x)}:${roundCoord(p.targetRef?.y)}:${p.blastRadius ?? 0}`,
  );
  const planes = encodeEntities(
    g.planes || [],
    (p) => `${roundCoord(p.x)}:${roundCoord(p.y)}:${roundCoord(p.vx)}:${roundCoord(p.vy)}:${p.fireTimer ?? 0}`,
  );
  const defenseSites = [...(g.defenseSites || [])].map((site) => `${site.key}:${site.alive ? 1 : 0}`).sort(sortStrings);

  const signature = {
    state: g.state,
    wave: g.wave,
    score: g.score,
    burjAlive: g.burjAlive,
    burjHealth: g.burjHealth,
    ammo: [...g.ammo],
    launcherHP: [...g.launcherHP],
    upgrades: { ...g.upgrades },
    defenseSites,
    stats: { ...g.stats },
    counts: {
      missiles: missiles.length,
      drones: drones.length,
      interceptors: interceptors.length,
      hornets: hornets.length,
      roadrunners: roadrunners.length,
      patriotMissiles: patriots.length,
      planes: planes.length,
    },
    missiles,
    drones,
    interceptors,
    hornets,
    roadrunners,
    patriots,
    planes,
  };

  const checkpoint: ReplayCheckpoint = {
    tick,
    state: g.state,
    wave: g.wave,
    score: g.score,
    burjAlive: g.burjAlive,
    burjHealth: g.burjHealth,
    ammo: [...g.ammo],
    launcherHP: [...g.launcherHP],
    upgrades: { ...g.upgrades },
    stats: { ...g.stats },
    counts: signature.counts,
    hash: hashString(JSON.stringify(signature)),
  };

  if (reason) checkpoint.reason = reason;
  return checkpoint;
}
