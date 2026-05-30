// ── Core types for Dubai Missile Command ──

import type { FireChargeState } from "./player-fire-limiter";

export type RNG = () => number;

// ── Game object shapes ──

export interface TrailPoint {
  x: number;
  y: number;
}

export interface Missile {
  x: number;
  y: number;
  _px?: number;
  _py?: number;
  vx: number;
  vy: number;
  accel: number;
  trail: TrailPoint[];
  alive: boolean;
  type: "missile" | "mirv" | "mirv_warhead" | "bomb" | "stack2" | "stack3" | "stack_child";
  health?: number;
  maxHealth?: number;
  /** MIRV split altitude */
  splitY?: number;
  warheadCount?: number;
  splitTriggered?: boolean;
  splitAfterDist?: number;
  travelDist?: number;
  targetX?: number;
  targetY?: number;
  luredByFlare?: boolean;
  flareTargetId?: number;
  redirected?: boolean;
  redirectTarget?: Missile | Drone;
  variant?: "normal" | "fast";
  speedMul?: number;
  _hitByExplosions?: Set<number>;
}

export interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail?: TrailPoint[];
  wobble: number;
  alive: boolean;
  type: "drone";
  subtype: "shahed136" | "shahed238";
  shahedVariant?: Shahed136Variant;
  health: number;
  collisionRadius: number;
  speed?: number;
  /** shahed238 bezier waypoints */
  waypoints?: TrailPoint[];
  pathIndex?: number;
  bombIndices?: number[];
  bombsDropped?: number;
  diveStartIndex?: number;
  diveTarget?: { x: number; y: number };
  diving?: boolean;
  diveTelegraphing?: boolean;
  diveSpeed?: number;
  luredByFlare?: boolean;
  flareTargetId?: number;
  redirected?: boolean;
  redirectTarget?: Missile | Drone;
  lureDeathTimer?: number;
  bombDropped?: boolean;
  variant?: "normal" | "fast";
  speedMul?: number;
  _hitByExplosions?: Set<number>;
}

export type Shahed136Variant = "shahed-136" | "shahed-136-bomber" | "shahed-136-dive" | "shahed-136-dive-bomber";

export function shahed136HasBomb(variant: Shahed136Variant | undefined): boolean {
  return variant === "shahed-136-bomber" || variant === "shahed-136-dive-bomber";
}

export function shahed136HasDive(variant: Shahed136Variant | undefined): boolean {
  return variant === "shahed-136-dive" || variant === "shahed-136-dive-bomber";
}

export interface Interceptor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  heading?: number;
  speed?: number;
  accel?: number;
  maxSpeed?: number;
  turnRate?: number;
  trail: TrailPoint[];
  alive: boolean;
  fromF15?: boolean;
  _px?: number;
  _py?: number;
}

export type ExplosionVisualType = "missile" | "drone";
export type BurjDamageKind = "missile" | "drone";

export interface BurjDecal {
  id: number;
  x: number;
  y: number;
  kind: BurjDamageKind;
  rotation: number;
  scale: number;
}

export interface BurjDamageFx {
  id: number;
  x: number;
  y: number;
  kind: BurjDamageKind;
  life: number;
  maxLife: number;
  seed: number;
}

export interface BuildingDestroyFx {
  id: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  seed: number;
  w: number;
  h: number;
}

export interface Explosion {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  growing: boolean;
  alpha: number;
  color: string;
  playerCaused: boolean;
  harmless: boolean;
  chain: boolean;
  visualType?: ExplosionVisualType;
  rootExplosionId: number | null;
  ringRadius: number;
  ringAlpha: number;
  kills?: number;
  bonusAwarded?: boolean;
  _multiShotCounted?: boolean;
  _comboProcessed?: boolean;
  chainLevel?: number;
  heroPulse?: number;
  linkFromX?: number;
  linkFromY?: number;
  linkAlpha?: number;
  _lastBonusKills?: number;
  _px?: number;
  _py?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  type?: "debris" | "spark" | "fireFlame" | "fireEmber" | "fireSmoke";
  angle?: number;
  spin?: number;
  gravity?: number;
  w?: number;
  h?: number;
  drag?: number;
  textureVariant?: string;
}

