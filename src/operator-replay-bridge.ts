import type { ReplayData } from "./types";

export const OPERATOR_REPLAY_QUERY = "operatorReplay";
export const OPERATOR_REPLAY_READY = "dmc-operator-replay-ready";
export const OPERATOR_REPLAY_LOAD = "dmc-operator-replay-load";

export function isReplayData(value: unknown): value is ReplayData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const replay = value as Partial<ReplayData>;
  return typeof replay.seed === "number" && Number.isFinite(replay.seed) && Array.isArray(replay.actions);
}

export function installOperatorReplayReceiver(loadReplay: (replay: ReplayData) => Promise<void>): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(OPERATOR_REPLAY_QUERY) !== "1" || !window.opener) return false;
  const source = window.opener;
  const origin = window.location.origin;
  const receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== origin || event.source !== source) return;
    if (typeof event.data !== "object" || event.data === null) return;
    const message = event.data as { type?: unknown; replay?: unknown };
    if (message.type !== OPERATOR_REPLAY_LOAD || !isReplayData(message.replay)) return;
    window.removeEventListener("message", receive);
    void loadReplay(message.replay);
  };
  window.addEventListener("message", receive);
  source.postMessage({ type: OPERATOR_REPLAY_READY }, origin);
  return true;
}
