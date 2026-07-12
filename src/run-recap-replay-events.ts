import type { GameState, ReplayData, SimEventMap } from "./types";

interface ReplayStateReader {
  getState(): GameState | null;
}

export function handleRunRecapReplayEvent(
  _replay: ReplayData,
  runner: ReplayStateReader,
  type: keyof SimEventMap,
  data: SimEventMap[keyof SimEventMap],
): void {
  void data;
  if (type !== "waveBonusStart") return;
  const game = runner.getState();
  if (!game) return;

  game._bonusScreenDone = true;
}