export interface EmpArc {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  seed: number;
  alive?: boolean;
}

export interface EmpBurstFlash {
  id: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  seed: number;
  alive?: boolean;
}

export interface EmpLauncherFlare {
  id: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  seed: number;
  alive?: boolean;
}

export interface Plane {
  x: number;
  y: number;
  vx: number;
  vy: number;
  blinkTimer: number;
  alive: boolean;
  fireTimer: number;
  fireInterval: number;
  fireRange: number;
  interceptorSpeed: number;
  evadeTimer: number;
}

export interface Building {
  x: number;
  w: number;
  h: number;
  windows: number;
  alive: boolean;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  twinkle: number;
}

export interface DefenseSite {
  key: string;
  x: number;
  y: number;
  alive: boolean;
  hw?: number;
  hh?: number;
  savedLevel?: number;
}

// ── Upgrade system ──

export type UpgradeKey =
  | "wildHornets"
  | "roadrunner"
  | "flare"
  | "ironBeam"
  | "phalanx"
  | "patriot"
  | "burjRepair"
  | "launcherKit"
  | "emp"
  | "f15";

export type Upgrades = Record<UpgradeKey, number>;
export type UpgradeNodeId = string;
export type UpgradeObjectiveId = string;
export type HornetSiteKey = "wildHornetsLeft" | "wildHornetsRight";

export interface HornetSiteState {
  key: HornetSiteKey;
  ammo: number;
  reloadTimer: number;
  launchCooldown: number;
}

export interface UpgradeProgressionState {
  version: number;
  completedObjectives: UpgradeObjectiveId[];
}

export interface UpgradeRunSummary {
  wave: number;
  score: number;
  stats: GameStats;
}

export interface ShopEntry {
  id: string;
  family: UpgradeKey | null;
  name: string;
  icon: string;
  desc: string;
  color: string;
  cost: number | null;
  statLine?: string;
  active?: boolean;
  owned: boolean;
  locked: boolean;
  disabled: boolean;
  statusText?: string;
  level: number;
  maxLevel: number;
}

// ── Auto-defense entities ──

export type Threat = Missile | Drone;

export interface Hornet {
  x: number;
  y: number;
  targetRef: Threat | null;
  speed: number;
  trail: TrailPoint[];
  alive: boolean;
  blastRadius: number;
  wobble: number;
  life: number;
  maxLife: number;
  retargetsRemaining: number;
}

export interface Roadrunner {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  heading: number;
  speed: number;
  targetRef: Threat | null;
  phase: "launch" | "track" | "terminal";
  blastRadius: number;
  trail: TrailPoint[];
  alive: boolean;
  life: number;
  launchY?: number;
  turnRate?: number;
}

export interface LaserBeam {
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  targetRef: Threat | null;
  alive?: boolean;
  chargeTimer?: number;
  chargeMax?: number;
  life?: number;
  maxLife?: number;
}

export interface PhalanxBullet {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  tx?: number;
  ty?: number;
  cx?: number;
  cy?: number;
  _pcx?: number;
  _pcy?: number;
  hit?: boolean;
  targetRef?: Threat;
  alive: boolean;
  life: number;
}

export interface PatriotMissile {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  heading?: number;
  speed: number;
  targetRef: Threat | null;
  phase?: "launch" | "track" | "terminal";
  blastRadius: number;
  trail: TrailPoint[];
  alive: boolean;
  life: number;
  wobble?: number;
}

export interface PatriotLaunchQueueItem {
  delay: number;
  targetRef: Threat;
  blastRadius: number;
}

export interface Flare {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchorX: number;
  drag: number;
  life: number;
  maxLife: number;
  alive: boolean;
  luresLeft: number;
  hotRadius: number;
  trail: TrailPoint[];
  sparkAccum?: number;
}

