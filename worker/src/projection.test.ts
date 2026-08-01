import { describe, expect, it } from "vitest";
import { captureFixture } from "../../test-fixtures/capture";
import { isSessionRow, projectCaptureRow, projectSessionRow } from "./projection";

describe("capture projection", () => {
  it("projects every capture and session column from its declared source", () => {
    const capture = captureFixture();
    const captureRow = projectCaptureRow(capture, {
      sha256: "a".repeat(64),
      rawBytes: 1_000,
      storedBytes: 500,
      receivedAt: 1_800_000_000_000,
    });
    expect(captureRow).toEqual({
      capture_id: "boot-c0",
      run_id: "run",
      install_id: "12345678-abcd",
      install_ephemeral: 0,
      boot_id: "boot",
      build: "build+dirty",
      platform: "web",
      input_class: "mouse",
      captured_at: 1_700_000_000_000,
      received_at: 1_800_000_000_000,
      trigger: "gameover",
      app_screen: "gameover",
      replay_source: "last-completed",
      partial: 0,
      captured_through_tick: 10,
      note: "something exploded beautifully",
      replay_sha256: "b".repeat(64),
      replay_complete: 1,
      replay_omitted_reason: null,
      events_count: 1,
      events_truncated: 0,
      sha256: "a".repeat(64),
      raw_bytes: 1_000,
      stored_bytes: 500,
      r2_key: "captures/12345678-abcd/boot-c0.json.gz",
    });

    expect(projectSessionRow(capture, 1_800_000_000_000)).toEqual({
      run_id: "run",
      capture_id: "boot-c0",
      install_id: "12345678-abcd",
      install_ephemeral: 0,
      display_name: "Pilot",
      build: "build+dirty",
      platform: "web",
      input_class: "mouse",
      created_at: 1_700_000_000_000,
      received_at: 1_800_000_000_000,
      outcome: "burj_destroyed",
      death_cause: "burj_destroyed",
      wave_reached: 4,
      score: 900,
      time_played_ms: 12_345,
      burj_health: 0,
      shots_fired: 10,
      total_kills: 5,
      hit_ratio: 0.5,
      multi_shots: 4,
      max_combo: 8,
      destroyed_by_type_json: JSON.stringify(capture.summary!.destroyedByType),
      upgrades_json: JSON.stringify(capture.summary!.upgrades),
      feedback_emoji: null,
      feedback_note: "something exploded beautifully",
      replay_sha256: "b".repeat(64),
      replay_size: new TextEncoder().encode(JSON.stringify(capture.replay)).byteLength,
      replay_complete_claimed: 1,
      replay_verified: 0,
      verified_at: null,
      shared: 0,
      source: "gameover",
    });
  });

  it("creates sessions only for complete captures with a summary and run", () => {
    const partial = captureFixture();
    partial.meta.partial = true;
    partial.summary!.outcome = "in_progress";
    expect(isSessionRow(partial)).toBe(false);

    const noSummary = captureFixture();
    noSummary.summary = null;
    expect(isSessionRow(noSummary)).toBe(false);

    const noRun = captureFixture({ runId: null });
    expect(isSessionRow(noRun)).toBe(false);
  });

  it("marks ephemeral installs on both projections without laundering replay claims", () => {
    const capture = captureFixture({ installId: "eph-12345678" });
    expect(
      projectCaptureRow(capture, { sha256: "a".repeat(64), rawBytes: 1, storedBytes: 1, receivedAt: 2 }),
    ).toMatchObject({ install_ephemeral: 1 });
    expect(projectSessionRow(capture, 2)).toMatchObject({ install_ephemeral: 1, replay_verified: 0 });
  });
});
