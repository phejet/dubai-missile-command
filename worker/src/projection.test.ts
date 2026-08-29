import { describe, expect, it } from "vitest";
import { reportFixture, sessionFixture } from "../../test-fixtures/capture";
import { projectDiagnosticReportRow, projectReplayRow, projectSessionRow } from "./projection";

describe("capture projection", () => {
  it("projects content facts onto replay rows", () => {
    expect(
      projectReplayRow({
        sha256: "a".repeat(64),
        rawBytes: 1_000,
        storedBytes: 500,
        receivedAt: 1_800_000_000_000,
      }),
    ).toEqual({
      replay_sha256: "a".repeat(64),
      first_seen_at: 1_800_000_000_000,
      last_referenced_at: 1_800_000_000_000,
      raw_bytes: 1_000,
      stored_bytes: 500,
      r2_key: `replays/${"a".repeat(64)}.json.gz`,
    });
  });

  it("projects every session column without diagnostics or environment data", () => {
    const session = sessionFixture();
    expect(projectSessionRow(session, 1_800_000_000_000)).toEqual({
      run_id: "run",
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
      destroyed_by_type_json: JSON.stringify(session.summary.destroyedByType),
      upgrades_json: JSON.stringify(session.summary.upgrades),
      feedback_emoji: null,
      feedback_note: "something exploded beautifully",
      replay_sha256: session.meta.replaySha256,
      replay_omitted_reason: null,
      replay_complete_claimed: 1,
      replay_verified: 0,
      verified_at: null,
      shared: 0,
      source: "gameover",
      sha256: null,
      submitter_key_id_hash: null,
      app_flavor: "unknown",
      apple_bundle_id: null,
      apple_environment: null,
    });
  });

  it("projects ephemeral install ownership on sessions", () => {
    const row = projectSessionRow(sessionFixture({ installId: "eph-12345678" }), 1_800_000_000_000);
    expect(row).toMatchObject({ install_id: "eph-12345678", install_ephemeral: 1 });
  });

  it("projects server-authorized submission provenance onto sessions and reports", () => {
    const provenance = {
      appFlavor: "dev" as const,
      bundleId: "com.phejet.dubaicmd.dev",
      appleEnvironment: "development" as const,
    };
    expect(
      projectSessionRow(sessionFixture(), 1_800_000_000_000, {
        sha256: "a".repeat(64),
        keyIdHash: "b".repeat(64),
        provenance,
      }),
    ).toMatchObject({
      app_flavor: "dev",
      apple_bundle_id: "com.phejet.dubaicmd.dev",
      apple_environment: "development",
    });
    expect(
      projectDiagnosticReportRow(reportFixture(), {
        sha256: "a".repeat(64),
        rawBytes: 1_000,
        storedBytes: 500,
        receivedAt: 1_800_000_000_000,
        submitterKeyIdHash: "b".repeat(64),
        provenance,
      }),
    ).toMatchObject({
      app_flavor: "dev",
      apple_bundle_id: "com.phejet.dubaicmd.dev",
      apple_environment: "development",
    });
  });

  it("projects report ownership and stored-body facts", () => {
    const report = reportFixture({ installId: "eph-12345678" });
    expect(
      projectDiagnosticReportRow(report, {
        sha256: "a".repeat(64),
        rawBytes: 1_000,
        storedBytes: 500,
        receivedAt: 1_800_000_000_000,
      }),
    ).toMatchObject({
      report_id: "boot-c0",
      install_id: "eph-12345678",
      install_ephemeral: 1,
      replay_sha256: report.meta.replaySha256,
      events_count: 1,
      sha256: "a".repeat(64),
      r2_key: "diagnostics/eph-12345678/boot-c0.json.gz",
    });
  });
});
