import type { ReplayInitialState } from "./types";

export const CURRENT_REPLAY_VERSION = 11;

export function createDefaultReplayInitialState(): ReplayInitialState {
  return {
    metaProgression: { version: 1, completedObjectives: [] },
    forcedUpgradeFamilies: [],
    burjHealth: 7,
  };
}
