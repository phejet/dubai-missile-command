import { SAFE_ID, SAFE_INSTALL_ID, SHA256 } from "../../src/capture-contract";
import type { D1PreparedStatement, Env } from "./bindings";
import { jsonResponse, readBounded } from "./ingest";
import { isRetained, REPORT_RETENTION_MS, REPLAY_RETENTION_MS, SESSION_RETENTION_MS } from "./retention";

const MAX_DELETION_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };

type DeletionScope = "run" | "install";
type DeletionMode = "preview" | "execute" | "resume";
type ReservationRecoveryMode = "inspect" | "recover";
type DeletionJobMode = "list" | "inspect" | "recover";

const RESERVATION_ID = /^(session|report):[a-f0-9-]{36}$/;

interface DeletionRequest {
  scope: DeletionScope;
  reference: string;
  planDigest?: string;
  confirmation?: string;
}

interface ResumeRequest {
  jobId: string;
}

interface ReservationRecoveryRequest {
  requestId: string;
  invocationEnded?: boolean;
  planDigest?: string;
  confirmation?: string;
}

interface SessionTarget {
  run_id: string;
  replay_sha256: string | null;
  received_at: number;
}

interface ReportTarget {
  report_id: string;
  r2_key: string;
  replay_sha256: string | null;
  received_at: number;
}

interface DeletionTombstone {
  ownerKind: "session" | "report";
  ownerIdHash: string;
  expiresAt: number;
}

interface ReplayTarget {
  replaySha256: string;
  r2Key: string;
  action: "delete" | "preserve";
}

interface DeletionPlan {
  scope: DeletionScope;
  reference: string;
  sessions: string[];
  reports: string[];
  sharedRuns: string[];
  diagnosticObjects: string[];
  replays: ReplayTarget[];
  tombstones: DeletionTombstone[];
}

interface StoredJob {
  job_id: string;
  scope: DeletionScope | "reservation";
  state: string;
  plan_digest: string;
  object_manifest_json: string | null;
  blocked_stage?: string | null;
  target_counts_json?: string;
  created_at?: number;
  updated_at?: number;
  last_error?: string | null;
}

interface ReservationRecoveryPlan {
  requestId: string;
  replaySha256: string | null;
  ownerKind: "session" | "report";
  ownerId: string;
  ownerCommitted: boolean;
  hasLiveReference: boolean;
  r2Key: string | null;
  diagnosticR2Key: string | null;
  installId: string | null;
  runId: string | null;
  action: "delete" | "preserve";
  createdAt: number;
  updatedAt: number;
  deletionLock: { jobId: string; state: string } | null;
}

interface DeletionJobRequest {
  jobId?: string;
  planDigest?: string;
  confirmation?: string;
}

