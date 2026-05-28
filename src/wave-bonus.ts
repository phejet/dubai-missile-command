export const BUILDING_SURVIVAL_BONUS_POINTS = 100;

export interface BuildingSurvivalBonusInput {
  buildings: number;
  wave: number;
}

export function getBuildingSurvivalBonus(data: BuildingSurvivalBonusInput): number {
  return Math.max(0, data.buildings) * BUILDING_SURVIVAL_BONUS_POINTS * Math.max(0, data.wave);
}
