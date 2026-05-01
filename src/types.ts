// ── Core types for Dubai Missile Command ──

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
  empSlowTimer?: number;
  luredByFlare?: boolean;
  luredFlareId?: number | null;
  flareTargetId?: number;
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
  diveSpeed?: number;
  empSlowTimer?: number;
  luredByFlare?: boolean;
  luredFlareId?: number | null;
  flareTargetId?: number;
  lureDeathTimer?: number;
  bombDropped?: boolean;
  variant?: "normal" | "fast";
  speedMul?: number;
  _hitByExplosions?: Set<number>;
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
  type?: "debris" | "spark";
  angle?: number;
  spin?: number;
  gravity?: number;
  w?: number;
  h?: number;
  drag?: number;
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
  | "emp";

export type Upgrades = Record<UpgradeKey, number>;
export type UpgradeNodeId = string;
export type UpgradeObjectiveId = string;

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
  applySlow?: boolean;
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

export type SpawnType = "missile" | "drone136" | "drone238" | "mirv" | "stack2" | "stack3";

export interface SpawnEntry {
  type: SpawnType;
  tick: number;
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
}

// ── Game stats ──

export interface GameStats {
  missileKills: number;
  droneKills: number;
  shotsFired: number;
}

// ── Full game state ──

export type GamePhase = "playing" | "shop" | "gameover" | "title";

export interface GameState {
  _debugMode: boolean;
  _showColliders: boolean;
  _editorMode?: boolean;
  _showUpgradeRanges?: boolean;
  _draftMode?: boolean;
  _replayTick?: number;
  _replayShopBought?: string[];
  _botHumanState?: BotHumanState;

  state: GamePhase;
  score: number;
  wave: number;
  stats: GameStats;

  ammo: [number, number, number];
  launcherHP: [number, number, number];
  launcherFireTick: [number, number, number];
  launcherReloadUntilTick: [number, number, number];

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
  flares: Flare[];
  empRings: EmpRing[];

  burjAlive: boolean;
  burjHealth: number;
  burjDecals: BurjDecal[];
  burjDamageFx: BurjDamageFx[];
  burjHitFlashTimer: number;
  burjHitFlashMax: number;
  burjHitFlashX: number;
  burjHitFlashY: number;

  planeTimer: number;
  planeInterval: number;
  waveComplete: boolean;
  crosshairX: number;
  crosshairY: number;
  time: number;
  shakeTimer: number;
  shakeIntensity: number;

  upgrades: Upgrades;
  ownedUpgradeNodes: Set<UpgradeNodeId>;
  metaProgression: UpgradeProgressionState;

  hornetTimer: number;
  roadrunnerTimer: number;
  ironBeamTimer: number;
  phalanxTimer: number;
  patriotTimer: number;
  flareTimer: number;
  nextFlareId: number;

  empCharge: number;
  empChargeMax: number;
  empReady: boolean;

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
  planeWarned?: boolean;
  _draftOffers?: string[];
  _bonusScreenStarted?: boolean;
  _bonusScreenDone?: boolean;
  _waveStartMissileKills?: number;
  _waveStartDroneKills?: number;

  // Replay / recording runtime fields
  _gameSeed?: number;
  _actionLog?: Array<{ tick: number; type: string; x?: number; y?: number; bought?: string[] }>;
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

export type ReplayActionType = "fire" | "cursor" | "emp" | "shop" | "wave_plan";

export interface FireAction {
  type: "fire";
  tick: number;
  x: number;
  y: number;
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

export interface ShopAction {
  type: "shop";
  tick: number;
  bought: string[];
  draftMode?: boolean;
}

export interface WavePlanAction {
  type: "wave_plan";
  tick: number;
  wave: number;
  tactics?: TacticId[];
  style?: CommanderStyle;
}

export type ReplayAction = FireAction | CursorAction | EmpAction | ShopAction | WavePlanAction;

export interface ReplayBootstrap {
  startWave?: number;
  acquiredUpgrades?: string[];
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
  launcherReloadUntilTick: number[];
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