function operatorJson(status: number, body: Record<string, unknown>): Response {
  return jsonResponse(status, body, NO_STORE);
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseDeletionRequest(value: Record<string, unknown> | null): DeletionRequest | null {
  if (
    !value ||
    (value.scope !== "run" && value.scope !== "install") ||
    typeof value.reference !== "string" ||
    (value.planDigest !== undefined && (typeof value.planDigest !== "string" || !SHA256.test(value.planDigest))) ||
    (value.confirmation !== undefined && typeof value.confirmation !== "string") ||
    Object.keys(value).some(
      (key) => key !== "scope" && key !== "reference" && key !== "planDigest" && key !== "confirmation",
    )
  ) {
    return null;
  }
  if (value.scope === "run" ? !SAFE_ID.test(value.reference) : !SAFE_INSTALL_ID.test(value.reference)) return null;
  return value as unknown as DeletionRequest;
}

function parseResumeRequest(value: Record<string, unknown> | null): ResumeRequest | null {
  if (!value || typeof value.jobId !== "string" || !SAFE_ID.test(value.jobId) || Object.keys(value).length !== 1) {
    return null;
  }
  return { jobId: value.jobId };
}

function parseReservationRecoveryRequest(value: Record<string, unknown> | null): ReservationRecoveryRequest | null {
  if (
    !value ||
    typeof value.requestId !== "string" ||
    !RESERVATION_ID.test(value.requestId) ||
    (value.invocationEnded !== undefined && typeof value.invocationEnded !== "boolean") ||
    (value.planDigest !== undefined && (typeof value.planDigest !== "string" || !SHA256.test(value.planDigest))) ||
    (value.confirmation !== undefined && typeof value.confirmation !== "string") ||
    Object.keys(value).some(
      (key) => key !== "requestId" && key !== "invocationEnded" && key !== "planDigest" && key !== "confirmation",
    )
  ) {
    return null;
  }
  return value as unknown as ReservationRecoveryRequest;
}

function targetPredicate(scope: DeletionScope): { sessions: string; reports: string } {
  return scope === "run"
    ? { sessions: "run_id = ?", reports: "run_id = ?" }
    : { sessions: "install_id = ?", reports: "install_id = ?" };
}

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results ?? [];
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function replayHasSurvivingReference(
  env: Env,
  sha: string,
  targetRunIds: ReadonlySet<string>,
  targetReportIds: ReadonlySet<string>,
  now: number,
): Promise<boolean> {
  const [sessionRefs, reportRefs] = await Promise.all([
    rows<{ run_id: string; received_at: number }>(
      env.DB.prepare("SELECT run_id, received_at FROM sessions WHERE replay_sha256 = ?").bind(sha),
    ),
    rows<{ report_id: string; received_at: number }>(
      env.DB.prepare("SELECT report_id, received_at FROM diagnostic_reports WHERE replay_sha256 = ?").bind(sha),
    ),
  ]);
  return (
    sessionRefs.some((row) => !targetRunIds.has(row.run_id) && isRetained(row.received_at, now, REPLAY_RETENTION_MS)) ||
    reportRefs.some(
      (row) => !targetReportIds.has(row.report_id) && isRetained(row.received_at, now, REPORT_RETENTION_MS),
    )
  );
}

export async function buildDeletionPlan(
  env: Env,
  request: Pick<DeletionRequest, "scope" | "reference">,
  now = Date.now(),
): Promise<DeletionPlan> {
  const predicate = targetPredicate(request.scope);
  const [sessionRows, reportRows] = await Promise.all([
    rows<SessionTarget>(
      env.DB.prepare(`SELECT run_id, replay_sha256, received_at FROM sessions WHERE ${predicate.sessions}`).bind(
        request.reference,
      ),
    ),
    rows<ReportTarget>(
      env.DB.prepare(
        `SELECT report_id, r2_key, replay_sha256, received_at FROM diagnostic_reports WHERE ${predicate.reports}`,
      ).bind(request.reference),
    ),
  ]);
  const sessions = sorted(sessionRows.map((row) => row.run_id));
  const reports = sorted(reportRows.map((row) => row.report_id));
  const targetRunIds = new Set(sessions);
  const targetReportIds = new Set(reports);
  const replayShas = sorted(
    [...sessionRows, ...reportRows]
      .map((row) => row.replay_sha256)
      .filter((value): value is string => typeof value === "string" && SHA256.test(value)),
  );
  const replays: ReplayTarget[] = [];
  for (const replaySha256 of replayShas) {
    const replay = await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
      .bind(replaySha256)
      .first<{ r2_key: string }>();
    const preserve = await replayHasSurvivingReference(env, replaySha256, targetRunIds, targetReportIds, now);
    replays.push({
      replaySha256,
      r2Key: replay?.r2_key ?? `replays/${replaySha256}.json.gz`,
      action: preserve ? "preserve" : "delete",
    });
  }
  const sharedRuns = sessions.length
    ? sorted(
        (
          await rows<{ run_id: string }>(
            env.DB.prepare(
              `SELECT run_id FROM shared_runs WHERE run_id IN (${sessions.map(() => "?").join(", ")})`,
            ).bind(...sessions),
          )
        ).map((row) => row.run_id),
      )
    : [];
  return {
    scope: request.scope,
    reference: request.reference,
    sessions,
    reports,
    sharedRuns,
    diagnosticObjects: sorted(reportRows.map((row) => row.r2_key)),
    replays,
    tombstones: await Promise.all([
      ...sessionRows.map(async (row) => ({
        ownerKind: "session" as const,
        ownerIdHash: await sha256Hex(`session\0${row.run_id}`),
        expiresAt: row.received_at + SESSION_RETENTION_MS,
      })),
      ...reportRows.map(async (row) => ({
        ownerKind: "report" as const,
        ownerIdHash: await sha256Hex(`report\0${row.report_id}`),
        expiresAt: row.received_at + REPORT_RETENTION_MS,
      })),
    ]),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deletionPlanDigest(plan: DeletionPlan): Promise<string> {
  return sha256Hex(JSON.stringify(plan));
}

async function buildReservationRecoveryPlan(
  env: Env,
  requestId: string,
  now = Date.now(),
): Promise<ReservationRecoveryPlan | null> {
  const [captureReservation, replayReservation] = await Promise.all([
    env.DB.prepare(
      `SELECT request_id, owner_kind, owner_id, install_id, run_id, created_at, updated_at, diagnostic_r2_key
       FROM capture_write_reservations WHERE request_id = ?`,
    )
      .bind(requestId)
      .first<{
        request_id: string;
        owner_kind: "session" | "report";
        owner_id: string;
        created_at: number;
        updated_at: number;
        diagnostic_r2_key: string | null;
        install_id: string;
        run_id: string | null;
      }>(),
    env.DB.prepare(
      `SELECT request_id, replay_sha256, owner_kind, owner_id, created_at, updated_at
     FROM replay_write_reservations WHERE request_id = ?`,
    )
      .bind(requestId)
      .first<{
        request_id: string;
        replay_sha256: string;
        owner_kind: "session" | "report";
        owner_id: string;
        created_at: number;
        updated_at: number;
      }>(),
  ]);
  const reservation = captureReservation ?? replayReservation;
  if (!reservation) return null;
  const replaySha256 = replayReservation?.replay_sha256 ?? null;
  if (replaySha256 !== null && !SHA256.test(replaySha256)) return null;
  const ownerCommitted = Boolean(
    reservation.owner_kind === "session"
      ? await env.DB.prepare(
          "SELECT 1 AS found FROM sessions WHERE run_id = ? AND ((? IS NULL AND replay_sha256 IS NULL) OR replay_sha256 = ?)",
        )
          .bind(reservation.owner_id, replaySha256, replaySha256)
          .first()
      : await env.DB.prepare(
          "SELECT 1 AS found FROM diagnostic_reports WHERE report_id = ? AND ((? IS NULL AND replay_sha256 IS NULL) OR replay_sha256 = ?)",
        )
          .bind(reservation.owner_id, replaySha256, replaySha256)
          .first(),
  );
  const hasLiveReference = replaySha256
    ? await replayHasSurvivingReference(env, replaySha256, new Set(), new Set(), now)
    : false;
  const replay = replaySha256
    ? await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
        .bind(replaySha256)
        .first<{ r2_key: string }>()
    : null;
  const lock = replaySha256
    ? await env.DB.prepare(
        `SELECT l.job_id, j.state
         FROM replay_deletion_locks l JOIN operator_deletions j ON j.job_id = l.job_id
         WHERE l.replay_sha256 = ?`,
      )
        .bind(replaySha256)
        .first<{ job_id: string; state: string }>()
    : null;
  return {
    requestId: reservation.request_id,
    replaySha256,
    ownerKind: reservation.owner_kind,
    ownerId: reservation.owner_id,
    ownerCommitted,
    hasLiveReference,
    r2Key: replaySha256 ? (replay?.r2_key ?? `replays/${replaySha256}.json.gz`) : null,
    diagnosticR2Key: captureReservation?.diagnostic_r2_key ?? null,
    installId: captureReservation?.install_id ?? null,
    runId: captureReservation?.run_id ?? null,
    action: ownerCommitted || hasLiveReference ? "preserve" : "delete",
    createdAt: reservation.created_at,
    updatedAt: reservation.updated_at,
    deletionLock: lock ? { jobId: lock.job_id, state: lock.state } : null,
  };
}

function recoveryConfirmation(plan: ReservationRecoveryPlan, digest: string): string {
  return `RECOVER ${plan.requestId} ${digest}`;
}

function publicRecoveryPlan(plan: ReservationRecoveryPlan, digest: string): Record<string, unknown> {
  return {
    requestId: plan.requestId,
    replaySha256: plan.replaySha256,
    ownerKind: plan.ownerKind,
    ownerId: plan.ownerId,
    ownerCommitted: plan.ownerCommitted,
    hasLiveReference: plan.hasLiveReference,
    replayObject: plan.r2Key,
    diagnosticObject: plan.diagnosticR2Key,
    installId: plan.installId,
    runId: plan.runId,
    action: plan.action,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    ageMs: Math.max(0, Date.now() - plan.createdAt),
    deletionLock: plan.deletionLock,
    planDigest: digest,
    confirmation: recoveryConfirmation(plan, digest),
  };
}

function confirmation(plan: DeletionPlan, digest: string): string {
  return `DELETE ${plan.scope}:${plan.reference} ${digest}`;
}

function publicPlan(plan: DeletionPlan, digest: string): Record<string, unknown> {
  return {
    scope: plan.scope,
    reference: plan.reference,
    planDigest: digest,
    confirmation: confirmation(plan, digest),
    sessions: plan.sessions,
    reports: plan.reports,
    sharedRuns: plan.sharedRuns,
    replayObjects: plan.replays.filter((row) => row.action === "delete").map((row) => row.r2Key),
    preservedReplayObjects: plan.replays.filter((row) => row.action === "preserve").map((row) => row.r2Key),
    diagnosticObjects: plan.diagnosticObjects,
  };
}

async function deleteAndVerify(env: Env, key: string): Promise<void> {
  await env.CAPTURES.delete(key);
  if (await env.CAPTURES.head(key)) throw new Error(`R2 object still exists after deletion: ${key}`);
}

function deleteIds(env: Env, table: "shared_runs" | "diagnostic_reports" | "sessions", column: string, ids: string[]) {
  if (ids.length === 0) return null;
  return env.DB.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => "?").join(", ")})`).bind(...ids);
}

async function updateJob(env: Env, jobId: string, state: string, lastError: string | null = null): Promise<void> {
  await env.DB.prepare(
    "UPDATE operator_deletions SET state = ?, blocked_stage = NULL, updated_at = ?, last_error = ? WHERE job_id = ?",
  )
    .bind(state, Date.now(), lastError, jobId)
    .run();
}

async function blockJob(env: Env, jobId: string, stage: string, message: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE operator_deletions
     SET state = 'blocked', blocked_stage = ?, updated_at = ?, last_error = ?
     WHERE job_id = ?`,
  )
    .bind(stage, Date.now(), message.slice(0, 500), jobId)
    .run();
}

