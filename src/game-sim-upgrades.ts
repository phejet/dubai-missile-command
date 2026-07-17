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
  shopHidden?: boolean;
  excludes?: UpgradeKey[];
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
    active: true,
    excludes: ["emp", "f15"],
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
    shopHidden: true,
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
    excludes: ["f15", "flare"],
  },
  f15: {
    name: "F-15 Eagle Patrol",
    icon: "\u2708\uFE0F",
    color: COL.plane,
    active: true,
    excludes: ["emp", "flare"],
  },
};

const OBJECTIVES: Record<UpgradeObjectiveId, ObjectiveDef> = {
  reach_wave_3: {
    label: "Reach wave 3 in a previous run",
    complete: (summary) => summary.wave >= 3,
  },
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
    id: "wildHornetsLeft",
    family: "wildHornets",
    rank: 1,
    name: "Wild Hornets (Left)",
    icon: "\uD83D\uDC1D",
    desc: "Ukrainian FPV drone swarm — left launch pad. Anti-bomb and anti-drone specialist.",
    cost: 1000,
    color: COL.hornet,
    statLine: "Left site · 2-drone magazine · 1/sec · 30 blast",
  },
  {
    id: "wildHornetsRight",
    family: "wildHornets",
    rank: 1,
    name: "Wild Hornets (Right)",
    icon: "\uD83D\uDC1D",
    desc: "Independent right-flank hornet pad — covers the eastern approach.",
    cost: 1000,
    color: COL.hornet,
    statLine: "Right site · 2-drone magazine · 1/sec · 30 blast",
  },
  {
    id: "skyHunterMesh",
    family: "wildHornets",
    rank: 1,
    name: "Sky Hunter Mesh",
    icon: "\uD83D\uDC1D",
    desc: "Distributed FPV control: hornets retarget continuously until they run out of fuel.",
    cost: 2500,
    color: COL.hornet,
    statLine: "Unlimited retargeting · drones hunt until life expires",
    anyOf: ["wildHornetsLeft", "wildHornetsRight"],
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
    name: "Decoy Salvo",
    icon: "\uD83C\uDF86",
    desc: "Burj launches a 6-flare fan. Anything tracking in range dives at a flare and impacts ground harmlessly.",
    cost: 1211,
    color: COL.flare,
    statLine: "6-flare fan · once per wave · lures missiles & drones",
    active: true,
    objectives: ["reach_wave_3"],
  },
  {
    id: "flareCounterSalvo",
    family: "flare",
    rank: 2,
    name: "Counter-Salvo",
    icon: "\uD83C\uDF86",
    desc: "Three staggered flare drops. Lured threats lock onto the nearest airborne target and detonate on contact. Launchers reload instantly.",
    cost: 3227,
    color: COL.flare,
    statLine: "3-stage salvo · redirects threats into each other · refills ammo",
    active: true,
    anyOf: ["flare"],
    objectives: ["reach_wave_6"],
  },
  {
    id: "ironBeam",
    family: "ironBeam",
    rank: 1,
    name: "Iron Beam",
    icon: "\u26A1",
    desc: "High-energy laser reserved for the tower itself. A charged beam holds its fire, then burns down whatever is about to hit the Burj.",
    cost: 1050,
    color: COL.laser,
    statLine: "1 beam · guards the Burj · very slow charge",
  },
  {
    id: "ironBeamTwinArray",
    family: "ironBeam",
    rank: 2,
    name: "Iron Beam Twin Array",
    icon: "\u26A1",
    desc: "A second emitter joins each volley: while one beam guards the Burj, spare beams strafe the nearest threats around the tower.",
    cost: 3311,
    color: COL.laser,
    statLine: "2 beams · spare beam strafes 56 range · slow",
    anyOf: ["ironBeam"],
  },
  {
    id: "ironBeamOverclock",
    family: "ironBeam",
    rank: 3,
    name: "Iron Beam Overclock",
    icon: "\u26A1",
    desc: "Power conditioning pushes the laser network into a faster recharge with a third beam and a wider strafing sweep.",
    cost: 7777,
    color: COL.laser,
    statLine: "3 beams · spare beams strafe 70 range · medium",
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
    statLine: "Reload: 30 ticks / 15 with Rapid Reload",
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
    statLine: "+50% interceptor speed and acceleration",
  },
  {
    id: LAUNCHER_DOUBLE_MAGAZINE_NODE,
    family: "launcherKit",
    rank: 2,
    name: "Double Magazine",
    icon: "\uD83D\uDEE1\uFE0F",
    desc: "Each live launcher keeps two interceptors primed, doubling again with expanded magazines.",
    cost: 0,
    color: COL.launcherKit,
    statLine: "Shared magazine: 4 shots per live launcher",
    anyOf: [LAUNCHER_RAPID_RELOAD_NODE, LAUNCHER_ARMOR_NODE, LAUNCHER_HIGH_VELOCITY_NODE],
    objectives: ["reach_wave_4"],
  },
  {
    id: "emp",
    family: "emp",
    rank: 1,
    name: "EMP Shockwave",
    icon: "\uD83C\uDF00",
    desc: "Tesla coil EMP cannon. Once per wave, press SPACE to unleash a shockwave from Burj that fries everything in range.",
    cost: 1211,
    color: COL.emp,
    statLine: "Burj pulse · once per wave · 1 dmg",
    active: true,
  },
  {
    id: "empCapacitors",
    family: "emp",
    rank: 2,
    name: "EMP Capacitors",
    icon: "\uD83C\uDF00",
    desc: "Capacitor banks at every alive launcher fire in sync with the Burj pulse, blanketing the lower sky and topping up your ammo on cast.",
    cost: 3227,
    color: COL.emp,
    statLine: "Burj + launcher pulses · faster expansion · 2 dmg · refills ammo",
    active: true,
    anyOf: ["emp"],
    objectives: ["reach_wave_6"],
  },
  {
    id: "f15",
    family: "f15",
    rank: 1,
    name: "F-15 Eagle Patrol",
    icon: "✈️",
    desc: "Call in a pair of F-15s flying tight formation across the upper sky, sweeping the top half with high-velocity AAMs. Once per wave.",
    cost: 1450,
    color: COL.plane,
    statLine: "Formation pass · once per wave · sweeps top half",
    active: true,
    objectives: ["reach_wave_3"],
  },
  {
    id: "f15TopGun",
    family: "f15",
    rank: 2,
    name: "Top Gun Squadron",
    icon: "✈️",
    desc: "Veteran pilots make a return pass after the first sweep, with faster jets and a hotter trigger finger.",
    cost: 3450,
    color: COL.plane,
    statLine: "Formation + return pass · once per wave · faster fire",
    active: true,
    anyOf: ["f15"],
    objectives: ["reach_wave_4"],
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
    f15: 0,
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

export function isUpgradeFamilyShopVisible(key: UpgradeKey): boolean {
  return UPGRADE_FAMILIES[key]?.shopHidden !== true;
}

export function isUpgradeNodeShopVisible(node: UpgradeNodeDef): boolean {
  return isUpgradeFamilyShopVisible(node.family);
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

function findExcludedFamily(family: UpgradeKey, ownedNodes: Set<UpgradeNodeId>): UpgradeKey | null {
  const excludes = UPGRADE_FAMILIES[family]?.excludes;
  if (!excludes || excludes.length === 0) return null;
  for (const otherFamily of excludes) {
    for (const ownedId of ownedNodes) {
      const ownedNode = UPGRADE_NODE_MAP.get(ownedId);
      if (ownedNode && ownedNode.family === otherFamily) return otherFamily;
    }
  }
  return null;
}

export function getNodeLockReason(
  node: UpgradeNodeDef,
  ownedNodes: Set<UpgradeNodeId>,
  progression: UpgradeProgressionState,
): string | null {
  if (ownedNodes.has(node.id)) return "Owned";
  const excluded = findExcludedFamily(node.family, ownedNodes);
  if (excluded) {
    const otherName = UPGRADE_FAMILIES[excluded]?.name ?? excluded;
    return `Locked: chose ${otherName}`;
  }
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
