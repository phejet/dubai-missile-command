import { getRngState } from "./game-logic";
import type { GameState } from "./types";

export const REPLAY_CAUSAL_EXCLUDED_KEYS = new Set<keyof GameState>([
  "_showColliders",
  "_editorMode",
  "_showUpgradeRanges",
  "_botHumanState",
  "crosshairX",
  "crosshairY",
  "launcherFireTick",
  "_laserHandle",
  "_browserLaserHandle",
  "_lowAmmoTimer",
  "_rafDeltaMs",
  "_rafFps",
  "_fpsFrames",
  "_fpsAccum",
  "_fpsDisplay",
  "_timeAccum",
  "_replayTick",
  "_replayShopBought",
  "_gameSeed",
  "_actionLog",
  "_replayCheckpoints",
  "_replayCheckpointLastTick",
  "_replayCheckpointLastHash",
  "_replay",
  "_replayIsHuman",
  "_replayShopTimer",
  "_purchaseToast",
]);

function normalize(value: unknown, seen = new WeakMap<object, string>(), path = "state"): unknown {
  if (!value || typeof value !== "object") return value;
  const priorPath = seen.get(value);
  if (priorPath) return { $ref: priorPath };
  seen.set(value, path);
  if (value instanceof Set) {
    return [...value]
      .map((entry, index) => normalize(entry, seen, `${path}.set[${index}]`))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalize(entry, seen, `${path}[${index}]`));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("_p"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, normalize(entry, seen, `${path}.${key}`)]),
  );
}

export function getReplayCausalOwnedKeys(g: GameState): string[] {
  return Object.keys(g)
    .filter((key) => !REPLAY_CAUSAL_EXCLUDED_KEYS.has(key as keyof GameState))
    .sort();
}

export function buildReplayCausalSnapshot(g: GameState) {
  const state = Object.fromEntries(getReplayCausalOwnedKeys(g).map((key) => [key, g[key as keyof GameState]]));
  return { rngState: getRngState(), state: normalize(state) };
}
