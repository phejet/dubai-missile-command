import type { Env } from "./bindings";

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const REPORT_RETENTION_MS = 90 * DAY_MS;
export const REPLAY_RETENTION_MS = 270 * DAY_MS;
export const SESSION_RETENTION_MS = 365 * DAY_MS;
export const SAFE_BLOCKED_MANIFEST_RETENTION_MS = 30 * DAY_MS;

export function retentionCutoff(now: number, windowMs: number): number {
  return now - windowMs;
}

export function isRetained(receivedAt: number, now: number, windowMs: number): boolean {
  return receivedAt >= retentionCutoff(now, windowMs);
}

export async function runRetention(env: Env, now = Date.now()): Promise<void> {
  const reportCutoff = retentionCutoff(now, REPORT_RETENTION_MS);
  const replayCutoff = retentionCutoff(now, REPLAY_RETENTION_MS);
  const sessionCutoff = retentionCutoff(now, SESSION_RETENTION_MS);
  const expiredReports = (
    await env.DB.prepare(
      "SELECT report_id, r2_key FROM diagnostic_reports WHERE received_at < ? ORDER BY received_at LIMIT 80",
    )
      .bind(reportCutoff)
      .all<{ report_id: string; r2_key: string }>()
  ).results;
  const removableReportIds: string[] = [];
  for (const report of expiredReports ?? []) {
    try {
      await env.CAPTURES.delete(report.r2_key);
      if (!(await env.CAPTURES.head(report.r2_key))) removableReportIds.push(report.report_id);
    } catch (error) {
      console.error("[capture-worker] expired diagnostic cleanup failed", {
        reportId: report.report_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const reportDelete = removableReportIds.length
    ? env.DB.prepare(
        `DELETE FROM diagnostic_reports WHERE report_id IN (${removableReportIds.map(() => "?").join(", ")})`,
      ).bind(...removableReportIds)
    : null;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions
       SET feedback_note = NULL, display_name = NULL
       WHERE received_at < ? AND (feedback_note IS NOT NULL OR display_name IS NOT NULL)`,
    ).bind(reportCutoff),
    ...(reportDelete ? [reportDelete] : []),
    env.DB.prepare(
      `UPDATE sessions SET shared = 0
       WHERE received_at < ? AND shared <> 0`,
    ).bind(replayCutoff),
    env.DB.prepare(
      `DELETE FROM shared_runs
       WHERE NOT EXISTS (
         SELECT 1 FROM sessions
         WHERE sessions.run_id = shared_runs.run_id
           AND sessions.received_at >= ?
       )`,
    ).bind(replayCutoff),
    env.DB.prepare(
      `DELETE FROM replays
       WHERE NOT EXISTS (
               SELECT 1 FROM sessions
               WHERE replay_sha256 = replays.replay_sha256
                 AND received_at >= ?
             )
         AND NOT EXISTS (
               SELECT 1 FROM diagnostic_reports
               WHERE replay_sha256 = replays.replay_sha256
                 AND received_at >= ?
             )`,
    ).bind(replayCutoff, reportCutoff),
    env.DB.prepare("DELETE FROM sessions WHERE received_at < ?").bind(sessionCutoff),
    env.DB.prepare("DELETE FROM capture_deletion_tombstones WHERE expires_at < ?").bind(now),
    env.DB.prepare(
      `UPDATE operator_deletions
       SET state = 'aborted', blocked_stage = NULL, object_manifest_json = NULL,
           updated_at = ?, last_error = 'Expired before destructive mutation'
       WHERE state = 'blocked' AND blocked_stage = 'locking' AND updated_at < ?
         AND NOT EXISTS (SELECT 1 FROM replay_deletion_locks WHERE job_id = operator_deletions.job_id)
         AND NOT EXISTS (SELECT 1 FROM operator_deletion_scope_locks WHERE job_id = operator_deletions.job_id)`,
    ).bind(now, now - SAFE_BLOCKED_MANIFEST_RETENTION_MS),
  ]);
}
