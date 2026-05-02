import {
  COL,
  LAUNCHER_ARMOR_NODE,
  LAUNCHER_DOUBLE_MAGAZINE_NODE,
  LAUNCHER_HIGH_VELOCITY_NODE,
  LAUNCHER_RAPID_RELOAD_NODE,
} from "./game-logic";
import type {
  UpgradeKey,
  Upgrades,
  UpgradeNodeId,
  UpgradeObjectiveId,
  UpgradeProgressionState,
  UpgradeRunSummary,
} from "./types";

type UpgradeFamilyDef = {
  name: string;
  icon: string;
  color: string;
  active?: boolean;
  disabled?: boolean;
};

export type UpgradeNodeDef = {
  id: UpgradeNodeId;
  family: UpgradeKey;
  rank: number;
  name: string;
  icon: string;
  desc: string;
  color: string;
  cost: number;
  statLine: string;
  active?: boolean;
  anyOf?: UpgradeNodeId[];
  allOf?: UpgradeNodeId[];
  objectives?: UpgradeObjectiveId[];
};

type ObjectiveDef = {
  label: string;
  complete(summary: UpgradeRunSummary): boolean;
};

const STORAGE_KEY = "dubai-missile-command.upgrade-progression.v1";

export const UPGRADE_FAMILIES: Record<UpgradeKey, UpgradeFamilyDef> = {
  wildHornets: {
    name: "Wild Hornets",
    icon: "\uD83D\uDC1D",
    color: COL.hornet,
  },
  roadrunner: {
    name: "Anduril Roadrunner",
    icon: "\uD83E\uDD85",
    color: COL.roadrunner,
  },
  flare: {
    name: "Decoy Flares",
    icon: "\uD83C\uDF86",
    color: COL.flare,
  },
  ironBeam: {
    name: "Iron Beam",
    icon: "\u26A1",
    color: COL.laser,
  },
  phalanx: {
    name: "Phalanx CIWS",
    icon: "\uD83D\uDD2B",
    color: COL.phalanx,
  },
  patriot: {
    name: "Patriot",
    icon: "\uD83D\uDE80",
    color: COL.patriot,
  },
  burjRepair: {
    name: "Burj Repair Kit",
    icon: "\uD83D\uDD27",
    color: "#00ffcc",
    disabled: true,
  },
  launcherKit: {
    name: "Launcher Upgrade",
    icon: "\uD83D\uDEE1\uFE0F",
    color: COL.launcherKit,
  },
  emp: {
    name: "EMP Shockwave",
    icon: "\uD83C\uDF00",
    color: COL.emp,
    active: true,
  },
};

const OBJECTIVES: Record<UpgradeObjectiveId, ObjectiveDef> = {
  reach_wave_4: {
    label: "Reach wave 4 in a previous run",
    complete: (summary) => summary.wave >= 4,
  },
  reach_wave_6: {
    label: "Reach wave 6 in a previous run",
    complete: (summary) => summary.wave >= 6,
  },
  kill_25_drones: {
    label: "Destroy 25 drones in a run",
    complete: (summary) => summary.stats.droneKills >= 25,
  },
};