export interface EmpRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  alive?: boolean;
  damage?: number;
  expandRate?: number;
  age?: number;
  kind?: "burj" | "launcher";
  visualRole?: "core" | "cyan" | "magenta";
  tint?: number;
  radiusMul?: number;
  hitSet?: Set<Threat>;
}

export interface MultiKillToast {
  kills?: number;
  bonus: number;
  timer: number;
  label?: string;
  x?: number;
  y?: number;
  pulse?: number;
}

export interface ComboToast {
  multiplier: number;
  timer: number;
  x: number;
  y: number;
  pulse: number;
}

// ── Wave / commander ──

export type TacticId =
  | "LEFT_FLANK"
  | "RIGHT_FLANK"
  | "PINCER"
  | "TOP_BARRAGE"
  | "LOW_APPROACH"
  | "HIGH_APPROACH"
  | "DRONE_SWARM"
  | "MISSILE_RAIN"
  | "MIXED_AXIS"
  | "MIRV_STRIKE"
  | "SATURATION";

export type CommanderStyle = "balanced" | "aggressive" | "methodical" | "adaptive";

export interface Commander {
  style: CommanderStyle;
  history: Array<{ wave: number; tactics: TacticId[] }>;
}

export type SpawnType = "missile" | Shahed136Variant | "drone238" | "mirv" | "stack2" | "stack3";

export interface SpawnEntry {
  type: SpawnType;
  tick: number;
  cellId?: string;
  role?: "anchor" | "disruptor" | "punisher" | "screen";
  overrides?: {
    side?: "left" | "right" | "top";
    yRange?: [number, number];
    speedMul?: number;
    variant?: "normal" | "fast";
  };
}

export interface WaveResult {
  schedule: SpawnEntry[];
  concurrentCap: number;
  tactics: TacticId[];
  setPiece?: WaveSetPiece;
}

export interface WaveSetPiece {
  name: string;
  intel: string;
  tactics: TacticId[];
}

// ── Game stats ──

export const DESTROYED_TYPE_KEYS = [
  "ballisticMissile",
  "mirv",
  "mirvWarhead",
  "stackedMissile",
  "bomb",
  "shahed136",
  "shahed238",
  "other",
] as const;

export type DestroyedTypeKey = (typeof DESTROYED_TYPE_KEYS)[number];
export type DestroyedByTypeStats = Record<DestroyedTypeKey, number>;

export interface GameStats {
  missileKills: number;
  droneKills: number;
  shotsFired: number;
  destroyedByType: DestroyedByTypeStats;
  multiShots: number;
  maxCombo: number;
}

export interface WaveSummaryRecord {
  wave: number;
  scoreEarned: number;
  missileKills: number;
  droneKills: number;
  destroyedByType: DestroyedByTypeStats;
  multiShots: number;
  maxCombo: number;
  buildingsSurviving: number;
  burjHealth: number;
  startTick: number;
  endTick: number;
}

export type OutcomeCause = "burj_destroyed" | "survived" | "abandoned";

export interface UpgradeTimelineEntry {
  tick: number;
  wave: number;
  bought: string[];
}

export interface RunRecapWaveCard {
  wave: number;
  scoreEarned: number;
  missileKills: number;
  droneKills: number;
  multiShots: number;
  maxCombo: number;
  buildingsSurviving: number;
  burjHealth: number;
  startTick: number;
  endTick: number;
  terminal: boolean;
  bought: string[];
}

export interface RunRecapData {
  score: number;
  wave: number;
  timePlayedMs: number;
  hitRatio: number;
  burjHealth: number;
  outcome: OutcomeCause;
  totalStats: GameStats;
  waves: WaveSummaryRecord[];
  waveCards: RunRecapWaveCard[];
  upgrades: UpgradeTimelineEntry[];
  hasReplay: boolean;
  replayId?: string;
}

// ── Full game state ──

export type GamePhase = "playing" | "shop" | "gameover" | "title";

