import { buyDraftUpgrade, closeShop } from "./game-sim";
import { prepareWaveStart } from "./game-sim-shop";
import type { GameState, ReplayData, ReplayStopCondition } from "./types";

function normalizeReplayWave(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    throw new Error(`Replay ${label} must be an integer >= 1`);
  }
  return value as number;
}

export function resolveReplayStartWave(replayData: Pick<ReplayData, "bootstrap">): number {
  const startWave = replayData.bootstrap?.startWave;
  if (startWave === undefined) return 1;
  return normalizeReplayWave(startWave, "bootstrap.startWave");
}

export function resolveReplayStopWave(
  replayData: Pick<ReplayData, "bootstrap" | "stopCondition">,
  startWave: number,
): number | null {
  const stopCondition: ReplayStopCondition | undefined = replayData.stopCondition;
  if (!stopCondition) return null;
  if (stopCondition.type !== "waveComplete") {
    throw new Error(`Unsupported replay stop condition: ${String(stopCondition.type)}`);
  }

  const stopWave = stopCondition.wave ?? startWave;
  const normalizedStopWave = normalizeReplayWave(stopWave, "stopCondition.wave");
  if (normalizedStopWave < startWave) {
    throw new Error("Replay stopCondition.wave cannot be earlier than bootstrap.startWave");
  }
  return normalizedStopWave;
}

function getReplayBootstrapUpgrades(replayData: Pick<ReplayData, "bootstrap">): string[] {
  const requests = replayData.bootstrap?.acquiredUpgrades;
  if (!requests) return [];
  if (!Array.isArray(requests)) {
    throw new Error("Replay bootstrap.acquiredUpgrades must be an array");
  }

  return requests.map((request, index) => {
    if (typeof request !== "string") {
      throw new Error(`Replay bootstrap.acquiredUpgrades[${index}] must be a string`);
    }
    const trimmed = request.trim();
    if (!trimmed) {
      throw new Error(`Replay bootstrap.acquiredUpgrades[${index}] must not be empty`);
    }
    return trimmed;
  });
}

export function applyReplayBootstrap(g: GameState, replayData: Pick<ReplayData, "bootstrap">, startWave: number): void {
  while (g.wave < startWave) {
    closeShop(g);
  }

  const upgradeRequests = getReplayBootstrapUpgrades(replayData);
  if (upgradeRequests.length === 0) return;

  for (const request of upgradeRequests) {
    if (!buyDraftUpgrade(g, request)) {
      throw new Error(`Replay bootstrap could not apply upgrade "${request}"`);
    }
  }

  prepareWaveStart(g);
}

export function shouldStopReplayAtWaveComplete(
  g: Pick<GameState, "wave" | "waveComplete">,
  stopWave: number | null,
): boolean {
  return stopWave !== null && g.waveComplete === true && g.wave >= stopWave;
}
