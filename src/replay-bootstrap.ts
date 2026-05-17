import { buyDraftUpgrade, closeShop } from "./game-sim";
import { prepareWaveStart } from "./game-sim-shop";
import { getUpgradeNodeDef } from "./game-sim-upgrades";
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

function normalizeReplayBootstrapUpgrades(requests: string[]): string[] {
  const requestSet = new Set(requests);
  const hasFlare = requestSet.has("flare") || requestSet.has("flareCounterSalvo");
  const hasOtherActive =
    requestSet.has("emp") || requestSet.has("empCapacitors") || requestSet.has("f15") || requestSet.has("f15TopGun");
  return requests.filter((request) => {
    if (request === "flareCluster" || request === "flareCarpet") return false;
    if (hasFlare && hasOtherActive && (request === "flare" || request === "flareCounterSalvo")) return false;
    return true;
  });
}

export function applyReplayBootstrap(g: GameState, replayData: Pick<ReplayData, "bootstrap">, startWave: number): void {
  while (g.wave < startWave) {
    closeShop(g);
  }

  const upgradeRequests = normalizeReplayBootstrapUpgrades(getReplayBootstrapUpgrades(replayData));
  const startBurjHealth = replayData.bootstrap?.startBurjHealth;
  const applyBurjHealth = (): void => {
    if (typeof startBurjHealth !== "number" || !Number.isFinite(startBurjHealth)) return;
    const clamped = Math.max(0, Math.min(g.burjHealth, Math.floor(startBurjHealth)));
    g.burjHealth = clamped;
    if (clamped <= 0) g.burjAlive = false;
  };

  if (upgradeRequests.length === 0) {
    applyBurjHealth();
    return;
  }

  // Bootstrap replays past the meta-progression objective gates: any objective
  // required by a requested upgrade is granted up front so the replay state is
  // reproducible regardless of the host machine's recorded run history.
  const completed = new Set(g.metaProgression.completedObjectives);
  for (const request of upgradeRequests) {
    const node = getUpgradeNodeDef(request);
    for (const objective of node?.objectives ?? []) completed.add(objective);
  }
  g.metaProgression = {
    ...g.metaProgression,
    completedObjectives: Array.from(completed).sort(),
  };

  for (const request of upgradeRequests) {
    if (!buyDraftUpgrade(g, request)) {
      throw new Error(`Replay bootstrap could not apply upgrade "${request}"`);
    }
  }

  prepareWaveStart(g);
  applyBurjHealth();
}

export function shouldStopReplayAtWaveComplete(
  g: Pick<GameState, "wave" | "waveComplete">,
  stopWave: number | null,
): boolean {
  return stopWave !== null && g.waveComplete === true && g.wave >= stopWave;
}
