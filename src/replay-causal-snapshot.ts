import { getRngState } from "./game-logic";
import type { GameState } from "./types";

function normalize(value: unknown): unknown {
  if (value instanceof Set)
    return [...value].map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("_p"))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function buildReplayCausalSnapshot(g: GameState) {
  return normalize({
    rngState: getRngState(),
    state: g.state,
    wave: g.wave,
    waveComplete: g.waveComplete,
    waveClearedTimer: g.waveClearedTimer,
    bonusScreenStarted: g._bonusScreenStarted,
    bonusScreenDone: g._bonusScreenDone,
    shopOpened: g.shopOpened,
    draftOffers: g._draftOffers,
    schedule: g.schedule,
    scheduleIdx: g.scheduleIdx,
    waveTick: g.waveTick,
    nextIds: {
      explosion: g.nextExplosionId,
      empFx: g.nextEmpFxId,
      burjDecal: g.nextBurjDecalId,
      burjDamageFx: g.nextBurjDamageFxId,
      buildingDestroyFx: g.nextBuildingDestroyFxId,
      flare: g.nextFlareId,
    },
    explosions: g.explosions,
    empArcs: g.empArcs,
    empBurstFlashes: g.empBurstFlashes,
    empLauncherFlares: g.empLauncherFlares,
    burjDecals: g.burjDecals,
    burjDamageFx: g.burjDamageFx,
    buildingDestroyFx: g.buildingDestroyFx,
  });
}