export const UPGRADE_NODES: UpgradeNodeDef[] = [
  {
    id: "wildHornets",
    family: "wildHornets",
    rank: 1,
    name: "Wild Hornets",
    icon: "\uD83D\uDC1D",
    desc: "Ukrainian FPV drone swarm. Fast-response interceptors thin bombs and drones before they become emergencies.",
    cost: 532,
    color: COL.hornet,
    statLine: "2 drones / 2.5s · bomb + drone priority · 25 blast",
  },
  {
    id: "tridentFpvCell",
    family: "wildHornets",
    rank: 2,
    name: "Trident FPV Cell",
    icon: "\uD83D\uDC1D",
    desc: "A second Ukrainian interceptor team joins the screen, giving the swarm much denser battlefield coverage.",
    cost: 2016,
    color: COL.hornet,
    statLine: "3 drones / 2.5s · battlefield control · 30 blast",
    anyOf: ["wildHornets"],
  },
  {
    id: "skyHunterMesh",
    family: "wildHornets",
    rank: 3,
    name: "Sky Hunter Mesh",
    icon: "\uD83D\uDC1D",
    desc: "Distributed FPV control network coordinates swarm launches into a constant anti-drone screen.",
    cost: 4991,
    color: COL.hornet,
    statLine: "5 drones / 1.8s · swarm control · 40 blast",
    allOf: ["wildHornets", "tridentFpvCell"],
  },
  {
    id: "roadrunner",
    family: "roadrunner",
    rank: 1,
    name: "Roadrunner Battery",
    icon: "\uD83E\uDD85",
    desc: "AI-guided reusable interceptor battery. Precision hunter for MIRVs, jets, bombs, and must-kill threats.",
    cost: 805,
    color: COL.roadrunner,
    statLine: "1 interceptor / 5s · MIRV + jet priority",
  },
  {
    id: "roadrunnerWingman",
    family: "roadrunner",
    rank: 2,
    name: "Roadrunner Wingman",
    icon: "\uD83E\uDD85",
    desc: "Dual-launch doctrine adds a second reusable interceptor to keep pace with overlapping high-value targets.",
    cost: 2520,
    color: COL.roadrunner,
    statLine: "2 interceptors / 4s · precision strikes",
    anyOf: ["roadrunner"],
  },
  {
    id: "roadrunnerCommandLink",
    family: "roadrunner",
    rank: 3,
    name: "Roadrunner Command Link",
    icon: "\uD83E\uDD85",
    desc: "Battlefield networking lets the Roadrunner battery operate as an elite threat hunter at full tempo.",
    cost: 6048,
    color: COL.roadrunner,
    statLine: "3 interceptors / 3s · elite threat hunter",
    allOf: ["roadrunner", "roadrunnerWingman"],
    objectives: ["kill_25_drones"],
  },
  {
    id: "flare",
    family: "flare",
    rank: 1,
    name: "Decoy Flares",
    icon: "\uD83C\uDF86",
    desc: "Burj launches IR decoys that scramble guidance systems and pull threats off lethal lines.",
    cost: 707,
    color: COL.flare,
    statLine: "4 flares / 4s · lures 1 per flare",
  },
  {
    id: "flareCluster",
    family: "flare",
    rank: 2,
    name: "Flare Cluster Rack",
    icon: "\uD83C\uDF86",
    desc: "Improved payload racks make every decoy wave more persuasive against clustered missiles and bombs.",
    cost: 2219,
    color: COL.flare,
    statLine: "4 flares / 3s · lures 2 per flare",
    anyOf: ["flare"],
  },
  {
    id: "flareCarpet",
    family: "flare",
    rank: 3,
    name: "Flare Carpet",
    icon: "\uD83C\uDF86",
    desc: "Full-spectrum decoy coverage saturates the center lane and drags multiple threats into self-destruct paths.",
    cost: 5544,
    color: COL.flare,
    statLine: "4 flares / 2s · lures 3 per flare",
    allOf: ["flare", "flareCluster"],
  },
  {
    id: "ironBeam",
    family: "ironBeam",
    rank: 1,
    name: "Iron Beam",
    icon: "\u26A1",
    desc: "High-energy laser defense. Instant beam locks on and burns down incoming projectiles.",
    cost: 1050,
    color: COL.laser,
    statLine: "1 beam · 42 range · very slow charge",
  },
  {
    id: "ironBeamTwinArray",
    family: "ironBeam",
    rank: 2,
    name: "Iron Beam Twin Array",
    icon: "\u26A1",
    desc: "A second emitter expands the defensive umbrella and shortens the time threats spend inside the kill zone.",
    cost: 3311,
    color: COL.laser,
    statLine: "2 beams · 56 range · slow",
    anyOf: ["ironBeam"],
  },
  {
    id: "ironBeamOverclock",
    family: "ironBeam",
    rank: 3,
    name: "Iron Beam Overclock",
    icon: "\u26A1",
    desc: "Power conditioning upgrades push the laser network into a much faster, wider anti-projectile burn profile.",
    cost: 7777,
    color: COL.laser,
    statLine: "3 beams · 70 range · medium",
    allOf: ["ironBeam", "ironBeamTwinArray"],
  },
  {
    id: "phalanx",
    family: "phalanx",
    rank: 1,
    name: "Phalanx CIWS",
    icon: "\uD83D\uDD2B",
    desc: "Close-in weapon system. Last-resort rapid-fire autocannon near protected sites.",
    cost: 854,
    color: COL.phalanx,
    statLine: "1 turret at Burj · 100 range · 50% acc",
  },
  {
    id: "phalanxTwinGuard",
    family: "phalanx",
    rank: 2,
    name: "Phalanx Twin Guard",
    icon: "\uD83D\uDD2B",
    desc: "An eastern gun line adds a second overlapping kill zone for late, low, and fast threats.",
    cost: 2821,
    color: COL.phalanx,
    statLine: "+ east turret · 130 range · 60% acc",
    anyOf: ["phalanx"],
  },
  {
    id: "phalanxTriadNet",
    family: "phalanx",
    rank: 3,
    name: "Phalanx Triad Net",
    icon: "\uD83D\uDD2B",
    desc: "Three linked CIWS emplacements turn the lower skyline into a continuous wall of tracking fire.",
    cost: 6552,
    color: COL.phalanx,
    statLine: "3 turrets · 160 range · 70% acc · faster",
    allOf: ["phalanx", "phalanxTwinGuard"],
  },
  {
    id: "patriot",
    family: "patriot",
    rank: 1,
    name: "Patriot Battery",
    icon: "\uD83D\uDE80",
    desc: "Fast SAM battery. Prioritizes MIRVs, missiles, and jet drones with homing intercepts.",
    cost: 1512,
    color: COL.patriot,
    statLine: "2 missiles / 8s · MIRV priority · 56 blast",
  },
  {
    id: "patriotRapidBattery",
    family: "patriot",
    rank: 2,
    name: "Patriot Rapid Battery",
    icon: "\uD83D\uDE80",
    desc: "Reload and guidance improvements turn the Patriot site into a faster counter-barrage against heavy salvos.",
    cost: 3479,
    color: COL.patriot,
    statLine: "3 missiles / 6s · fast homing · 72 blast",
    anyOf: ["patriot"],
    objectives: ["reach_wave_4"],
  },
  {
    id: "patriotOverwatch",
    family: "patriot",
    rank: 3,
    name: "Patriot Overwatch",
    icon: "\uD83D\uDE80",
    desc: "Overwatch coordination converts the battery into a rapid long-range SAM barrage with massive terminal coverage.",
    cost: 7966,
    color: COL.patriot,
    statLine: "4 missiles / 5s · rapid barrage · 88 blast",
    allOf: ["patriot", "patriotRapidBattery"],
  },
  {
    id: LAUNCHER_RAPID_RELOAD_NODE,
    family: "launcherKit",
    rank: 1,
    name: "Rapid Reload",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Autoloaders cycle every launcher faster, cutting the standard reload window across the whole battery.",
    cost: 0,
    color: COL.launcherKit,
    statLine: "Reload: 30 ticks \u2192 18 ticks",
  },
  {
    id: LAUNCHER_ARMOR_NODE,
    family: "launcherKit",
    rank: 1,
    name: "Launcher Armor Kit",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Reinforced launcher housings give each surviving launcher an extra point of structural integrity.",
    cost: 0,
    color: COL.launcherKit,
    statLine: "Reinforced: launchers gain +1 HP",
  },
  {
    id: LAUNCHER_HIGH_VELOCITY_NODE,
    family: "launcherKit",
    rank: 1,
    name: "High Velocity Interceptors",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Hotter launch motors and tighter guidance give player-fired interceptors much sharper closing speed.",
    cost: 0,
    color: COL.launcherKit,
    statLine: "+40% interceptor speed and acceleration",
  },
  {
    id: LAUNCHER_DOUBLE_MAGAZINE_NODE,
    family: "launcherKit",
    rank: 2,
    name: "Double Magazine",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Each live launcher keeps a second interceptor primed, doubling the opening burst before reload catch-up begins.",
    cost: 0,
    color: COL.launcherKit,
    statLine: "+100% burst shots, rounded up",
    anyOf: [LAUNCHER_RAPID_RELOAD_NODE, LAUNCHER_ARMOR_NODE, LAUNCHER_HIGH_VELOCITY_NODE],
    objectives: ["reach_wave_4"],
  },
  {
    id: "emp",
    family: "emp",
    rank: 1,
    name: "EMP Shockwave",
    icon: "\uD83C\uDF00",
    desc: "Tesla coil EMP cannon. Charge up, then press SPACE to unleash a shockwave from Burj.",
    cost: 1211,
    color: COL.emp,
    statLine: "500 range · 20s charge · 1 dmg",
    active: true,
  },
  {
    id: "empCapacitors",
    family: "emp",
    rank: 2,
    name: "EMP Capacitors",
    icon: "\uD83C\uDF00",
    desc: "Bigger capacitor banks push the EMP ring farther and shorten the wait between full-power discharges.",
    cost: 3227,
    color: COL.emp,
    statLine: "800 range · 15s charge · 2 dmg",
    active: true,
    anyOf: ["emp"],
    objectives: ["reach_wave_6"],
  },
  {
    id: "empStormGrid",
    family: "emp",
    rank: 3,
    name: "EMP Storm Grid",
    icon: "\uD83C\uDF00",
    desc: "A full-grid discharge blankets the map with a slowed, high-damage EMP pulse that resets impossible waves.",
    cost: 7560,
    color: COL.emp,
    statLine: "FULL MAP · 12s charge · 3 dmg + slow",
    active: true,
    allOf: ["emp", "empCapacitors"],
  },
];