async function releaseJobLocks(env: Env, jobId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM replay_deletion_locks WHERE job_id = ?").bind(jobId),
    env.DB.prepare("DELETE FROM operator_deletion_scope_locks WHERE job_id = ?").bind(jobId),
  ]);
}

async function acquireLocks(env: Env, jobId: string, plan: DeletionPlan): Promise<boolean> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO operator_deletion_scope_locks (scope, reference, job_id, acquired_at)
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM capture_write_reservations
       WHERE (? = 'install' AND install_id = ?)
          OR (? = 'run' AND ((owner_kind = 'session' AND owner_id = ?) OR run_id = ?))
     )`,
  )
    .bind(
      plan.scope,
      plan.reference,
      jobId,
      Date.now(),
      plan.scope,
      plan.reference,
      plan.scope,
      plan.reference,
      plan.reference,
    )
    .run();
  const scopeLock = await env.DB.prepare(
    "SELECT job_id FROM operator_deletion_scope_locks WHERE scope = ? AND reference = ?",
  )
    .bind(plan.scope, plan.reference)
    .first<{ job_id: string }>();
  if (scopeLock?.job_id !== jobId) return false;

  const replayShas = plan.replays.map((row) => row.replaySha256);
  for (const sha of replayShas) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO replay_deletion_locks (replay_sha256, job_id, acquired_at)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM replay_write_reservations WHERE replay_sha256 = ?
       )`,
    )
      .bind(sha, jobId, Date.now(), sha)
      .run();
  }
  if (replayShas.length === 0) return true;
  const placeholders = replayShas.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM replay_deletion_locks
     WHERE job_id = ? AND replay_sha256 IN (${placeholders})`,
  )
    .bind(jobId, ...replayShas)
    .first<{ count: number }>();
  const acquired = row?.count === replayShas.length;
  if (!acquired) await releaseJobLocks(env, jobId);
  return acquired;
}

async function storeTombstones(env: Env, plan: DeletionPlan): Promise<void> {
  const live = plan.tombstones.filter((row) => row.expiresAt >= Date.now());
  if (live.length === 0) return;
  await env.DB.batch(
    live.map((row) =>
      env.DB.prepare(
        `INSERT INTO capture_deletion_tombstones (owner_kind, owner_id_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_kind, owner_id_hash) DO UPDATE SET
           expires_at = MAX(capture_deletion_tombstones.expires_at, excluded.expires_at)`,
      ).bind(row.ownerKind, row.ownerIdHash, row.expiresAt, Date.now()),
    ),
  );
}

async function verifyTargetsGone(env: Env, plan: DeletionPlan): Promise<void> {
  for (const [table, column, ids] of [
    ["sessions", "run_id", plan.sessions],
    ["diagnostic_reports", "report_id", plan.reports],
    ["shared_runs", "run_id", plan.sharedRuns],
  ] as const) {
    if (ids.length === 0) continue;
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${ids.map(() => "?").join(", ")})`,
    )
      .bind(...ids)
      .first<{ count: number }>();
    if ((result?.count ?? 0) !== 0) throw new Error(`${table} still contains deletion targets`);
  }
  const predicate = targetPredicate(plan.scope);
  const [remainingSessions, remainingReports] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE ${predicate.sessions}`)
      .bind(plan.reference)
      .first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM diagnostic_reports WHERE ${predicate.reports}`)
      .bind(plan.reference)
      .first<{ count: number }>(),
  ]);
  if ((remainingSessions?.count ?? 0) !== 0 || (remainingReports?.count ?? 0) !== 0) {
    throw new Error("Deletion scope gained new targets while locked");
  }
  for (const key of [
    ...plan.diagnosticObjects,
    ...plan.replays.filter((row) => row.action === "delete").map((row) => row.r2Key),
  ]) {
    if (await env.CAPTURES.head(key)) throw new Error(`R2 object still exists after deletion: ${key}`);
  }
  for (const replay of plan.replays) {
    if (await replayHasSurvivingReference(env, replay.replaySha256, new Set(), new Set(), Date.now())) continue;
    if (await env.CAPTURES.head(replay.r2Key)) throw new Error(`Orphan replay object remains: ${replay.r2Key}`);
    if (
      await env.DB.prepare("SELECT 1 AS found FROM replays WHERE replay_sha256 = ?").bind(replay.replaySha256).first()
    ) {
      throw new Error(`Orphan replay index remains: ${replay.replaySha256}`);
    }
  }
}

