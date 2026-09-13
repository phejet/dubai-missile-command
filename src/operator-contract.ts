import type { UpgradeTimelineEntry } from "./types";

export const OPERATOR_SAFE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
export const OPERATOR_OUTCOMES = ["burj_destroyed", "survived", "abandoned"] as const;
export const OPERATOR_FEEDBACK = ["🔥", "👍", "😕", "😤"] as const;
export const OPERATOR_REPLAY_STATUSES = ["available", "expired", "missing", "omitted"] as const;
export const DESTROYED_TYPES = [
  "ballisticMissile",
  "mirv",
  "mirvWarhead",
  "stackedMissile",
  "bomb",
  "shahed136",
  "shahed238",
  "other",
] as const;
export type OperatorReplayStatus = (typeof OPERATOR_REPLAY_STATUSES)[number];
export interface OperatorSessionSummary {
  runId: string;
  receivedAt: number;
  build: string;
  score: number;
  wave: number;
  outcome: (typeof OPERATOR_OUTCOMES)[number];
  feedbackEmoji: (typeof OPERATOR_FEEDBACK)[number] | null;
  replayStatus: OperatorReplayStatus;
}
export interface OperatorSessionDetail extends OperatorSessionSummary {
  createdAt: number;
  appFlavor: string;
  appleEnvironment: string | null;
  platform: string;
  inputClass: string;
  source: string;
  deathCause: string | null;
  timePlayedMs: number;
  burjHealth: number;
  shotsFired: number;
  totalKills: number;
  hitRatio: number;
  multiShots: number;
  maxCombo: number;
  destroyedByType: Record<(typeof DESTROYED_TYPES)[number], number>;
  upgrades: UpgradeTimelineEntry[];
  replayCompleteClaimed: boolean;
  canRequestReplay: boolean;
}
export interface OperatorCursor {
  receivedAt: number;
  runId: string;
}
export interface OperatorFilters {
  limit: number;
  cursor: OperatorCursor | null;
  build?: string;
  minScore?: number;
  maxScore?: number;
  minWave?: number;
  maxWave?: number;
  outcome?: OperatorSessionSummary["outcome"];
  feedback?: NonNullable<OperatorSessionSummary["feedbackEmoji"]> | "none";
  replay?: OperatorReplayStatus;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function nonnegative(value: unknown, integer = true): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value));
}
export function encodeCursor(value: OperatorCursor): string {
  return btoa(JSON.stringify(value));
}
export function decodeCursor(value: string): OperatorCursor {
  try {
    if (value.length > 256) throw new Error();
    const parsed: unknown = JSON.parse(atob(value));
    if (
      !record(parsed) ||
      Object.keys(parsed).sort().join() !== "receivedAt,runId" ||
      !nonnegative(parsed.receivedAt) ||
      typeof parsed.runId !== "string" ||
      !OPERATOR_SAFE_ID.test(parsed.runId)
    )
      throw new Error();
    return { receivedAt: parsed.receivedAt, runId: parsed.runId };
  } catch {
    throw new Error("Invalid cursor");
  }
}
export function parseOperatorFilters(params: URLSearchParams): OperatorFilters {
  const allowed = [
    "limit",
    "cursor",
    "build",
    "minScore",
    "maxScore",
    "minWave",
    "maxWave",
    "outcome",
    "feedback",
    "replay",
  ];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new Error("Invalid filter");
  const result: OperatorFilters = { limit: 50, cursor: null };
  for (const key of ["limit", "minScore", "maxScore", "minWave", "maxWave"] as const) {
    const value = params.get(key);
    if (value === null) continue;
    if (!/^(0|[1-9]\d*)$/.test(value) || !nonnegative(Number(value))) throw new Error(`Invalid ${key}`);
    result[key] = Number(value);
  }
  if (result.limit < 1 || result.limit > 100) throw new Error("Invalid limit");
  for (const [min, max] of [
    ["minScore", "maxScore"],
    ["minWave", "maxWave"],
  ] as const)
    if (result[min] !== undefined && result[max] !== undefined && result[min]! > result[max]!)
      throw new Error("Inverted range");
  const build = params.get("build");
  if (build !== null) {
    if (!OPERATOR_SAFE_ID.test(build)) throw new Error("Invalid build");
    result.build = build;
  }
  const outcome = params.get("outcome");
  if (outcome !== null) {
    if (!(OPERATOR_OUTCOMES as readonly string[]).includes(outcome)) throw new Error("Invalid outcome");
    result.outcome = outcome as OperatorFilters["outcome"];
  }
  const feedback = params.get("feedback");
  if (feedback !== null) {
    if (!["none", ...OPERATOR_FEEDBACK].includes(feedback)) throw new Error("Invalid feedback");
    result.feedback = feedback as OperatorFilters["feedback"];
  }
  const replay = params.get("replay");
  if (replay !== null) {
    if (!(OPERATOR_REPLAY_STATUSES as readonly string[]).includes(replay)) throw new Error("Invalid replay");
    result.replay = replay as OperatorReplayStatus;
  }
  if (params.has("cursor")) result.cursor = decodeCursor(params.get("cursor")!);
  return result;
}
export function validUpgrades(value: unknown): value is UpgradeTimelineEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= 10000 &&
    value.every(
      (entry) =>
        record(entry) &&
        nonnegative(entry.tick) &&
        nonnegative(entry.wave) &&
        Array.isArray(entry.bought) &&
        entry.bought.every((item) => typeof item === "string" && OPERATOR_SAFE_ID.test(item)),
    )
  );
}
export function validDestroyed(value: unknown): value is OperatorSessionDetail["destroyedByType"] {
  return record(value) && DESTROYED_TYPES.every((key) => nonnegative(value[key]));
}