const UPGRADE_NODE_MAP = new Map(UPGRADE_NODES.map((node) => [node.id, node]));

export function createEmptyUpgradeLevels(): Upgrades {
  return {
    wildHornets: 0,
    roadrunner: 0,
    flare: 0,
    ironBeam: 0,
    phalanx: 0,
    patriot: 0,
    burjRepair: 0,
    launcherKit: 0,
    emp: 0,
  };
}

export function createEmptyUpgradeProgression(): UpgradeProgressionState {
  return { version: 1, completedObjectives: [] };
}

export function loadUpgradeProgression(): UpgradeProgressionState {
  if (typeof localStorage === "undefined") return createEmptyUpgradeProgression();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyUpgradeProgression();
    const parsed = JSON.parse(raw) as Partial<UpgradeProgressionState>;
    if (!parsed || !Array.isArray(parsed.completedObjectives)) return createEmptyUpgradeProgression();
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      completedObjectives: parsed.completedObjectives.filter((id): id is UpgradeObjectiveId => typeof id === "string"),
    };
  } catch {
    return createEmptyUpgradeProgression();
  }
}

export function saveUpgradeProgression(progression: UpgradeProgressionState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progression));
  } catch {
    // Persistence failure should not break gameplay.
  }
}

export function applyRunSummaryToProgression(
  progression: UpgradeProgressionState,
  summary: UpgradeRunSummary,
): UpgradeProgressionState {
  const completed = new Set(progression.completedObjectives);
  let changed = false;
  for (const [objectiveId, objective] of Object.entries(OBJECTIVES) as Array<[UpgradeObjectiveId, ObjectiveDef]>) {
    if (completed.has(objectiveId)) continue;
    if (objective.complete(summary)) {
      completed.add(objectiveId);
      changed = true;
    }
  }
  return changed ? { version: progression.version, completedObjectives: Array.from(completed).sort() } : progression;
}

