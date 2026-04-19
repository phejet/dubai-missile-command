import { getDefenseSitePlacement, getAmmoCapacity, getRng } from "./game-logic";
import { generateWaveSchedule } from "./wave-spawner";
import {
  computeUpgradeLevelsFromNodes,
  createEmptyUpgradeLevels,
  createEmptyUpgradeProgression,
  getEligibleUpgradeNodes,
  getFamilyNodes,
  getNodeLockReason,
  getPurchaseDisplayName,
  getUpgradeFamilyDef,
  getUpgradeNodeDef,
  resolveRequestedUpgradeNodeId,
  UPGRADE_NODES,
} from "./game-sim-upgrades";
import type { GameState, ShopEntry, UpgradeKey, UpgradeNodeId } from "./types";

function syncUpgradeLevels(g: GameState): void {
  const burjRepair = g.upgrades?.burjRepair ?? 0;
  const levels = computeUpgradeLevelsFromNodes(g.ownedUpgradeNodes);
  g.upgrades = { ...createEmptyUpgradeLevels(), ...levels, burjRepair };
}

function ensureUpgradeRuntimeState(g: GameState): void {
  if (!g.ownedUpgradeNodes) g.ownedUpgradeNodes = new Set();
  if (!g.metaProgression) g.metaProgression = createEmptyUpgradeProgression();
  if (!g.upgrades) g.upgrades = createEmptyUpgradeLevels();
}

function reviveOrRegisterDefenseSite(g: GameState, key: UpgradeKey): void {
  const siteDef = getDefenseSitePlacement(key);
  if (!siteDef) return;
  const existingSite = g.defenseSites.find((site) => site.key === key);
  if (existingSite) {
    existingSite.x = siteDef.x;
    existingSite.y = siteDef.y;
    existingSite.hw = siteDef.hw;
    existingSite.hh = siteDef.hh;
    existingSite.alive = true;
    existingSite.savedLevel = g.upgrades[key];
    return;
  }
  g.defenseSites.push({
    key,
    x: siteDef.x,
    y: siteDef.y,
    alive: true,
    hw: siteDef.hw,
    hh: siteDef.hh,
    savedLevel: g.upgrades[key],
  });
}

function applyNodeSideEffects(g: GameState, nodeId: UpgradeNodeId): void {
  const node = getUpgradeNodeDef(nodeId);
  if (!node) return;
  syncUpgradeLevels(g);
  if (node.family === "launcherKit" && g.upgrades.launcherKit >= 2) {
    for (let i = 0; i < g.launcherHP.length; i++) {
      if (g.launcherHP[i] > 0) g.launcherHP[i] = 2;
    }
  }
  reviveOrRegisterDefenseSite(g, node.family);
  if (node.family === "emp") {
    g.empChargeMax = [1200, 900, 720][g.upgrades.emp - 1];
    g.empCharge = g.empChargeMax;
    g.empReady = true;
  }
}

function buyBurjRepair(g: GameState, free = false): boolean {
  const costs = [1512, 2520, 4032];
  const level = g.upgrades.burjRepair ?? 0;
  if (level >= costs.length) return false;
  const cost = costs[level];
  if (!free && g.score < cost) return false;
  if (!free) g.score -= cost;
  g.upgrades.burjRepair++;
  g.burjHealth = Math.min(5, g.burjHealth + 1);
  if (g.burjHealth > 0) g.burjAlive = true;
  if (g.burjDecals.length > 0) g.burjDecals.shift();
  if (g.burjDamageFx.length > 0) g.burjDamageFx.shift();
  return true;
}

export function buildShopEntries(g: GameState): ShopEntry[] {
  ensureUpgradeRuntimeState(g);
  const nodeIds = g._draftMode && g._draftOffers ? g._draftOffers : UPGRADE_NODES.map((node) => node.id);
  return nodeIds.reduce<ShopEntry[]>((entries, nodeId) => {
    const node = getUpgradeNodeDef(nodeId);
    if (!node) return entries;
    const familyDef = getUpgradeFamilyDef(node.family);
    const familyNodes = getFamilyNodes(node.family);
    const owned = g.ownedUpgradeNodes.has(node.id);
    const lockReason = getNodeLockReason(node, g.ownedUpgradeNodes, g.metaProgression);
    entries.push({
      id: node.id,
      family: node.family,
      name: node.name,
      icon: node.icon,
      desc: node.desc,
      color: node.color,
      cost: owned ? null : node.cost,
      statLine: node.statLine,
      active: node.active ?? familyDef.active,
      owned,
      locked: !owned && !!lockReason,
      disabled: owned || !!lockReason,
      statusText: owned ? "OWNED" : (lockReason ?? undefined),
      level: g.upgrades[node.family],
      maxLevel: familyNodes.length,
    });
    return entries;
  }, []);
}