export interface GameState {
  _debugMode: boolean;
  _showColliders: boolean;
  _editorMode?: boolean;
  _showUpgradeRanges?: boolean;
  _debugUpgradeForceShowFamilies?: UpgradeKey[];
  _draftMode?: boolean;
  _replayTick?: number;
  _replayShopBought?: string[];
  _botHumanState?: BotHumanState;

  state: GamePhase;
  score: number;
  wave: number;
  stats: GameStats;

  ammo: [number, number];
  launcherHP: [number, number];
  fireChargeState: FireChargeState;
  // Render-only muzzle flash timestamps. Gameplay fire rate lives in fireChargeState.
  launcherFireTick: [number, number];

  missiles: Missile[];
  drones: Drone[];
  interceptors: Interceptor[];
  explosions: Explosion[];
  particles: Particle[];
  planes: Plane[];
  buildings: Building[];
  buildingDestroyFx: BuildingDestroyFx[];
  stars: Star[];
  defenseSites: DefenseSite[];

  hornets: Hornet[];
  roadrunners: Roadrunner[];
  laserBeams: LaserBeam[];
  phalanxBullets: PhalanxBullet[];
  patriotMissiles: PatriotMissile[];
  patriotLaunchQueue: PatriotLaunchQueueItem[];
  flares: Flare[];
  empRings: EmpRing[];
  empArcs: EmpArc[];
  empBurstFlashes: EmpBurstFlash[];
  empLauncherFlares: EmpLauncherFlare[];
  empGlitchTimer: number;
  empGlitchMax: number;
  empZoomTimer: number;
  empZoomMax: number;
  empScrubTicks: number;

  burjAlive: boolean;
  burjHealth: number;
  burjDecals: BurjDecal[];
  burjDamageFx: BurjDamageFx[];
  burjHitFlashTimer: number;
  burjHitFlashMax: number;
  burjHitFlashX: number;
  burjHitFlashY: number;
  burjInvulnTimer: number;

  waveComplete: boolean;
  crosshairX: number;
  crosshairY: number;
  time: number;
  shakeTimer: number;
  shakeIntensity: number;
  shakePeakTimer: number;

  upgrades: Upgrades;
  ownedUpgradeNodes: Set<UpgradeNodeId>;
  metaProgression: UpgradeProgressionState;

  hornetSites: HornetSiteState[];
  roadrunnerAmmo: number;
  roadrunnerReloadTimer: number;
  roadrunnerLaunchCooldown: number;
  ironBeamTimer: number;
  phalanxTimer: number;
  patriotTimer: number;
  patriotReserveShots: number;
  patriotHoldTimer: number;
  patriotFollowupTimer: number;
  nextFlareId: number;
  flareReadyThisWave: boolean;
  flareSalvoQueue: Array<{ fireAt: number; count: number }>;
  flareSalvoClaims: Set<Missile | Drone>;

  empReadyThisWave: boolean;

  f15ReadyThisWave: boolean;
  f15ReturnTimer: number;
  f15ReturnGoRight: boolean;

  multiKillToast: MultiKillToast | null;
  combo: number;
  comboToast: ComboToast | null;

  commander: Commander;
  schedule: SpawnEntry[];
  scheduleIdx: number;
  waveTick: number;
  concurrentCap: number;
  waveTactics: TacticId[];

  // Shop / draft
  shopOffers?: string[];
  draftOffers?: string[];
  draftPicks?: number;

  // Internal runtime fields (not persisted)
  _laserHandle?: { stop(): void } | null;
  gameOverTimer?: number;
  waveClearedTimer?: number;
  shopOpened?: boolean;
  _draftOffers?: string[];
  _bonusScreenStarted?: boolean;
  _bonusScreenDone?: boolean;
  _waveStartMissileKills?: number;
  _waveStartDroneKills?: number;
  _waveStartDestroyedByType?: DestroyedByTypeStats;
  _waveStartMultiShots?: number;
  _waveMaxCombo?: number;
  _waveStartScore?: number;
  _waveStartTick?: number;
  _waveSummaries?: WaveSummaryRecord[];
  _waveSummaryRecorded?: boolean;

