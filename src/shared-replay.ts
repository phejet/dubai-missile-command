import type { ReplayData } from "./types";

export const SHARED_REPLAY_ID = /^[a-f0-9]{16}$/;
export type ShareEnvironment = "staging" | "production";

export interface SharedReplayRequest {
  endpoint: string;
  environment: ShareEnvironment;
  shareId: string;
}

export interface SharedReplayPayload {
  replay: ReplayData;
  shareId: string;
  summary: {
    build: string;
    outcome: string;
    score: number;
    wave: number;
  };
}

function reviewedEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function parseSharedReplayRequest(
  locationHref: string,
  baseUrls: Readonly<Record<ShareEnvironment, string>>,
): SharedReplayRequest | null {
  let url: URL;
  try {
    url = new URL(locationHref);
  } catch {
    return null;
  }
  const shareId = url.searchParams.get("r") ?? "";
  const environment = url.searchParams.get("share");
  if (!SHARED_REPLAY_ID.test(shareId) || (environment !== "staging" && environment !== "production")) return null;
  const endpoint = reviewedEndpoint(baseUrls[environment]);
  return endpoint ? { endpoint, environment, shareId } : null;
}

function parsePayload(value: unknown, expectedShareId: string): SharedReplayPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as {
    ok?: unknown;
    shareId?: unknown;
    replay?: unknown;
    summary?: unknown;
  };
  if (body.ok !== true || body.shareId !== expectedShareId) return null;
  if (typeof body.replay !== "object" || body.replay === null || Array.isArray(body.replay)) return null;
  const replay = body.replay as Partial<ReplayData>;
  if (typeof replay.seed !== "number" || !Number.isFinite(replay.seed) || !Array.isArray(replay.actions)) return null;
  if (typeof body.summary !== "object" || body.summary === null || Array.isArray(body.summary)) return null;
  const summary = body.summary as Partial<SharedReplayPayload["summary"]>;
  if (
    typeof summary.build !== "string" ||
    !summary.build ||
    typeof summary.outcome !== "string" ||
    typeof summary.score !== "number" ||
    !Number.isFinite(summary.score) ||
    summary.score < 0 ||
    typeof summary.wave !== "number" ||
    !Number.isInteger(summary.wave) ||
    summary.wave < 1
  ) {
    return null;
  }
  return {
    shareId: expectedShareId,
    replay: replay as ReplayData,
    summary: {
      build: summary.build,
      outcome: summary.outcome,
      score: summary.score,
      wave: summary.wave,
    },
  };
}

export async function fetchSharedReplay(
  request: SharedReplayRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SharedReplayPayload> {
  const endpoint = new URL(`/api/shared/${request.shareId}`, request.endpoint);
  const response = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok)
    throw new Error(response.status === 410 ? "This shared replay has expired" : "Shared replay not found");
  const payload = parsePayload((await response.json()) as unknown, request.shareId);
  if (!payload) throw new Error("Shared replay response is invalid");
  return payload;
}
