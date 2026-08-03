import type { ProblemReport, SessionUpload } from "../../src/capture";

export interface ReplayRow {
  replay_sha256: string;
  first_seen_at: number;
  last_referenced_at: number;
  raw_bytes: number;
  stored_bytes: number;
  r2_key: string;
}

export interface SessionRow {
  run_id: string;
  install_id: string;
  install_ephemeral: number;
  display_name: string | null;
  build: string;
  platform: string;
  input_class: string;
  created_at: number;
  received_at: number;
  outcome: string;
  death_cause: string | null;
  wave_reached: number;
  score: number;
  time_played_ms: number;
  burj_health: number;
  shots_fired: number;
  total_kills: number;
  hit_ratio: number;
  multi_shots: number;
  max_combo: number;
  destroyed_by_type_json: string;
  upgrades_json: string;
  feedback_emoji: null;
  feedback_note: string | null;
  replay_sha256: string | null;
  replay_omitted_reason: string | null;
  replay_complete_claimed: number;
  replay_verified: 0;
  verified_at: null;
  shared: 0;
  source: string;
}

export interface DiagnosticReportRow {
  report_id: string;
  install_id: string;
  install_ephemeral: number;
  run_id: string | null;
  boot_id: string;
  build: string;
  platform: string;
  input_class: string;
  created_at: number;
  received_at: number;
  app_screen: string;
  trigger: string;
  note: string | null;
  partial: number;
  captured_through_tick: number | null;
  replay_sha256: string | null;
  replay_source: string;
  replay_omitted_reason: string | null;
  events_count: number;
  events_truncated: number;
  sha256: string;
  raw_bytes: number;
  stored_bytes: number;
  r2_key: string;
}

export function projectReplayRow(input: {
  sha256: string;
  rawBytes: number;
  storedBytes: number;
  receivedAt: number;
}): ReplayRow {
  return {
    replay_sha256: input.sha256,
    first_seen_at: input.receivedAt,
    last_referenced_at: input.receivedAt,
    raw_bytes: input.rawBytes,
    stored_bytes: input.storedBytes,
    r2_key: `replays/${input.sha256}.json.gz`,
  };
}

export function projectSessionRow(session: SessionUpload, receivedAt: number): SessionRow {
  const summary = session.summary;
  const installId = session.meta.installId!;
  return {
    run_id: session.meta.runId,
    install_id: installId,
    install_ephemeral: Number(installId.startsWith("eph-")),
    display_name: session.meta.displayName,
    build: session.meta.buildId,
    platform: session.meta.platform,
    input_class: session.meta.inputClass,
    created_at: session.meta.capturedAt,
    received_at: receivedAt,
    outcome: summary.outcome,
    death_cause: summary.deathCause,
    wave_reached: summary.waveReached,
    score: summary.score,
    time_played_ms: summary.timePlayedMs,
    burj_health: summary.burjHealth,
    shots_fired: summary.shotsFired,
    total_kills: summary.totalKills,
    hit_ratio: summary.hitRatio,
    multi_shots: summary.multiShots,
    max_combo: summary.maxCombo,
    destroyed_by_type_json: JSON.stringify(summary.destroyedByType),
    upgrades_json: JSON.stringify(summary.upgrades),
    feedback_emoji: null,
    feedback_note: session.meta.note,
    replay_sha256: session.meta.replaySha256,
    replay_omitted_reason: session.replayOmitted?.reason ?? null,
    replay_complete_claimed: Number(session.meta.replayComplete),
    replay_verified: 0,
    verified_at: null,
    shared: 0,
    source: session.meta.trigger,
  };
}

export function projectDiagnosticReportRow(
  report: ProblemReport,
  input: { sha256: string; rawBytes: number; storedBytes: number; receivedAt: number },
): DiagnosticReportRow {
  const installId = report.meta.installId!;
  return {
    report_id: report.reportId,
    install_id: installId,
    install_ephemeral: Number(installId.startsWith("eph-")),
    run_id: report.meta.runId,
    boot_id: report.meta.bootId,
    build: report.meta.buildId,
    platform: report.meta.platform,
    input_class: report.meta.inputClass,
    created_at: report.meta.capturedAt,
    received_at: input.receivedAt,
    app_screen: report.meta.appScreen,
    trigger: report.meta.trigger,
    note: report.meta.note,
    partial: Number(report.meta.partial),
    captured_through_tick: report.meta.capturedThroughTick,
    replay_sha256: report.meta.replaySha256,
    replay_source: report.meta.replaySource,
    replay_omitted_reason: report.replayOmitted?.reason ?? null,
    events_count: report.events.length,
    events_truncated: Number(report.eventsTruncated),
    sha256: input.sha256,
    raw_bytes: input.rawBytes,
    stored_bytes: input.storedBytes,
    r2_key: `diagnostics/${installId}/${report.reportId}.json.gz`,
  };
}