export function getUpgradeObjectiveLabel(objectiveId: UpgradeObjectiveId): string {
  return OBJECTIVES[objectiveId]?.label ?? objectiveId;
}

export function getUpgradeNodeDef(nodeId: string): UpgradeNodeDef | undefined {
  return UPGRADE_NODE_MAP.get(nodeId);
}

export function getUpgradeFamilyDef(key: UpgradeKey): UpgradeFamilyDef {
  return UPGRADE_FAMILIES[key];
}

export function getAllUpgradeNodeDefs(): UpgradeNodeDef[] {
  return UPGRADE_NODES;
}

export function getFamilyNodes(key: UpgradeKey): UpgradeNodeDef[] {
  return UPGRADE_NODES.filter((node) => node.family === key);
}

export function getOwnedNodeIdsSorted(ownedNodes: Set<UpgradeNodeId>): UpgradeNodeId[] {
  return Array.from(ownedNodes).sort();
}

export function computeUpgradeLevelsFromNodes(ownedNodes: Set<UpgradeNodeId>): Upgrades {
  const levels = createEmptyUpgradeLevels();
  for (const nodeId of ownedNodes) {
    const node = getUpgradeNodeDef(nodeId);
    if (!node) continue;
    levels[node.family] = Math.max(levels[node.family], node.rank);
  }
  return levels;
}

