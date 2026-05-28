import type { GameState, ReplayData } from "./types.js";
import { getBuildingSurvivalBonus } from "./wave-bonus.js";

interface ReplayStateReader {
  getState(): GameState | null;
}

interface WaveBonusEventData {
  buildings: number;
  wave: number;
}

function isWaveBonusEventData(data: unknown): data is WaveBonusEventData {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return typeof record.buildings === "number" && typeof record.wave === "number";
}

export function handleRunRecapReplayEvent(
  replay: ReplayData,
  runner: ReplayStateReader,
  type: string,
  data?: unknown,
): void {
  if (type !== "waveBonusStart") return;
  const game = runner.getState();
  if (!game) return;

  if (replay.isHuman && isWaveBonusEventData(data)) {
    game.score += getBuildingSurvivalBonus(data);
  }
  game._bonusScreenDone = true;
}
