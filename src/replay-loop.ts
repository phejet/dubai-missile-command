import type { GameState } from "./types";

export function isBonusUiPauseActive(g: GameState): boolean {
  return !!g._bonusScreenStarted && !g._bonusScreenDone;
}