async function executeReservationRecoveryJob(env: Env, job: StoredJob): Promise<Response> {
  if (!job.object_manifest_json) {
    return operatorJson(500, {
      ok: false,
      stage: "store",
      message: "Reservation recovery manifest is unavailable",
      jobId: job.job_id,
    });
  }
  const plan = JSON.parse(job.object_manifest_json) as ReservationRecoveryPlan;
  try {
    await updateJob(env, job.job_id, "locking");
    const recoveryScope = plan.runId ? "run" : plan.installId ? "install" : null;
    const recoveryReference = plan.runId ?? plan.installId;
    const lockStatements = [
      env.DB.prepare("DELETE FROM replay_write_reservations WHERE request_id = ? AND replay_sha256 = ?").bind(
        plan.requestId,
        plan.replaySha256,
      ),
      env.DB.prepare("DELETE FROM capture_write_reservations WHERE request_id = ?").bind(plan.requestId),
      ...(recoveryScope && recoveryReference
        ? [
            env.DB.prepare(
              `INSERT OR IGNORE INTO operator_deletion_scope_locks (scope, reference, job_id, acquired_at)
               SELECT ?, ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM capture_write_reservations
                 WHERE (? = 'install' AND install_id = ?)
                    OR (? = 'run' AND ((owner_kind = 'session' AND owner_id = ?) OR run_id = ?))
               )`,
            ).bind(
              recoveryScope,
              recoveryReference,
              job.job_id,
              Date.now(),
              recoveryScope,
              recoveryReference,
              recoveryScope,
              recoveryReference,
              recoveryReference,
            ),
          ]
        : []),
      ...(plan.replaySha256
        ? [
            env.DB.prepare(
              `INSERT OR IGNORE INTO replay_deletion_locks (replay_sha256, job_id, acquired_at)
               SELECT ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM replay_write_reservations WHERE replay_sha256 = ?
               )`,
            ).bind(plan.replaySha256, job.job_id, Date.now(), plan.replaySha256),
          ]
        : []),
    ];
    await env.DB.batch(lockStatements);
    if (recoveryScope && recoveryReference) {
      const scopeLock = await env.DB.prepare(
        "SELECT job_id FROM operator_deletion_scope_locks WHERE scope = ? AND reference = ?",
      )
        .bind(recoveryScope, recoveryReference)
        .first<{ job_id: string }>();
      if (scopeLock?.job_id !== job.job_id) throw new Error("Reservation recovery could not acquire the scope lock");
    }
    if (plan.replaySha256) {
      const lock = await env.DB.prepare("SELECT job_id FROM replay_deletion_locks WHERE replay_sha256 = ?")
        .bind(plan.replaySha256)
        .first<{ job_id: string }>();
      if (lock?.job_id !== job.job_id) throw new Error("Reservation recovery could not acquire the replay lock");
    }

    await updateJob(env, job.job_id, "replays");
    const hasLiveReference = plan.replaySha256
      ? await replayHasSurvivingReference(env, plan.replaySha256, new Set(), new Set(), Date.now())
      : false;
    const action = plan.action === "preserve" || hasLiveReference ? "preserve" : "delete";
    if (action === "delete" && plan.diagnosticR2Key) await deleteAndVerify(env, plan.diagnosticR2Key);
    if (action === "delete" && plan.replaySha256 && plan.r2Key) {
      await deleteAndVerify(env, plan.r2Key);
      const now = Date.now();
      await env.DB.prepare(
        `DELETE FROM replays
         WHERE replay_sha256 = ?
           AND NOT EXISTS (
             SELECT 1 FROM sessions
             WHERE replay_sha256 = ? AND received_at >= ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM diagnostic_reports
             WHERE replay_sha256 = ? AND received_at >= ?
           )`,
      )
        .bind(
          plan.replaySha256,
          plan.replaySha256,
          now - REPLAY_RETENTION_MS,
          plan.replaySha256,
          now - REPORT_RETENTION_MS,
        )
        .run();
    }

    await updateJob(env, job.job_id, "verifying");
    const [replayReservation, captureReservation] = await Promise.all([
      env.DB.prepare("SELECT 1 AS found FROM replay_write_reservations WHERE request_id = ?")
        .bind(plan.requestId)
        .first(),
      env.DB.prepare("SELECT 1 AS found FROM capture_write_reservations WHERE request_id = ?")
        .bind(plan.requestId)
        .first(),
    ]);
    if (replayReservation || captureReservation)
      throw new Error("Capture write reservation still exists after recovery");
    if (action === "delete" && plan.r2Key && (await env.CAPTURES.head(plan.r2Key))) {
      throw new Error(`R2 object still exists after reservation recovery: ${plan.r2Key}`);
    }
    if (action === "delete" && plan.diagnosticR2Key && (await env.CAPTURES.head(plan.diagnosticR2Key))) {
      throw new Error(`Diagnostic object still exists after reservation recovery: ${plan.diagnosticR2Key}`);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM replay_deletion_locks WHERE job_id = ?").bind(job.job_id),
      env.DB.prepare("DELETE FROM operator_deletion_scope_locks WHERE job_id = ?").bind(job.job_id),
      env.DB.prepare(
        `UPDATE operator_deletions
         SET state = 'complete', blocked_stage = NULL, updated_at = ?, last_error = NULL, object_manifest_json = NULL
         WHERE job_id = ?`,
      ).bind(Date.now(), job.job_id),
    ]);
    console.log(
      JSON.stringify({
        message: "replay write reservation recovered",
        jobId: job.job_id,
        requestId: plan.requestId,
        replaySha256: plan.replaySha256,
        action,
      }),
    );
    return operatorJson(200, {
      ok: true,
      mode: "recovered",
      jobId: job.job_id,
      planDigest: job.plan_digest,
      action,
      verified: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await blockJob(env, job.job_id, "replays", message);
    console.error("[capture-worker] replay reservation recovery failed", { jobId: job.job_id, message });
    return operatorJson(500, {
      ok: false,
      stage: "store",
      message: "Reservation recovery incomplete; resume the durable job",
      jobId: job.job_id,
      planDigest: job.plan_digest,
    });
  }
}

export async function executeDeletionJob(env: Env, jobId: string): Promise<Response> {
  const job = await env.DB.prepare(
    "SELECT job_id, scope, state, plan_digest, object_manifest_json FROM operator_deletions WHERE job_id = ?",
  )
    .bind(jobId)
    .first<StoredJob>();
  if (!job) return operatorJson(404, { ok: false, stage: "store", message: "Deletion job not found" });
  if (job.state === "complete") {
    return operatorJson(200, {
      ok: true,
      mode: job.scope === "reservation" ? "recovered" : "executed",
      jobId,
      planDigest: job.plan_digest,
      verified: true,
    });
  }
  if (job.scope === "reservation") return executeReservationRecoveryJob(env, job);
  if (!job.object_manifest_json) {
    return operatorJson(500, { ok: false, stage: "store", message: "Deletion job manifest is unavailable", jobId });
  }
  const plan = JSON.parse(job.object_manifest_json) as DeletionPlan;
  let stage = "locking";
  try {
    await updateJob(env, jobId, "locking");
    if (!(await acquireLocks(env, jobId, plan))) {
      await releaseJobLocks(env, jobId);
      await blockJob(env, jobId, "locking", "Capture write reservation or deletion lock is still active");
      return operatorJson(409, {
        ok: false,
        stage: "locked",
        message: "Capture write is still active; resume this job after the upload finishes",
        jobId,
        planDigest: job.plan_digest,
      });
    }

    stage = "objects";
    await updateJob(env, jobId, "objects");
    for (const key of plan.diagnosticObjects) await deleteAndVerify(env, key);

    stage = "rows";
    await updateJob(env, jobId, "rows");
    await storeTombstones(env, plan);
    const statements = [
      deleteIds(env, "shared_runs", "run_id", plan.sharedRuns),
      deleteIds(env, "diagnostic_reports", "report_id", plan.reports),
      deleteIds(env, "sessions", "run_id", plan.sessions),
    ].filter((statement): statement is D1PreparedStatement => statement !== null);
    if (statements.length) await env.DB.batch(statements);

    stage = "replays";
    await updateJob(env, jobId, "replays");
    for (const replay of plan.replays) {
      const hasSurvivor = await replayHasSurvivingReference(env, replay.replaySha256, new Set(), new Set(), Date.now());
      replay.action = hasSurvivor ? "preserve" : "delete";
      if (!hasSurvivor) {
        await deleteAndVerify(env, replay.r2Key);
        await env.DB.prepare("DELETE FROM replays WHERE replay_sha256 = ?").bind(replay.replaySha256).run();
      }
    }

    stage = "verifying";
    await updateJob(env, jobId, "verifying");
    await verifyTargetsGone(env, plan);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM replay_deletion_locks WHERE job_id = ?").bind(jobId),
      env.DB.prepare("DELETE FROM operator_deletion_scope_locks WHERE job_id = ?").bind(jobId),
      env.DB.prepare(
        `UPDATE operator_deletions
         SET state = 'complete', blocked_stage = NULL, updated_at = ?, last_error = NULL, object_manifest_json = NULL
         WHERE job_id = ?`,
      ).bind(Date.now(), jobId),
    ]);
    console.log(
      JSON.stringify({
        message: "operator deletion completed",
        jobId,
        scope: plan.scope,
        sessions: plan.sessions.length,
        reports: plan.reports.length,
        replayObjects: plan.replays.filter((row) => row.action === "delete").length,
        diagnosticObjects: plan.diagnosticObjects.length,
      }),
    );
    return operatorJson(200, {
      ok: true,
      mode: "executed",
      jobId,
      planDigest: job.plan_digest,
      verified: true,
      ...publicPlan(plan, job.plan_digest),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await blockJob(env, jobId, stage, message);
    console.error("[capture-worker] operator deletion failed", { jobId, message });
    return operatorJson(500, {
      ok: false,
      stage: "store",
      message: "Deletion incomplete; resume the durable job",
      jobId,
      planDigest: job.plan_digest,
    });
  }
}

async function createDeletionJob(env: Env, plan: DeletionPlan, digest: string): Promise<string> {
  const jobId = crypto.randomUUID();
  const referenceHash = await sha256Hex(`${plan.scope}\0${plan.reference}`);
  const counts = JSON.stringify({
    sessions: plan.sessions.length,
    reports: plan.reports.length,
    sharedRuns: plan.sharedRuns.length,
    diagnosticObjects: plan.diagnosticObjects.length,
    replayObjects: plan.replays.filter((row) => row.action === "delete").length,
    preservedReplayObjects: plan.replays.filter((row) => row.action === "preserve").length,
  });
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO operator_deletions (
       job_id, scope, reference_hash, plan_digest, state, target_counts_json,
       object_manifest_json, created_at, updated_at, last_error
     ) VALUES (?, ?, ?, ?, 'locking', ?, ?, ?, ?, NULL)`,
  )
    .bind(jobId, plan.scope, referenceHash, digest, counts, JSON.stringify(plan), now, now)
    .run();
  return jobId;
}

async function createReservationRecoveryJob(env: Env, plan: ReservationRecoveryPlan, digest: string): Promise<string> {
  const jobId = crypto.randomUUID();
  const referenceHash = await sha256Hex(`reservation\0${plan.requestId}`);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO operator_deletions (
       job_id, scope, reference_hash, plan_digest, state, target_counts_json,
       object_manifest_json, created_at, updated_at, last_error
     ) VALUES (?, 'reservation', ?, ?, 'locking', ?, ?, ?, ?, NULL)`,
  )
    .bind(
      jobId,
      referenceHash,
      digest,
      JSON.stringify({
        reservations: 1,
        replayObjects: Number(plan.action === "delete" && plan.replaySha256 !== null),
        diagnosticObjects: Number(plan.action === "delete" && plan.diagnosticR2Key !== null),
      }),
      JSON.stringify(plan),
      now,
      now,
    )
    .run();
  return jobId;
}