export function getActiveUpgradeFamilyKeys(upgrades: Upgrades): UpgradeKey[] {
  return (Object.keys(upgrades) as UpgradeKey[]).filter((key) => upgrades[key] > 0 && key !== "burjRepair");
}

function hasCompletedObjectives(
  progression: UpgradeProgressionState,
  objectives: UpgradeObjectiveId[] | undefined,
): boolean {
  if (!objectives || objectives.length === 0) return true;
  return objectives.every((objectiveId) => progression.completedObjectives.includes(objectiveId));
}

function hasAnyOwnedPrereq(ownedNodes: Set<UpgradeNodeId>, anyOf: UpgradeNodeId[] | undefined): boolean {
  if (!anyOf || anyOf.length === 0) return true;
  return anyOf.some((nodeId) => ownedNodes.has(nodeId));
}

function hasAllOwnedPrereqs(ownedNodes: Set<UpgradeNodeId>, allOf: UpgradeNodeId[] | undefined): boolean {
  if (!allOf || allOf.length === 0) return true;
  return allOf.every((nodeId) => ownedNodes.has(nodeId));
}

export function getNodeLockReason(
  node: UpgradeNodeDef,
  ownedNodes: Set<UpgradeNodeId>,
  progression: UpgradeProgressionState,
): string | null {
  if (ownedNodes.has(node.id)) return "Owned";
  if (!hasCompletedObjectives(progression, node.objectives)) {
    return (node.objectives ?? []).map(getUpgradeObjectiveLabel).join(" · ");
  }
  if (!hasAnyOwnedPrereq(ownedNodes, node.anyOf)) {
    return "Requires a previous branch node";
  }
  if (!hasAllOwnedPrereqs(ownedNodes, node.allOf)) {
    return "Requires all previous branch nodes";
  }
  return null;
}

export function isUpgradeNodeEligible(
  ownedNodes: Set<UpgradeNodeId>,
  progression: UpgradeProgressionState,
  nodeId: UpgradeNodeId,
): boolean {
  const node = getUpgradeNodeDef(nodeId);
  if (!node || ownedNodes.has(node.id)) return false;
  return !getNodeLockReason(node, ownedNodes, progression);
}

export function getEligibleUpgradeNodes(
  ownedNodes: Set<UpgradeNodeId>,
  progression: UpgradeProgressionState,
): UpgradeNodeDef[] {
  return UPGRADE_NODES.filter((node) => isUpgradeNodeEligible(ownedNodes, progression, node.id));
}

export function resolveRequestedUpgradeNodeId(
  ownedNodes: Set<UpgradeNodeId>,
  progression: UpgradeProgressionState,
  request: string,
): UpgradeNodeId | null {
  if (UPGRADE_NODE_MAP.has(request)) {
    if (isUpgradeNodeEligible(ownedNodes, progression, request)) return request;
    if (!(request in UPGRADE_FAMILIES) || request === "burjRepair") return null;
  }
  if (!(request in UPGRADE_FAMILIES) || request === "burjRepair") return null;
  const familyNodes = getFamilyNodes(request as UpgradeKey);
  const nextNode = familyNodes.find((node) => isUpgradeNodeEligible(ownedNodes, progression, node.id));
  return nextNode?.id ?? null;
}

export function getPurchaseDisplayName(purchaseId: string): string {
  const node = getUpgradeNodeDef(purchaseId);
  if (node) return node.name;
  if (purchaseId === "burjRepair") return UPGRADE_FAMILIES.burjRepair.name;
  if (purchaseId.startsWith("repair_launcher_")) return "Launcher Repair";
  if (purchaseId.startsWith("repair_")) return "Defense Site Repair";
  return UPGRADE_FAMILIES[purchaseId as UpgradeKey]?.name ?? purchaseId;
}
