import { closeShop, buyDraftUpgrade } from "./game-sim";
import { prepareWaveStart } from "./game-sim-shop";
import type { GameState, UpgradeKey, UpgradeObjectiveId } from "./types";

export type DebugStartUpgradeTargets = Partial<Record<UpgradeKey, number>>;

export interface DebugStartPreset {
  id: string;
  label: string;
  wave: number;
  upgrades: DebugStartUpgradeTargets;
}

const DEBUG_COMPLETED_OBJECTIVES: UpgradeObjectiveId[] = ["kill_25_drones", "reach_wave_4", "reach_wave_6"];

export const DEBUG_START_PRESETS: DebugStartPreset[] = [
  {
    id: "wave-3",
    label: "Wave 3",
    wave: 3,
    upgrades: {
      wildHornets: 1,
      launcherKit: 1,
      emp: 1,
    },
  },
  {
    id: "wave-4",
    label: "Wave 4",
    wave: 4,
    upgrades: {
      wildHornets: 1,
      roadrunner: 1,
      flare: 1,
      launcherKit: 1,
      emp: 1,
    },
  },
  {
    id: "wave-5",
    label: "Wave 5",
    wave: 5,
    upgrades: {
      wildHornets: 2,
      roadrunner: 1,
      flare: 1,
      patriot: 1,
      launcherKit: 1,
      emp: 1,
    },
  },
  {
    id: "wave-6",
    label: "Wave 6",
    wave: 6,
    upgrades: {
      wildHornets: 2,
      roadrunner: 2,
      flare: 1,
      ironBeam: 1,
      patriot: 1,
      launcherKit: 2,
      emp: 1,
    },
  },
  {
    id: "wave-7",
    label: "Wave 7",
    wave: 7,
    upgrades: {
      wildHornets: 2,
      roadrunner: 2,
      flare: 2,
      ironBeam: 1,
      phalanx: 1,
      patriot: 2,
      launcherKit: 2,
      emp: 2,
    },
  },
];

function normalizeDebugWave(wave: number): number {
  if (!Number.isInteger(wave) || wave < 1 || wave > 9) {
    throw new Error(`Debug start wave must be an integer from 1 to 9, got ${wave}`);
  }
  return wave;
}

function grantDebugObjectives(g: GameState): void {
  const completed = new Set(g.metaProgression.completedObjectives);
  for (const objective of DEBUG_COMPLETED_OBJECTIVES) completed.add(objective);
  g.metaProgression = {
    version: g.metaProgression.version,
    completedObjectives: Array.from(completed).sort(),
  };
}

function applyUpgradeTargets(g: GameState, targets: DebugStartUpgradeTargets): void {
  for (const [key, level] of Object.entries(targets) as Array<[UpgradeKey, number | undefined]>) {
    const targetLevel = Math.max(0, Math.floor(level ?? 0));
    while ((g.upgrades[key] ?? 0) < targetLevel) {
      if (!buyDraftUpgrade(g, key)) {
        throw new Error(`Debug start could not apply ${key} level ${targetLevel}`);
      }
    }
  }
}

export function getDebugStartPreset(id: string): DebugStartPreset | undefined {
  return DEBUG_START_PRESETS.find((preset) => preset.id === id);
}

export function applyDebugStartPreset(g: GameState, preset: DebugStartPreset): void {
  const wave = normalizeDebugWave(preset.wave);
  grantDebugObjectives(g);

  while (g.wave < wave) {
    closeShop(g);
  }

  applyUpgradeTargets(g, preset.upgrades);
  prepareWaveStart(g);
  g._debugMode = true;
}