export function draftPick3(g: GameState): string[] {
  ensureUpgradeRuntimeState(g);
  const rng = getRng();
  const available = getEligibleUpgradeNodes(g.ownedUpgradeNodes, g.metaProgression);
  if (available.length <= 3) return available.map((node) => node.id);
  const pool = available.map((node) => node.id);
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

export function buyUpgrade(g: GameState, request: string): boolean {
  ensureUpgradeRuntimeState(g);
  if (request === "burjRepair") return buyBurjRepair(g);
  const nodeId = resolveRequestedUpgradeNodeId(g.ownedUpgradeNodes, g.metaProgression, request);
  if (!nodeId) return false;
  const node = getUpgradeNodeDef(nodeId);
  if (!node) return false;
  if (g.score < node.cost) return false;
  g.score -= node.cost;
  g.ownedUpgradeNodes.add(nodeId);
  applyNodeSideEffects(g, nodeId);
  return true;
}

export function buyDraftUpgrade(g: GameState, request: string): boolean {
  ensureUpgradeRuntimeState(g);
  if (request === "burjRepair") return buyBurjRepair(g, true);
  const nodeId = resolveRequestedUpgradeNodeId(g.ownedUpgradeNodes, g.metaProgression, request);
  if (!nodeId) return false;
  g.ownedUpgradeNodes.add(nodeId);
  applyNodeSideEffects(g, nodeId);
  return true;
}

export function repairCost(wave: number): number {
  return 200 + 50 * wave;
}

export function repairSite(g: GameState, siteKey: string): boolean {
  const cost = repairCost(g.wave);
  if (g.score < cost) return false;
  const site = g.defenseSites.find((s) => s.key === siteKey && !s.alive);
  if (!site) return false;
  g.score -= cost;
  site.alive = true;
  return true;
}

export function repairLauncher(g: GameState, index: number): boolean {
  if (index < 0 || index >= g.launcherHP.length) return false;
  const cost = repairCost(g.wave);
  if (g.score < cost) return false;
  if (g.launcherHP[index] > 0) return false;
  g.score -= cost;
  const baseHP = g.upgrades.launcherKit >= 2 ? 2 : 1;
  g.launcherHP[index] = baseHP;
  g.launcherReloadUntilTick[index] = 0;
  return true;
}

export function prepareWaveStart(g: GameState): void {
  const baseHP = g.upgrades.launcherKit >= 2 ? 2 : 1;
  for (let i = 0; i < g.launcherHP.length; i++) {
    if (g.launcherHP[i] <= 0) g.launcherHP[i] = baseHP;
  }
  for (const site of g.defenseSites) {
    if (!site.alive) site.alive = true;
  }

  g.interceptors = [];
  g.hornets = [];
  g.roadrunners = [];
  g.patriotMissiles = [];
  g.flares = [];
  g.planes = [];

  g.hornetTimer = 360;
  g.roadrunnerTimer = 480;
  g.patriotTimer = 480;
  g.flareTimer = 240;
  g.ironBeamTimer = 360;
  g.empCharge = g.empChargeMax;
  g.empReady = g.upgrades.emp > 0;

  g.scheduleIdx = 0;
  g.waveTick = 0;
  g.ammo = g.ammo.map((_, i) => (g.launcherHP[i] > 0 ? getAmmoCapacity(g.wave, g.upgrades.launcherKit) : 0)) as [
    number,
    number,
    number,
  ];
  g.launcherReloadUntilTick = [0, 0, 0];
  g._bonusScreenStarted = false;
  g._bonusScreenDone = false;
  g._waveStartMissileKills = g.stats.missileKills;
  g._waveStartDroneKills = g.stats.droneKills;
  g.waveComplete = false;
  g.state = "playing";
}

export function closeShop(g: GameState): void {
  g.wave++;
  const waveData = generateWaveSchedule(g.wave, g.commander);
  g.schedule = waveData.schedule;
  g.concurrentCap = waveData.concurrentCap;
  g.waveTactics = waveData.tactics;
  prepareWaveStart(g);
}

export function getPurchaseToastLabel(purchaseId: string): string {
  return getPurchaseDisplayName(purchaseId);
}