export function parseSummary(value: unknown): OperatorSessionSummary {
  if (
    !record(value) ||
    typeof value.runId !== "string" ||
    !OPERATOR_SAFE_ID.test(value.runId) ||
    typeof value.build !== "string" ||
    !OPERATOR_SAFE_ID.test(value.build) ||
    !nonnegative(value.receivedAt) ||
    !nonnegative(value.score) ||
    !nonnegative(value.wave) ||
    !(OPERATOR_OUTCOMES as readonly unknown[]).includes(value.outcome) ||
    !(OPERATOR_REPLAY_STATUSES as readonly unknown[]).includes(value.replayStatus) ||
    (value.feedbackEmoji !== null && !(OPERATOR_FEEDBACK as readonly unknown[]).includes(value.feedbackEmoji))
  )
    throw new Error("Invalid run summary response");
  return {
    runId: value.runId,
    build: value.build,
    receivedAt: value.receivedAt,
    score: value.score,
    wave: value.wave,
    outcome: value.outcome as OperatorSessionSummary["outcome"],
    replayStatus: value.replayStatus as OperatorSessionSummary["replayStatus"],
    feedbackEmoji: value.feedbackEmoji as OperatorSessionSummary["feedbackEmoji"],
  };
}
export function parseDetail(value: unknown): OperatorSessionDetail {
  const summary = parseSummary(value);
  if (!record(value)) throw new Error("Invalid run detail response");
  for (const key of ["createdAt", "timePlayedMs", "shotsFired", "totalKills", "multiShots", "maxCombo"] as const)
    if (!nonnegative(value[key])) throw new Error("Invalid run detail response");
  for (const key of ["appFlavor", "platform", "inputClass", "source"] as const)
    if (typeof value[key] !== "string" || value[key].length > 64) throw new Error("Invalid run detail response");
  if (
    !nonnegative(value.burjHealth, false) ||
    !nonnegative(value.hitRatio, false) ||
    value.hitRatio > 1 ||
    !validDestroyed(value.destroyedByType) ||
    !validUpgrades(value.upgrades) ||
    typeof value.replayCompleteClaimed !== "boolean" ||
    typeof value.canRequestReplay !== "boolean" ||
    (value.appleEnvironment !== null && !["production", "development"].includes(value.appleEnvironment as string)) ||
    (value.deathCause !== null && value.deathCause !== "burj_destroyed")
  )
    throw new Error("Invalid run detail response");
  const destroyed = value.destroyedByType;
  // Project again at the client boundary; unexpected fields never enter view state.
  return {
    ...summary,
    createdAt: value.createdAt as number,
    timePlayedMs: value.timePlayedMs as number,
    shotsFired: value.shotsFired as number,
    totalKills: value.totalKills as number,
    multiShots: value.multiShots as number,
    maxCombo: value.maxCombo as number,
    appFlavor: value.appFlavor as string,
    platform: value.platform as string,
    inputClass: value.inputClass as string,
    source: value.source as string,
    appleEnvironment: value.appleEnvironment as string | null,
    deathCause: value.deathCause as string | null,
    burjHealth: value.burjHealth,
    hitRatio: value.hitRatio,
    destroyedByType: Object.fromEntries(
      DESTROYED_TYPES.map((key) => [key, destroyed[key]]),
    ) as OperatorSessionDetail["destroyedByType"],
    upgrades: value.upgrades.map(({ tick, wave, bought }) => ({ tick, wave, bought: [...bought] })),
    replayCompleteClaimed: value.replayCompleteClaimed,
    canRequestReplay: value.canRequestReplay,
  };
}