  // Replay / recording runtime fields
  _gameSeed?: number;
  _actionLog?: ReplayAction[];
  _replayCheckpoints?: ReplayCheckpoint[];
  _replayCheckpointLastTick?: number;
  _replayCheckpointLastHash?: string | null;
  _replay?: boolean;
  _replayIsHuman?: boolean;
  _replayShopTimer?: number;
  _purchaseToast?: { items: string[]; timer: number } | null;

  // Browser-side laser audio handle
  _browserLaserHandle?: { stop(): void } | null;

  // HUD state
  _lowAmmoTimer?: number;

  // RAF / FPS tracking fields
  _rafDeltaMs?: number;
  _rafFps?: number;
  _fpsFrames?: number;
  _fpsAccum?: number;
  _fpsDisplay?: number;
  _timeAccum?: number;
}

// ── Replay ──

export type ReplayActionType = "fire" | "cursor" | "emp" | "f15" | "flare" | "shop" | "wave_plan";

export interface FireAction {
  type: "fire";
  tick: number;
  x: number;
  y: number;
  /** Deprecated replay compatibility field; ignored by the current fire model. */
  ignoreLauncherReload?: boolean;
}

export interface CursorAction {
  type: "cursor";
  tick: number;
  x: number;
  y: number;
}

export interface EmpAction {
  type: "emp";
  tick: number;
}

export interface F15Action {
  type: "f15";
  tick: number;
}

export interface FlareAction {
  type: "flare";
  tick: number;
}

export interface ShopAction {
  type: "shop";
  tick: number;
  bought: string[];
  draftMode?: boolean;
  wave?: number;
}

export interface WavePlanAction {
  type: "wave_plan";
  tick: number;
  wave: number;
  tactics?: TacticId[];
  style?: CommanderStyle;
}

export type ReplayAction =
  | FireAction
  | CursorAction
  | EmpAction
  | F15Action
  | FlareAction
  | ShopAction
  | WavePlanAction;

export interface ReplayBootstrap {
  startWave?: number;
  acquiredUpgrades?: string[];
  startBurjHealth?: number;
}

export interface ReplayStopCondition {
  type: "waveComplete";
  wave?: number;
}

export interface ReplayData {
  seed: number;
  actions: ReplayAction[];
  replayId?: string;
  draftMode?: boolean;
  bootstrap?: ReplayBootstrap;
  stopCondition?: ReplayStopCondition;
  wave?: number;
  score?: number;
  _buildId?: string;
  _savedAt?: string;
  version?: number;
  checkpoints?: ReplayCheckpoint[];
  finalTick?: number;
  isHuman?: boolean;
}

export interface ReplayCheckpoint {
  tick: number;
  state: GamePhase;
  wave: number;
  score: number;
  burjAlive: boolean;
  burjHealth: number;
  ammo: number[];
  launcherHP: number[];
  fireChargeState: FireChargeState;
  upgrades: Upgrades;
  stats: GameStats;
  counts: Record<string, number>;
  hash: string;
  reason?: string;
}

// ── Bot ──

export interface BotHumanState {
  focusCenterX: number;
  focusWidth: number;
  focusUntil: number;
  reactionDelay: number;
  seenTicks: WeakMap<object, number>;
  committedTargetRef: Threat | null;
  committedUntil: number;
  cursorX: number;
  cursorY: number;
  moveFromX: number;
  moveFromY: number;
  moveTargetX: number;
  moveTargetY: number;
  moveStartTick: number;
  moveEndTick: number;
  pendingTargetRef: Threat | null;
  pendingAimX: number;
  pendingAimY: number;
  pendingRawX: number;
  pendingRawY: number;
  pendingReadyTick: number;
  clickReadyTick: number;
  lastClickTick: number;
  burstShots: number;
  burstWindowUntil: number;
  burstCooldownUntil: number;
  lastTargetRef: Threat | null;
  lastLane: number;
  lastTick: number;
}
