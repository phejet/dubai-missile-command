import { CURRENT_REPLAY_VERSION } from "./replay-version";
import { stampReplayProvenance } from "./replay-provenance";
import type { GameState, ReplayData, ReplayInitialState } from "./types";

export interface ReplaySnapshotOptions {
  buildId: string;
  finalTick?: number;
  score?: number;
  wave?: number;
  isHuman?: boolean;
  draftMode?: boolean;
}

/**
 * Takes synchronous ownership of every mutable replay input before returning.
 * Callers may safely await persistence after this function completes.
 */
export function buildReplaySnapshot(
  game: GameState,
  initialState: ReplayInitialState,
  options: ReplaySnapshotOptions,
): ReplayData {
  const tick = options.finalTick ?? game._replayTick ?? 0;
  const owned = structuredClone({
    actions: game._actionLog ?? [],
    checkpoints: game._replayCheckpoints ?? [],
    initialState,
  });

  return stampReplayProvenance(
    {
      version: CURRENT_REPLAY_VERSION,
      seed: game._gameSeed ?? 0,
      actions: owned.actions,
      initialState: owned.initialState,
      checkpoints: owned.checkpoints,
      finalTick: tick,
      isHuman: options.isHuman ?? true,
      draftMode: options.draftMode ?? game._draftMode !== false,
      score: options.score ?? game.score,
      wave: options.wave ?? game.wave,
    },
    options.buildId,
  );
}
