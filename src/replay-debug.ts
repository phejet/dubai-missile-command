import type { GameState, ReplayCheckpoint } from "./types";
import { getRngState } from "./game-logic";

function roundCoord(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function sortStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function hashReplayDiagnostic(input: unknown): string {
  const serialized = typeof input === "string" ? input : JSON.stringify(input);
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function diffReplayCheckpoints(
  expected: ReplayCheckpoint,
  actual: ReplayCheckpoint,
): Record<string, { expected: unknown; actual: unknown }> {
  const diff: Record<string, { expected: unknown; actual: unknown }> = {};
  const walk = (path: string, left: unknown, right: unknown): void => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (
      left &&
      right &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort(sortStrings)) {
        walk(
          path ? `${path}.${key}` : key,
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        );
      }
      return;
    }
    diff[path] = { expected: left, actual: right };
  };
  walk("", expected, actual);
  return diff;
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
      `${d.shahedVariant || d.subtype || d.type || "drone"}:${roundCoord(d.x)}:${roundCoord(d.y)}:${roundCoord(d.vx)}:${roundCoord(d.vy)}:${d.health ?? 1}:${d.diving ? 1 : 0}`,
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
  const empRings = (g.empRings || [])
    .filter((ring) => ring.alive !== false)
    .map(
      (ring) =>
        `${ring.kind || "emp"}:${ring.visualRole || "core"}:${roundCoord(ring.x)}:${roundCoord(ring.y)}:${roundCoord(ring.radius)}:${roundCoord(ring.age)}:${ring.damage ?? 0}`,
    )
    .sort(sortStrings);
  const defenseSites = [...(g.defenseSites || [])].map((site) => `${site.key}:${site.alive ? 1 : 0}`).sort(sortStrings);
  const explosions = (g.explosions || [])
    .map((e) => `${e.id}:${roundCoord(e.x)}:${roundCoord(e.y)}:${roundCoord(e.radius)}:${roundCoord(e.alpha)}`)
    .sort(sortStrings);
  const flares = (g.flares || [])
    .filter((flare) => flare.alive !== false)
    .map((flare) => `${flare.id}:${roundCoord(flare.x)}:${roundCoord(flare.y)}:${roundCoord(flare.life)}`)
    .sort(sortStrings);
  const particleTypes = Object.fromEntries(
    Object.entries(
      (g.particles || []).reduce<Record<string, number>>((counts, particle) => {
        const type = particle.type ?? "default";
        counts[type] = (counts[type] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort(([a], [b]) => sortStrings(a, b)),
  );
  const remainingSchedule = (g.schedule || []).slice(g.scheduleIdx);

  const signature = {
    state: g.state,
    wave: g.wave,
    score: g.score,
    burjAlive: g.burjAlive,
    burjHealth: g.burjHealth,
    ammo: [...g.ammo],
    launcherHP: [...g.launcherHP],
    fireChargeState: { ...g.fireChargeState },
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
      empRings: empRings.length,
    },
    entities: {
      missiles: { count: missiles.length, hash: hashReplayDiagnostic(missiles) },
      drones: { count: drones.length, hash: hashReplayDiagnostic(drones) },
      interceptors: { count: interceptors.length, hash: hashReplayDiagnostic(interceptors) },
      hornets: { count: hornets.length, hash: hashReplayDiagnostic(hornets) },
      roadrunners: { count: roadrunners.length, hash: hashReplayDiagnostic(roadrunners) },
      patriots: { count: patriots.length, hash: hashReplayDiagnostic(patriots) },
      planes: { count: planes.length, hash: hashReplayDiagnostic(planes) },
      empRings: { count: empRings.length, hash: hashReplayDiagnostic(empRings) },
    },
    empScrubTicks: roundCoord(g.empScrubTicks),
    rngState: getRngState(),
    schedule: {
      index: g.scheduleIdx,
      waveTick: roundCoord(g.waveTick),
      remainingHash: hashReplayDiagnostic(remainingSchedule),
    },
    draftOffers: [...(g._draftOffers ?? [])],
    explosions: { count: explosions.length, hash: hashReplayDiagnostic(explosions) },
    flares: { count: flares.length, hash: hashReplayDiagnostic(flares) },
    particles: { count: g.particles.length, types: particleTypes },
    queues: {
      flareSalvo: {
        count: g.flareSalvoQueue.length,
        hash: hashReplayDiagnostic(g.flareSalvoQueue),
      },
      patriotLaunch: {
        count: g.patriotLaunchQueue.length,
        hash: hashReplayDiagnostic(
          g.patriotLaunchQueue.map((entry) => ({
            ...entry,
            targetRef: entry.targetRef
              ? `${entry.targetRef.type}:${roundCoord(entry.targetRef.x)}:${roundCoord(entry.targetRef.y)}`
              : null,
          })),
        ),
      },
    },
    timers: {
      waveCleared: roundCoord(g.waveClearedTimer),
      gameOver: roundCoord(g.gameOverTimer),
      burjInvuln: roundCoord(g.burjInvulnTimer),
      roadrunnerReload: roundCoord(g.roadrunnerReloadTimer),
      roadrunnerLaunch: roundCoord(g.roadrunnerLaunchCooldown),
      ironBeam: roundCoord(g.ironBeamTimer),
      phalanx: roundCoord(g.phalanxTimer),
      patriot: roundCoord(g.patriotTimer),
      f15Return: roundCoord(g.f15ReturnTimer),
    },
    nextIds: {
      explosion: g.nextExplosionId,
      empFx: g.nextEmpFxId,
      burjDecal: g.nextBurjDecalId,
      burjDamageFx: g.nextBurjDamageFxId,
      buildingDestroyFx: g.nextBuildingDestroyFxId,
      flare: g.nextFlareId,
    },
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
    fireChargeState: { ...g.fireChargeState },
    upgrades: { ...g.upgrades },
    stats: { ...g.stats },
    counts: signature.counts,
    hash: hashReplayDiagnostic(signature),
    diagnostics: signature,
  };

  if (reason) checkpoint.reason = reason;
  return checkpoint;
}
