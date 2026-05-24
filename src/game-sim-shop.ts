import {
  cloneDestroyedByTypeStats,
  getDefenseSitePlacement,
  getAmmoCapacity,
  getLauncherMaxHp,
  getRng,
  normalizeGameStats,
  syncFireChargeForTick,
} from "./game-logic";
import { generateWaveSchedule } from "./wave-spawner";
import { resetFireChargeState } from "./player-fire-limiter";
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
import type { GameState, HornetSiteKey, ShopEntry, UpgradeKey, UpgradeNodeId, UpgradeProgressionState } from "./types";

const ACTIVE_CHOICE_WAVE = 3;
const ACTIVE_CHOICE_OBJECTIVE = "reach_wave_3";
export const HORNET_SITE_CAPACITY = 2;
type DefenseSiteKey = Exclude<UpgradeKey, "wildHornets"> | "wildHornetsLeft" | "wildHornetsRight";

function syncUpgradeLevels(g: GameState): void {
  const burjRepair = g.upgrades?.burjRepair ?? 0;
  const levels = computeUpgradeLevelsFromNodes(g.ownedUpgradeNodes);
  g.upgrades = { ...createEmptyUpgradeLevels(), ...levels, burjRepair };
}

export function normalizeLegacyFlareActiveState(g: GameState): void {
  if (!g.ownedUpgradeNodes) g.ownedUpgradeNodes = new Set();
  const hasFlare = g.ownedUpgradeNodes.has("flare") || g.ownedUpgradeNodes.has("flareCounterSalvo");
  const hasOtherActive =
    g.ownedUpgradeNodes.has("emp") ||
    g.ownedUpgradeNodes.has("empCapacitors") ||
    g.ownedUpgradeNodes.has("f15") ||
    g.ownedUpgradeNodes.has("f15TopGun");
  if (hasFlare && hasOtherActive) {
    g.ownedUpgradeNodes.delete("flare");
    g.ownedUpgradeNodes.delete("flareCounterSalvo");
  }
  if (Array.isArray(g.defenseSites)) {
    g.defenseSites = g.defenseSites.filter((site) => site.key !== "flare");
  }
}

function ensureUpgradeRuntimeState(g: GameState): void {
  if (!g.ownedUpgradeNodes) g.ownedUpgradeNodes = new Set();
  if (!g.metaProgression) g.metaProgression = createEmptyUpgradeProgression();
  if (!g.upgrades) g.upgrades = createEmptyUpgradeLevels();
  normalizeLegacyFlareActiveState(g);
  syncUpgradeLevels(g);
}

function getWaveAwareProgression(g: GameState): UpgradeProgressionState {
  const progression = g.metaProgression ?? createEmptyUpgradeProgression();
  if (g.wave < ACTIVE_CHOICE_WAVE || progression.completedObjectives.includes(ACTIVE_CHOICE_OBJECTIVE)) {
    return progression;
  }
  return {
    version: progression.version,
    completedObjectives: [...progression.completedObjectives, ACTIVE_CHOICE_OBJECTIVE].sort(),
  };
}

function isInitialActiveChoiceNode(node: { family: UpgradeKey; rank: number; active?: boolean }): boolean {
  return node.rank === 1 && (node.active || getUpgradeFamilyDef(node.family).active === true);
}

function getActiveChoiceWaveLockReason(
  g: GameState,
  node: { family: UpgradeKey; rank: number; active?: boolean },
): string | null {
  if (!isInitialActiveChoiceNode(node)) return null;
  return g.wave < ACTIVE_CHOICE_WAVE ? `Available after wave ${ACTIVE_CHOICE_WAVE}` : null;
}

