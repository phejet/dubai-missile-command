import { getRngState } from "./game-logic";
import type { GameState, ReplayStateAnchor } from "./types";

function structuredCloneOrThrow<T>(value: T): T {
  if (typeof structuredClone !== "function") {
    throw new Error("structuredClone is required for replay state anchors");
  }
  return structuredClone(value) as T;
}

export function cloneGameStateForReplayAnchor(game: GameState): GameState {
  const sanitized: GameState = {
    ...game,
    _actionLog: undefined,
    _botHumanState: undefined,
    _browserLaserHandle: null,
    _laserHandle: null,
    _replayCheckpointLastHash: null,
    _replayCheckpointLastTick: undefined,
    _replayCheckpoints: undefined,
  };
  const clone = structuredCloneOrThrow(sanitized);
  clone._botHumanState = undefined;
  clone._browserLaserHandle = null;
  clone._laserHandle = null;
  clone._actionLog = undefined;
  clone._replayCheckpoints = undefined;
  return clone;
}

export function createReplayStateAnchor(game: GameState, reason?: string): ReplayStateAnchor | null {
  const rngState = getRngState();
  if (rngState === null) return null;
  return {
    reason,
    rngState,
    state: cloneGameStateForReplayAnchor(game),
    tick: game._replayTick ?? 0,
    wave: game.wave,
  };
}

export function cloneReplayStateAnchor(anchor: ReplayStateAnchor): ReplayStateAnchor {
  return {
    ...anchor,
    state: cloneGameStateForReplayAnchor(anchor.state),
  };
}
