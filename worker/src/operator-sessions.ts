import {
  OPERATOR_SAFE_ID,
  parseSummary,
  parseDetail,
  parseOperatorFilters,
  encodeCursor,
  validUpgrades,
  validDestroyed,
  type OperatorFilters,
  type OperatorReplayStatus,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
} from "../../src/operator-contract";
import { authorized } from "./auth";
import type { Env } from "./bindings";
import { jsonResponse } from "./ingest";
import { isRetained, retentionCutoff, REPLAY_RETENTION_MS, SESSION_RETENTION_MS } from "./retention";

type Row = Record<string, unknown> & {
  run_id: string;
  received_at: number;
  replay_sha256: string | null;
  r2_key: string | null;
};
const LIST_COLUMNS =
  "s.run_id, s.received_at, s.build, s.score, s.wave_reached, s.outcome, s.feedback_emoji, s.replay_sha256, r.r2_key";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, s.created_at, s.app_flavor, s.apple_environment, s.platform, s.input_class, s.source, s.death_cause, s.time_played_ms, s.burj_health, s.shots_fired, s.total_kills, s.hit_ratio, s.multi_shots, s.max_combo, s.destroyed_by_type_json, s.upgrades_json, s.replay_complete_claimed`;
const JOIN = "FROM sessions s LEFT JOIN replays r ON r.replay_sha256 = s.replay_sha256";
export function operatorQuery(filters: OperatorFilters, now: number, batchLimit: number) {
  const clauses = ["s.received_at >= ?"];
  const values: unknown[] = [retentionCutoff(now, SESSION_RETENTION_MS)];
  for (const [key, expression] of [
    ["build", "s.build = ?"],
    ["minScore", "s.score >= ?"],
    ["maxScore", "s.score <= ?"],
    ["minWave", "s.wave_reached >= ?"],
    ["maxWave", "s.wave_reached <= ?"],
    ["outcome", "s.outcome = ?"],
  ] as const) {
    if (filters[key] !== undefined) {
      clauses.push(expression);
      values.push(filters[key]);
    }
  }
  if (filters.feedback === "none") clauses.push("s.feedback_emoji IS NULL");
  else if (filters.feedback) {
    clauses.push("s.feedback_emoji = ?");
    values.push(filters.feedback);
  }
  if (filters.cursor) {
    clauses.push("(s.received_at < ? OR (s.received_at = ? AND s.run_id < ?))");
    values.push(filters.cursor.receivedAt, filters.cursor.receivedAt, filters.cursor.runId);
  }
  if (filters.replay === "omitted") clauses.push("s.replay_sha256 IS NULL");
  else if (filters.replay) {
    clauses.push("s.replay_sha256 IS NOT NULL", `s.received_at ${filters.replay === "expired" ? "<" : ">="} ?`);
    values.push(retentionCutoff(now, REPLAY_RETENTION_MS));
    if (filters.replay === "available") clauses.push("r.r2_key IS NOT NULL");
  }
  values.push(batchLimit);
  return {
    sql: `SELECT ${LIST_COLUMNS} ${JOIN} WHERE ${clauses.join(" AND ")} ORDER BY s.received_at DESC, s.run_id DESC LIMIT ?`,
    values,
  };
}
function storedStatus(row: Row, now: number): OperatorReplayStatus {
  return row.replay_sha256 === null
    ? "omitted"
    : !isRetained(row.received_at, now, REPLAY_RETENTION_MS)
      ? "expired"
      : row.r2_key === null
        ? "missing"
        : "available";
}
async function status(env: Env, row: Row, now: number): Promise<OperatorReplayStatus> {
  const value = storedStatus(row, now);
  return value === "available" && !(await env.CAPTURES.head(row.r2_key!)) ? "missing" : value;
}
function summary(row: Row, replayStatus: OperatorReplayStatus): OperatorSessionSummary {
  return parseSummary({
    runId: row.run_id,
    receivedAt: row.received_at,
    build: row.build as string,
    score: row.score as number,
    wave: row.wave_reached as number,
    outcome: row.outcome as OperatorSessionSummary["outcome"],
    feedbackEmoji: row.feedback_emoji as OperatorSessionSummary["feedbackEmoji"],
    replayStatus,
  });
}
async function list(env: Env, filters: OperatorFilters, now: number): Promise<Response> {
  const sessions: OperatorSessionSummary[] = [];
  // Bound each request to 500 candidates and each HEAD group to eight objects.
  let inspected = 0;
  let cursor = filters.cursor;
  while (inspected < 500) {
    const batchLimit = Math.min(50, 500 - inspected);
    const query = operatorQuery({ ...filters, cursor }, now, batchLimit);
    const { results = [] } = await env.DB.prepare(query.sql)
      .bind(...query.values)
      .all<Row>();
    for (let offset = 0; offset < results.length; offset += 8) {
      const batch = results.slice(offset, offset + 8);
      const statuses = await Promise.all(batch.map((row) => status(env, row, now)));
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        cursor = { receivedAt: row.received_at, runId: row.run_id };
        inspected++;
        if (!filters.replay || statuses[i] === filters.replay) sessions.push(summary(row, statuses[i]));
        if (sessions.length === filters.limit)
          return jsonResponse(200, { ok: true, sessions, nextCursor: encodeCursor(cursor) });
      }
    }
    if (results.length < batchLimit) return jsonResponse(200, { ok: true, sessions, nextCursor: null });
  }
  return jsonResponse(200, { ok: true, sessions, nextCursor: cursor ? encodeCursor(cursor) : null });
}
function parseStored(row: Row, field: string, valid: (value: unknown) => boolean): unknown {
  try {
    const value: unknown = JSON.parse(row[field] as string);
    if (!valid(value)) throw new Error();
    return value;
  } catch {
    console.error(`[operator] invalid stored field run=${row.run_id} field=${field}`);
    throw new Error("Stored summary is invalid");
  }
}
async function detail(env: Env, runId: string, replay: boolean, now: number): Promise<Response> {
  const row = await env.DB.prepare(`SELECT ${DETAIL_COLUMNS} ${JOIN} WHERE s.run_id = ? AND s.received_at >= ?`)
    .bind(runId, retentionCutoff(now, SESSION_RETENTION_MS))
    .first<Row>();
  if (!row) return jsonResponse(404, { ok: false, message: "Run not found" });
  // Detail is D1-only. Availability is provisional until replay fetch verifies the object.
  const replayStatus = storedStatus(row, now);
  if (replay) {
    if (replayStatus !== "available") return jsonResponse(200, { ok: true, replay: null, replayStatus });
    const object = await env.CAPTURES.get(row.r2_key!);
    if (!object) return jsonResponse(200, { ok: true, replay: null, replayStatus: "missing" });
    const stream = object.body.pipeThrough(
      new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
    );
    const body: unknown = await new Response(stream).json();
    return jsonResponse(200, { ok: true, replay: body, replayStatus });
  }
  const upgrades = parseStored(row, "upgrades_json", validUpgrades) as OperatorSessionDetail["upgrades"];
  const destroyedByType = parseStored(
    row,
    "destroyed_by_type_json",
    validDestroyed,
  ) as OperatorSessionDetail["destroyedByType"];
  const session: OperatorSessionDetail = {
    ...summary(row, replayStatus),
    createdAt: row.created_at as number,
    appFlavor: (row.app_flavor as string) ?? "unknown",
    appleEnvironment: (row.apple_environment as string) ?? null,
    platform: row.platform as string,
    inputClass: row.input_class as string,
    source: row.source as string,
    deathCause: row.death_cause as string | null,
    timePlayedMs: row.time_played_ms as number,
    burjHealth: row.burj_health as number,
    shotsFired: row.shots_fired as number,
    totalKills: row.total_kills as number,
    hitRatio: row.hit_ratio as number,
    multiShots: row.multi_shots as number,
    maxCombo: row.max_combo as number,
    destroyedByType,
    upgrades,
    replayCompleteClaimed: row.replay_complete_claimed === 1,
    canRequestReplay: replayStatus === "available",
  };
  return jsonResponse(200, { ok: true, session: parseDetail(session) });
}
export async function handleOperatorSessions(
  request: Request,
  env: Env,
  runId?: string,
  replay = false,
): Promise<Response> {
  let response: Response;
  if (!authorized(request, env.CAPTURE_BEARER_TOKEN))
    response = jsonResponse(401, { ok: false, message: "Unauthorized" });
  else if (request.method !== "GET") response = jsonResponse(405, { ok: false, message: "Read-only endpoint" });
  else {
    try {
      const filters = parseOperatorFilters(new URL(request.url).searchParams);
      if (runId !== undefined && !OPERATOR_SAFE_ID.test(runId)) throw new Error("Invalid run ID");
      try {
        response =
          runId === undefined ? await list(env, filters, Date.now()) : await detail(env, runId, replay, Date.now());
      } catch {
        response = jsonResponse(500, { ok: false, message: "Unable to read stored run" });
      }
    } catch {
      response = jsonResponse(400, { ok: false, message: "Invalid operator query" });
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
