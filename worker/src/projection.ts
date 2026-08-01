import type { CaptureEnvelope } from "../../src/capture";

export interface CaptureRow {
  capture_id: string;
  run_id: string | null;
  install_id: string;
  install_ephemeral: number;
  boot_id: string;
  build: string;
  platform: string;
  input_class: string;
  captured_at: number;
  received_at: number;
  trigger: string;
  app_screen: string;
  replay_source: string;
  partial: number;
  captured_through_tick: number | null;
  note: string | null;
  replay_sha256: string | null;
  replay_complete: number;
  replay_omitted_reason: string | null;
  events_count: number;
  events_truncated: number;
  sha256: string;
  raw_bytes: number;
  stored_bytes: number;
  r2_key: string;
}

export interface SessionRow {
  run_id: string;
  capture_id: string;
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
  replay_size: number | null;
  replay_complete_claimed: number;
  replay_verified: 0;
  verified_at: null;
  shared: 0;
  source: string;
}

const encoder = new TextEncoder();

export function isSessionRow(capture: CaptureEnvelope): boolean {
  return capture.meta.partial === false && capture.summary !== null && capture.meta.runId !== null;
}

export function projectCaptureRow(
  capture: CaptureEnvelope,
  input: { sha256: string; rawBytes: number; storedBytes: number; receivedAt: number },
): CaptureRow {
  const installId = capture.meta.installId!;
  return {
    capture_id: capture.captureId,
    run_id: capture.meta.runId,
    install_id: installId,
    install_ephemeral: Number(installId.startsWith("eph-")),
    boot_id: capture.meta.bootId,
    build: capture.meta.buildId,
    platform: capture.meta.platform,
    input_class: capture.meta.inputClass,
    captured_at: capture.meta.capturedAt,
    received_at: input.receivedAt,
    trigger: capture.meta.trigger,
    app_screen: capture.meta.appScreen,
    replay_source: capture.meta.replaySource,
    partial: Number(capture.meta.partial),
    captured_through_tick: capture.meta.capturedThroughTick,
    note: capture.meta.note,
    replay_sha256: capture.meta.replaySha256,
    replay_complete: Number(capture.meta.replayComplete),
    replay_omitted_reason: capture.replayOmitted?.reason ?? null,
    events_count: capture.events.length,
    events_truncated: Number(capture.eventsTruncated),
    sha256: input.sha256,
    raw_bytes: input.rawBytes,
    stored_bytes: input.storedBytes,
    r2_key: `captures/${installId}/${capture.captureId}.json.gz`,
  };
}

export function projectSessionRow(capture: CaptureEnvelope, receivedAt: number): SessionRow | null {
  if (!isSessionRow(capture)) return null;
  const summary = capture.summary!;
  const replaySize = capture.replay === null ? null : encoder.encode(JSON.stringify(capture.replay)).byteLength;
  const installId = capture.meta.installId!;
  return {
    run_id: capture.meta.runId!,
    capture_id: capture.captureId,
    install_id: installId,
    install_ephemeral: Number(installId.startsWith("eph-")),
    display_name: capture.meta.displayName,
    build: capture.meta.buildId,
    platform: capture.meta.platform,
    input_class: capture.meta.inputClass,
    created_at: capture.meta.capturedAt,
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
    feedback_note: capture.meta.note,
    replay_sha256: capture.meta.replaySha256,
    replay_size: replaySize,
    replay_complete_claimed: Number(capture.meta.replayComplete),
    replay_verified: 0,
    verified_at: null,
    shared: 0,
    source: capture.meta.trigger,
  };
}