function pickRandomIds(ids: string[], count: number, rng: () => number): string[] {
  if (ids.length <= count) return [...ids];
  const pool = [...ids];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function shuffleIds(ids: string[], rng: () => number): string[] {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function reviveOrRegisterDefenseSite(g: GameState, key: DefenseSiteKey): void {
  const siteDef = getDefenseSitePlacement(key);
  if (!siteDef) return;
  const ownerKey: UpgradeKey = key === "wildHornetsLeft" || key === "wildHornetsRight" ? "wildHornets" : key;
  const existingSite = g.defenseSites.find((site) => site.key === key);
  if (existingSite) {
    existingSite.x = siteDef.x;
    existingSite.y = siteDef.y;
    existingSite.hw = siteDef.hw;
    existingSite.hh = siteDef.hh;
    existingSite.alive = true;
    existingSite.savedLevel = g.upgrades[ownerKey];
    return;
  }
  g.defenseSites.push({
    key,
    x: siteDef.x,
    y: siteDef.y,
    alive: true,
    hw: siteDef.hw,
    hh: siteDef.hh,
    savedLevel: g.upgrades[ownerKey],
  });
}

export function getActiveHornetSiteKeys(g: GameState): HornetSiteKey[] {
  const keys: HornetSiteKey[] = [];
  if (g.ownedUpgradeNodes.has("wildHornetsLeft")) keys.push("wildHornetsLeft");
  if (g.ownedUpgradeNodes.has("wildHornetsRight")) keys.push("wildHornetsRight");
  return keys;
}

export function syncHornetSitesForOwnership(g: GameState, options: { reset?: boolean } = {}): void {
  const activeKeys = getActiveHornetSiteKeys(g);
  const existing = new Map((g.hornetSites ?? []).map((site) => [site.key, site]));
  g.hornetSites = activeKeys.map((key) => {
    const site = existing.get(key);
    if (!site || options.reset) {
      return { key, ammo: HORNET_SITE_CAPACITY, reloadTimer: 0, launchCooldown: 0 };
    }
    return site;
  });
}

function applyNodeSideEffects(g: GameState, nodeId: UpgradeNodeId): void {
  const node = getUpgradeNodeDef(nodeId);
  if (!node) return;
  syncUpgradeLevels(g);
  if (node.family === "launcherKit") {
    const maxHp = getLauncherMaxHp(g);
    for (let i = 0; i < g.launcherHP.length; i++) {
      if (g.launcherHP[i] > 0) g.launcherHP[i] = Math.max(g.launcherHP[i], maxHp);
    }
  }
  // wildHornets family name is NOT a valid site key — sites are owned by
  // wildHornetsLeft / wildHornetsRight node IDs. Other families share family name with site key.
  if (node.family !== "wildHornets") {
    reviveOrRegisterDefenseSite(g, node.family);
  }
  if (nodeId === "wildHornetsLeft") {
    reviveOrRegisterDefenseSite(g, "wildHornetsLeft");
  }
  if (nodeId === "wildHornetsRight") {
    reviveOrRegisterDefenseSite(g, "wildHornetsRight");
  }
  // skyHunterMesh adds no site — purely a behavior unlock.
  if (node.family === "emp") {
    g.empReadyThisWave = true;
  }
  if (node.family === "f15") {
    g.f15ReadyThisWave = true;
  }
  if (node.family === "flare") {
    g.flareReadyThisWave = true;
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
  g.burjHealth = Math.min(7, g.burjHealth + 1);
  if (g.burjHealth > 0) g.burjAlive = true;
  if (g.burjDecals.length > 0) g.burjDecals.shift();
  if (g.burjDamageFx.length > 0) g.burjDamageFx.shift();
  return true;
}

export function buildShopEntries(g: GameState): ShopEntry[] {
  ensureUpgradeRuntimeState(g);
  const progression = getWaveAwareProgression(g);
  const nodeIds = g._draftMode && g._draftOffers ? g._draftOffers : UPGRADE_NODES.map((node) => node.id);
  return nodeIds.reduce<ShopEntry[]>((entries, nodeId) => {
    const node = getUpgradeNodeDef(nodeId);
    if (!node) return entries;
    const familyDef = getUpgradeFamilyDef(node.family);
    const familyNodes = getFamilyNodes(node.family);
    const owned = g.ownedUpgradeNodes.has(node.id);
    const lockReason =
      getActiveChoiceWaveLockReason(g, node) ?? getNodeLockReason(node, g.ownedUpgradeNodes, progression);
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
      level:
        node.family === "launcherKit"
          ? owned
            ? 1
            : 0
          : familyNodes.filter((familyNode) => g.ownedUpgradeNodes.has(familyNode.id)).length,
      maxLevel: node.family === "launcherKit" ? 1 : familyNodes.length,
    });
    return entries;
  }, []);
}

function dedupeUpgradeFamilies(families: UpgradeKey[]): UpgradeKey[] {
  const seen = new Set<UpgradeKey>();
  const result: UpgradeKey[] = [];
  for (const family of families) {
    if (seen.has(family)) continue;
    seen.add(family);
    result.push(family);
  }
  return result;
}

function findAvailableNodeById<T extends { id: string }>(nodes: T[], nodeId: string): T | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function draftPick3(g: GameState, forcedFamilies: UpgradeKey[] = []): string[] {
  ensureUpgradeRuntimeState(g);
  const rng = getRng();
  const progression = getWaveAwareProgression(g);
  const available = getEligibleUpgradeNodes(g.ownedUpgradeNodes, progression).filter(
    (node) => !getActiveChoiceWaveLockReason(g, node),
  );
  const forceFamilies = (picks: string[], options: { protectInitialActiveChoice?: boolean } = {}): string[] => {
    const result = [...picks];
    const forced = dedupeUpgradeFamilies(forcedFamilies).slice(0, 3);
    if (forced.length === 0) return result;

    if (options.protectInitialActiveChoice) {
      const activeIndex = result.findIndex((id) => {
        const node = findAvailableNodeById(available, id);
        return !!node && isInitialActiveChoiceNode(node);
      });
      const activeFamily = activeIndex >= 0 ? findAvailableNodeById(available, result[activeIndex])?.family : null;
      const forcedActiveFamily = forced.find((family) =>
        available.some((node) => node.family === family && isInitialActiveChoiceNode(node)),
      );
      if (activeIndex >= 0 && forcedActiveFamily && activeFamily !== forcedActiveFamily) {
        const eligibleActive = available.filter(
          (node) => node.family === forcedActiveFamily && isInitialActiveChoiceNode(node),
        );
        result[activeIndex] = eligibleActive[Math.floor(rng() * eligibleActive.length)].id;
      }
    }

    for (const family of forced) {
      if (result.some((id) => findAvailableNodeById(available, id)?.family === family)) continue;
      const eligibleInFamily = available.filter(
        (node) => node.family === family && (!options.protectInitialActiveChoice || !isInitialActiveChoiceNode(node)),
      );
      if (eligibleInFamily.length === 0) continue;
      const node = eligibleInFamily[Math.floor(rng() * eligibleInFamily.length)];
      if (result.length === 0) {
        result.push(node.id);
        continue;
      }
      for (let i = result.length - 1; i >= 0; i--) {
        const slotNode = findAvailableNodeById(available, result[i]);
        if (options.protectInitialActiveChoice && slotNode && isInitialActiveChoiceNode(slotNode)) continue;
        if (!slotNode || !forced.includes(slotNode.family)) {
          result[i] = node.id;
          break;
        }
      }
    }
    return result.slice(0, 3);
  };

  if (g.wave === ACTIVE_CHOICE_WAVE) {
    const activeChoices = available.filter(isInitialActiveChoiceNode);
    if (activeChoices.length > 0) {
      const activeOffer = pickRandomIds(
        activeChoices.map((node) => node.id),
        1,
        rng,
      );
      const supportOffers = pickRandomIds(
        available.filter((node) => !isInitialActiveChoiceNode(node)).map((node) => node.id),
        2,
        rng,
      );
      return shuffleIds(forceFamilies([...activeOffer, ...supportOffers], { protectInitialActiveChoice: true }), rng);
    }
  }
  if (available.length <= 3) return available.map((node) => node.id);
  return forceFamilies(
    pickRandomIds(
      available.map((node) => node.id),
      3,
      rng,
    ),
  );
}

export function buyUpgrade(g: GameState, request: string): boolean {
  ensureUpgradeRuntimeState(g);
  if (request === "burjRepair") return buyBurjRepair(g);
  const nodeId = resolveRequestedUpgradeNodeId(g.ownedUpgradeNodes, getWaveAwareProgression(g), request);
  if (!nodeId) return false;
  const node = getUpgradeNodeDef(nodeId);
  if (!node) return false;
  if (getActiveChoiceWaveLockReason(g, node)) return false;
  if (g.score < node.cost) return false;
  g.score -= node.cost;
  g.ownedUpgradeNodes.add(nodeId);
  applyNodeSideEffects(g, nodeId);
  return true;
}

export function buyDraftUpgrade(g: GameState, request: string): boolean {
  ensureUpgradeRuntimeState(g);
  if (request === "burjRepair") return buyBurjRepair(g, true);
  const nodeId = resolveRequestedUpgradeNodeId(g.ownedUpgradeNodes, getWaveAwareProgression(g), request);
  if (!nodeId) return false;
  const node = getUpgradeNodeDef(nodeId);
  if (!node || getActiveChoiceWaveLockReason(g, node)) return false;
  g.ownedUpgradeNodes.add(nodeId);
  applyNodeSideEffects(g, nodeId);
  return true;
}

export function grantReplayUpgrade(g: GameState, request: string): boolean {
  ensureUpgradeRuntimeState(g);
  if (request === "burjRepair") return buyBurjRepair(g, true);
  const directNode = getUpgradeNodeDef(request);
  const nodeId = directNode
    ? directNode.id
    : resolveRequestedUpgradeNodeId(g.ownedUpgradeNodes, getWaveAwareProgression(g), request);
  if (!nodeId || g.ownedUpgradeNodes.has(nodeId)) return false;
  const node = getUpgradeNodeDef(nodeId);
  if (!node) return false;
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
  const baseHP = getLauncherMaxHp(g);
  g.launcherHP[index] = baseHP;
  syncFireChargeForTick(g, g._replayTick ?? 0);
  return true;
}

export function prepareWaveStart(g: GameState): void {
  const baseHP = getLauncherMaxHp(g);
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
  g.patriotLaunchQueue = [];
  g.flares = [];
  g.flareSalvoQueue = [];
  g.flareSalvoClaims = new Set();
  g.planes = [];

  syncHornetSitesForOwnership(g, { reset: true });
  const rrCapacity = [0, 1, 2, 3][g.upgrades.roadrunner] ?? 0;
  g.roadrunnerAmmo = rrCapacity;
  g.roadrunnerReloadTimer = 0;
  g.roadrunnerLaunchCooldown = 0;
  g.patriotTimer = 480;
  g.ironBeamTimer = 360;
  g.empReadyThisWave = g.upgrades.emp > 0;
  g.flareReadyThisWave = g.upgrades.flare > 0;
  g.f15ReadyThisWave = g.upgrades.f15 > 0;
  g.f15ReturnTimer = 0;

  g.scheduleIdx = 0;
  g.waveTick = 0;
  g.ammo = g.ammo.map((_, i) => (g.launcherHP[i] > 0 ? getAmmoCapacity(g.wave, g.upgrades.launcherKit) : 0)) as [
    number,
    number,
  ];
  resetFireChargeState(g.fireChargeState);
  syncFireChargeForTick(g, g._replayTick ?? 0);
  g._bonusScreenStarted = false;
  g._bonusScreenDone = false;
  g.stats = normalizeGameStats(g.stats);
  g._waveStartMissileKills = g.stats.missileKills;
  g._waveStartDroneKills = g.stats.droneKills;
  g._waveStartDestroyedByType = cloneDestroyedByTypeStats(g.stats.destroyedByType);
  g._waveStartMultiShots = g.stats.multiShots;
  g._waveMaxCombo = Math.max(1, g.combo ?? 1);
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