export async function handleReservationRecovery(
  request: Request,
  env: Env,
  mode: ReservationRecoveryMode,
): Promise<Response> {
  if (request.method !== "POST") return operatorJson(405, { ok: false, stage: "parse", message: "Method not allowed" });
  let value: Record<string, unknown> | null;
  try {
    value = parseObject(await readBounded(request.body, MAX_DELETION_BODY_BYTES, "reservation recovery body"));
  } catch (error) {
    return operatorJson(400, {
      ok: false,
      stage: "parse",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const body = parseReservationRecoveryRequest(value);
  if (!body) return operatorJson(400, { ok: false, stage: "parse", message: "Invalid reservation request" });
  const plan = await buildReservationRecoveryPlan(env, body.requestId);
  if (!plan) return operatorJson(404, { ok: false, stage: "store", message: "Reservation not found" });
  const digest = await sha256Hex(JSON.stringify(plan));
  if (mode === "inspect") {
    return operatorJson(200, { ok: true, mode: "inspect", ...publicRecoveryPlan(plan, digest) });
  }
  if (body.invocationEnded !== true) {
    return operatorJson(409, {
      ok: false,
      stage: "confirm",
      message: "Confirm the reserving Worker invocation has ended before recovery",
    });
  }
  if (body.planDigest !== digest) {
    return operatorJson(409, {
      ok: false,
      stage: "confirm",
      message: "Reservation state changed; inspect it again",
      currentPlanDigest: digest,
    });
  }
  if (body.confirmation !== recoveryConfirmation(plan, digest)) {
    return operatorJson(409, { ok: false, stage: "confirm", message: "Exact confirmation does not match inspection" });
  }
  return executeDeletionJob(env, await createReservationRecoveryJob(env, plan, digest));
}

function parseDeletionJobRequest(value: Record<string, unknown> | null, requireId: boolean): DeletionJobRequest | null {
  if (!value || Object.keys(value).some((key) => !["jobId", "planDigest", "confirmation"].includes(key))) return null;
  if (requireId && (typeof value.jobId !== "string" || !SAFE_ID.test(value.jobId))) return null;
  if (value.planDigest !== undefined && (typeof value.planDigest !== "string" || !SHA256.test(value.planDigest))) {
    return null;
  }
  if (value.confirmation !== undefined && typeof value.confirmation !== "string") return null;
  return value as DeletionJobRequest;
}

async function deletionJobSummary(env: Env, jobId: string): Promise<Record<string, unknown> | null> {
  const job = await env.DB.prepare(
    `SELECT job_id, scope, state, blocked_stage, plan_digest, target_counts_json,
            object_manifest_json, created_at, updated_at, last_error
     FROM operator_deletions WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<StoredJob>();
  if (!job) return null;
  const [replayLocks, scopeLocks] = await Promise.all([
    rows<{ replay_sha256: string; acquired_at: number }>(
      env.DB.prepare(
        "SELECT replay_sha256, acquired_at FROM replay_deletion_locks WHERE job_id = ? ORDER BY replay_sha256",
      ).bind(jobId),
    ),
    rows<{ scope: string; reference: string; acquired_at: number }>(
      env.DB.prepare(
        "SELECT scope, reference, acquired_at FROM operator_deletion_scope_locks WHERE job_id = ? ORDER BY scope, reference",
      ).bind(jobId),
    ),
  ]);
  const recoverAction =
    job.state === "blocked" && job.blocked_stage === "locking" && replayLocks.length === 0 && scopeLocks.length === 0
      ? "abort"
      : job.state !== "complete" && job.state !== "aborted"
        ? "resume"
        : "none";
  return {
    jobId: job.job_id,
    scope: job.scope,
    state: job.state,
    blockedStage: job.blocked_stage ?? null,
    planDigest: job.plan_digest,
    counts: JSON.parse(job.target_counts_json ?? "{}"),
    manifestPresent: job.object_manifest_json !== null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    lastError: job.last_error ?? null,
    replayLocks: replayLocks.map((row) => ({ replaySha256: row.replay_sha256, acquiredAt: row.acquired_at })),
    scopeLocks: scopeLocks.map((row) => ({ scope: row.scope, reference: row.reference, acquiredAt: row.acquired_at })),
    recoverAction,
    ...(recoverAction !== "none" ? { confirmation: `RECOVER JOB ${job.job_id} ${job.plan_digest}` } : {}),
  };
}

export async function handleDeletionJobs(request: Request, env: Env, mode: DeletionJobMode): Promise<Response> {
  if (request.method !== "POST") return operatorJson(405, { ok: false, stage: "parse", message: "Method not allowed" });
  let value: Record<string, unknown> | null;
  try {
    value = parseObject(await readBounded(request.body, MAX_DELETION_BODY_BYTES, "deletion job body"));
  } catch (error) {
    return operatorJson(400, {
      ok: false,
      stage: "parse",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const body = parseDeletionJobRequest(value, mode !== "list");
  if (!body) return operatorJson(400, { ok: false, stage: "parse", message: "Invalid deletion job request" });
  if (mode === "list") {
    const jobs = await rows<{ job_id: string }>(
      env.DB.prepare(
        "SELECT job_id FROM operator_deletions WHERE state NOT IN ('complete', 'aborted') ORDER BY updated_at DESC LIMIT 100",
      ),
    );
    return operatorJson(200, {
      ok: true,
      mode: "list",
      jobs: (await Promise.all(jobs.map((row) => deletionJobSummary(env, row.job_id)))).filter(Boolean),
    });
  }
  const summary = await deletionJobSummary(env, body.jobId!);
  if (!summary) return operatorJson(404, { ok: false, stage: "store", message: "Deletion job not found" });
  if (mode === "inspect") return operatorJson(200, { ok: true, mode: "inspect", ...summary });
  if (
    body.planDigest !== summary.planDigest ||
    body.confirmation !== `RECOVER JOB ${body.jobId} ${summary.planDigest}`
  ) {
    return operatorJson(409, {
      ok: false,
      stage: "confirm",
      message: "Exact job recovery confirmation does not match",
    });
  }
  if (summary.recoverAction === "abort") {
    await releaseJobLocks(env, body.jobId!);
    await env.DB.prepare(
      `UPDATE operator_deletions
       SET state = 'aborted', blocked_stage = NULL, object_manifest_json = NULL,
           updated_at = ?, last_error = 'Aborted before destructive mutation'
       WHERE job_id = ? AND state = 'blocked' AND blocked_stage = 'locking'`,
    )
      .bind(Date.now(), body.jobId)
      .run();
    return operatorJson(200, { ok: true, mode: "aborted", jobId: body.jobId, verified: true });
  }
  if (summary.recoverAction !== "resume") {
    return operatorJson(409, { ok: false, stage: "store", message: "Deletion job does not require recovery" });
  }
  return executeDeletionJob(env, body.jobId!);
}

export async function handleDeletion(request: Request, env: Env, mode: DeletionMode): Promise<Response> {
  if (request.method !== "POST") return operatorJson(405, { ok: false, stage: "parse", message: "Method not allowed" });
  let value: Record<string, unknown> | null;
  try {
    value = parseObject(await readBounded(request.body, MAX_DELETION_BODY_BYTES, "deletion body"));
  } catch (error) {
    return operatorJson(400, {
      ok: false,
      stage: "parse",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (mode === "resume") {
    const resume = parseResumeRequest(value);
    if (!resume) return operatorJson(400, { ok: false, stage: "parse", message: "Invalid resume request" });
    return executeDeletionJob(env, resume.jobId);
  }
  const body = parseDeletionRequest(value);
  if (!body) return operatorJson(400, { ok: false, stage: "parse", message: "Invalid deletion request" });
  const plan = await buildDeletionPlan(env, body);
  if (plan.sessions.length === 0 && plan.reports.length === 0) {
    return operatorJson(404, { ok: false, stage: "store", message: "No matching uploaded data" });
  }
  const digest = await deletionPlanDigest(plan);
  if (mode === "preview") return operatorJson(200, { ok: true, mode: "preview", ...publicPlan(plan, digest) });
  if (body.planDigest !== digest) {
    return operatorJson(409, {
      ok: false,
      stage: "confirm",
      message: "Target set changed; request a fresh preview",
      currentPlanDigest: digest,
    });
  }
  if (body.confirmation !== confirmation(plan, digest)) {
    return operatorJson(409, { ok: false, stage: "confirm", message: "Exact confirmation does not match preview" });
  }
  return executeDeletionJob(env, await createDeletionJob(env, plan, digest));
}
