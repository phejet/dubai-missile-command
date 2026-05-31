import { getFamilyNodes, isUpgradeFamilyShopVisible, UPGRADE_FAMILIES } from "./game-sim-upgrades";
import type { UpgradeKey } from "./types";

const STORAGE_KEY = "dubai-missile-command.debug-options.v1";

export interface DebugOptions {
  forceShowUpgradeFamilies: UpgradeKey[];
  glassTower: boolean;
}

export interface DebugUpgradeFamilyOption {
  key: UpgradeKey;
  name: string;
  icon: string;
  draftable: boolean;
}

export function createDefaultDebugOptions(): DebugOptions {
  return { forceShowUpgradeFamilies: [], glassTower: false };
}

export function getDebugUpgradeFamilyOptions(): DebugUpgradeFamilyOption[] {
  return (Object.keys(UPGRADE_FAMILIES) as UpgradeKey[]).map((key) => {
    const family = UPGRADE_FAMILIES[key];
    return {
      key,
      name: family.name,
      icon: family.icon,
      draftable: isUpgradeFamilyShopVisible(key) && getFamilyNodes(key).length > 0,
    };
  });
}

function normalizeForceShowFamilies(value: unknown): UpgradeKey[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(Object.keys(UPGRADE_FAMILIES) as UpgradeKey[]);
  const seen = new Set<UpgradeKey>();
  const families: UpgradeKey[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !valid.has(item as UpgradeKey)) continue;
    const key = item as UpgradeKey;
    if (seen.has(key)) continue;
    seen.add(key);
    families.push(key);
  }
  return families;
}

export function loadDebugOptions(): DebugOptions {
  if (typeof localStorage === "undefined") return createDefaultDebugOptions();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultDebugOptions();
    const parsed = JSON.parse(raw) as Partial<DebugOptions>;
    return {
      forceShowUpgradeFamilies: normalizeForceShowFamilies(parsed?.forceShowUpgradeFamilies),
      glassTower: parsed?.glassTower === true,
    };
  } catch {
    return createDefaultDebugOptions();
  }
}

export function saveDebugOptions(options: DebugOptions): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        forceShowUpgradeFamilies: normalizeForceShowFamilies(options.forceShowUpgradeFamilies),
        glassTower: options.glassTower === true,
      }),
    );
  } catch {
    // Debug persistence should not break gameplay.
  }
}

export function setForceShowUpgradeFamily(options: DebugOptions, family: UpgradeKey, enabled: boolean): DebugOptions {
  const current = normalizeForceShowFamilies(options.forceShowUpgradeFamilies);
  const next = enabled ? [...current, family] : current.filter((key) => key !== family);
  return { ...options, forceShowUpgradeFamilies: normalizeForceShowFamilies(next) };
}

export function setGlassTower(options: DebugOptions, enabled: boolean): DebugOptions {
  return { ...options, glassTower: enabled };
}
