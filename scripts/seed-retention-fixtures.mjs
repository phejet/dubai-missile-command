#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules/.bin/wrangler");
const STAGING = Object.freeze({
  environment: "staging",
  database: "dmc-captures-staging",
  bucket: "dmc-captures-staging",
  config: "worker/wrangler.jsonc",
});
const DAY_MS = 24 * 60 * 60 * 1_000;

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function assertStagingTarget(target, confirmed) {
  if (
    !confirmed ||
    target.environment !== STAGING.environment ||
    target.database !== STAGING.database ||
    target.bucket !== STAGING.bucket ||
    target.config !== STAGING.config
  ) {
    throw new Error("Retention fixtures may target only the explicit Staging D1 database and R2 bucket");
  }
  return target;
}

function sql(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync(wrangler, args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Wrangler failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function d1(sqlText, json = false) {
  return runWrangler([
    "d1",
    "execute",
    STAGING.database,
    "--config",
    STAGING.config,
    "--env",
    STAGING.environment,
    "--remote",
    "--yes",
    ...(json ? ["--json"] : []),
    "--command",
    sqlText,
  ]);
}

function putObject(key, file) {
  runWrangler([
    "r2",
    "object",
    "put",
    `${STAGING.bucket}/${key}`,
    "--config",
    STAGING.config,
    "--env",
    STAGING.environment,
    "--remote",
    "--force",
    "--file",
    file,
    "--content-type",
    "application/json",
    "--content-encoding",
    "gzip",
  ]);
}

function deleteObject(key) {
  runWrangler([
    "r2",
    "object",
    "delete",
    `${STAGING.bucket}/${key}`,
    "--config",
    STAGING.config,
    "--env",
    STAGING.environment,
    "--remote",
    "--force",
  ]);
}

function objectExists(key, outputFile) {
  const result = runWrangler(
    [
      "r2",
      "object",
      "get",
      `${STAGING.bucket}/${key}`,
      "--config",
      STAGING.config,
      "--env",
      STAGING.environment,
      "--remote",
      "--file",
      outputFile,
    ],
    { allowFailure: true },
  );
  return result.status === 0;
}

function replayRecord(namespace, label, sharedReplay = null) {
  const replay = sharedReplay ?? { seed: 1, mode: "classic", actions: [], fixture: `${namespace}-${label}` };
  const raw = Buffer.from(JSON.stringify(replay));
  const sha = createHash("sha256").update(raw).digest("hex");
  const stored = gzipSync(raw);
  return { sha, key: `replays/${sha}.json.gz`, raw, stored };
}

function sessionInsert(row) {
  return `INSERT INTO sessions (
    run_id, install_id, install_ephemeral, display_name, build, platform, input_class,
    created_at, received_at, outcome, death_cause, wave_reached, score, time_played_ms,
    burj_health, shots_fired, total_kills, hit_ratio, multi_shots, max_combo,
    destroyed_by_type_json, upgrades_json, feedback_emoji, feedback_note, replay_sha256,
    replay_omitted_reason, replay_complete_claimed, replay_verified, verified_at, shared, source,
    sha256, submitter_key_id_hash, app_flavor, apple_bundle_id, apple_environment
  ) VALUES (
    ${sql(row.runId)}, ${sql(row.installId)}, 0, 'Retention Pilot', 'retention-proof', 'ios', 'touch',
    ${row.receivedAt}, ${row.receivedAt}, 'burj_destroyed', 'burj_destroyed', 1, ${row.score}, 60000,
    0, 10, 5, 0.5, 0, 1, '{}', '[]', NULL, 'retention fixture note', ${sql(row.replaySha)},
    NULL, 1, 0, NULL, 1, 'manual', NULL, NULL, 'staging', 'com.phejet.dubaicmd.staging', 'production'
  )`;
}

function reportInsert(row) {
  return `INSERT INTO diagnostic_reports (
    report_id, install_id, install_ephemeral, run_id, boot_id, build, platform, input_class,
    created_at, received_at, app_screen, trigger, note, partial, captured_through_tick,
    replay_sha256, replay_source, replay_omitted_reason, events_count, events_truncated,
    sha256, raw_bytes, stored_bytes, r2_key, submitter_key_id_hash,
    app_flavor, apple_bundle_id, apple_environment
  ) VALUES (
    ${sql(row.reportId)}, ${sql(row.installId)}, 0, ${sql(row.runId)}, ${sql(`${row.reportId}-boot`)},
    'retention-proof', 'ios', 'touch', ${row.receivedAt}, ${row.receivedAt}, 'gameover', 'manual',
    'retention fixture diagnostic', 0, 1, ${sql(row.replaySha)}, 'live', NULL, 0, 0,
    ${sql(row.sha)}, ${row.rawBytes}, ${row.storedBytes}, ${sql(row.r2Key)}, NULL,
    'staging', 'com.phejet.dubaicmd.staging', 'production'
  )`;
}

function manifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.digest;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const complete = { ...manifest, digest: manifestDigest(manifest) };
  writeFileSync(path, `${JSON.stringify(complete, null, 2)}\n`, { mode: 0o600 });
  return complete;
}

export function createFixtureManifest(now = Date.now()) {
  const namespace = `retention-proof-${new Date(now).toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
  const sharedReplay = { seed: 7, mode: "classic", actions: [], fixture: `${namespace}-shared` };
  const ages = [89, 91, 269, 271, 364, 366];
  const sessions = ages.map((age, index) => {
    const replay = replayRecord(namespace, `day-${age}`, index < 2 ? sharedReplay : null);
    return {
      age,
      runId: `${namespace}-d${age}`.slice(0, 64),
      installId: `${namespace}-install`.slice(0, 64),
      receivedAt: now - age * DAY_MS,
      score: 1000 + age,
      replay,
      shareId: createHash("sha256").update(`${namespace}-${age}`).digest("hex").slice(0, 16),
    };
  });
  const diagnosticRaw = Buffer.from(JSON.stringify({ fixture: namespace, note: "diagnostic" }));
  const diagnosticStored = gzipSync(diagnosticRaw);
  const report = {
    reportId: `${namespace}-report`.slice(0, 64),
    installId: sessions[0].installId,
    runId: sessions[0].runId,
    receivedAt: now - 91 * DAY_MS,
    replaySha: sessions[0].replay.sha,
    sha: createHash("sha256").update(diagnosticRaw).digest("hex"),
    rawBytes: diagnosticRaw.length,
    storedBytes: diagnosticStored.length,
    r2Key: `diagnostics/${namespace}/${namespace}-report.json.gz`,
    stored: diagnosticStored,
  };
  return {
    version: 1,
    target: STAGING,
    namespace,
    createdAt: new Date(now).toISOString(),
    sessions: sessions.map((row) => ({
      age: row.age,
      runId: row.runId,
      installId: row.installId,
      receivedAt: row.receivedAt,
      score: row.score,
      replaySha: row.replay.sha,
      replayKey: row.replay.key,
      shareId: row.shareId,
    })),
    report: {
      reportId: report.reportId,
      installId: report.installId,
      runId: report.runId,
      receivedAt: report.receivedAt,
      replaySha: report.replaySha,
      sha: report.sha,
      rawBytes: report.rawBytes,
      storedBytes: report.storedBytes,
      r2Key: report.r2Key,
    },
    deletionJob: {
      jobId: `${namespace}-job`.slice(0, 64),
      referenceHash: createHash("sha256").update(`fixture\0${namespace}`).digest("hex"),
      planDigest: createHash("sha256").update(`plan\0${namespace}`).digest("hex"),
    },
    objects: [
      ...new Map(
        sessions.map((row) => [
          row.replay.key,
          {
            key: row.replay.key,
            sha: row.replay.sha,
            rawBytes: row.replay.raw.length,
            storedBytes: row.replay.stored.length,
            bytes: row.replay.stored,
          },
        ]),
      ).values(),
      { key: report.r2Key, bytes: report.stored },
    ],
  };
}

function seed(manifestPath) {
  const generated = createFixtureManifest();
  const serializable = {
    ...generated,
    objects: generated.objects.map((object) => {
      const clean = { ...object };
      delete clean.bytes;
      return clean;
    }),
  };
  const manifest = writeManifest(manifestPath, serializable);
  const temporary = mkdtempSync(resolve(tmpdir(), "dmc-retention-seed-"));
  try {
    for (const object of generated.objects) {
      const file = resolve(temporary, `${createHash("sha256").update(object.key).digest("hex")}.json.gz`);
      writeFileSync(file, object.bytes);
      putObject(object.key, file);
    }
    const uniqueReplays = new Map(
      generated.objects.filter((object) => object.sha).map((object) => [object.sha, object]),
    );
    const statements = [];
    for (const replay of uniqueReplays.values()) {
      const references = generated.sessions.filter((row) => row.replaySha === replay.sha);
      const first = Math.min(...references.map((row) => row.receivedAt));
      const last = Math.max(...references.map((row) => row.receivedAt));
      statements.push(
        `INSERT INTO replays (replay_sha256, first_seen_at, last_referenced_at, raw_bytes, stored_bytes, r2_key)
         VALUES (${sql(replay.sha)}, ${first}, ${last}, ${replay.rawBytes}, ${replay.storedBytes}, ${sql(replay.key)})`,
      );
    }
    for (const row of generated.sessions) {
      statements.push(
        sessionInsert({
          runId: row.runId,
          installId: row.installId,
          receivedAt: row.receivedAt,
          score: row.score,
          replaySha: row.replaySha,
        }),
      );
      statements.push(
        `INSERT INTO shared_runs (share_id, run_id, created_at) VALUES (${sql(row.shareId)}, ${sql(row.runId)}, ${row.receivedAt})`,
      );
    }
    statements.push(reportInsert(generated.report));
    statements.push(
      `INSERT INTO operator_deletions (
         job_id, scope, reference_hash, plan_digest, state, blocked_stage, target_counts_json,
         object_manifest_json, created_at, updated_at, last_error
       ) VALUES (
         ${sql(generated.deletionJob.jobId)}, 'run', ${sql(generated.deletionJob.referenceHash)},
         ${sql(generated.deletionJob.planDigest)}, 'complete', NULL, '{}', NULL, ${Date.now()}, ${Date.now()}, NULL
       )`,
    );
    d1(statements.join(";\n"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, manifest: manifestPath, namespace: manifest.namespace }, null, 2)}\n`,
  );
}

function findRemaining(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRemaining(item);
      if (found !== undefined) return found;
    }
  } else if (value && typeof value === "object") {
    if (typeof value.remaining === "number") return value.remaining;
    for (const item of Object.values(value)) {
      const found = findRemaining(item);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function cleanup(manifestPath) {
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertStagingTarget(manifest.target, true);
  if (!/^retention-proof-[a-zA-Z0-9-]+$/.test(manifest.namespace)) throw new Error("Invalid fixture namespace");
  if (manifest.digest !== manifestDigest(manifest)) throw new Error("Fixture manifest digest does not match");
  const runIds = manifest.sessions.map((row) => row.runId);
  const reportIds = [manifest.report.reportId];
  const replayShas = [...new Set(manifest.sessions.map((row) => row.replaySha))];
  const inList = (values) => values.map(sql).join(", ");
  d1(
    [
      `DELETE FROM shared_runs WHERE run_id IN (${inList(runIds)})`,
      `DELETE FROM diagnostic_reports WHERE report_id IN (${inList(reportIds)})`,
      `DELETE FROM sessions WHERE run_id IN (${inList(runIds)})`,
      `DELETE FROM replays WHERE replay_sha256 IN (${inList(replayShas)})
       AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.replay_sha256 = replays.replay_sha256)
       AND NOT EXISTS (SELECT 1 FROM diagnostic_reports WHERE diagnostic_reports.replay_sha256 = replays.replay_sha256)`,
      `DELETE FROM operator_deletions WHERE job_id = ${sql(manifest.deletionJob.jobId)}`,
    ].join(";\n"),
  );
  for (const object of manifest.objects) deleteObject(object.key);
  const verification = d1(
    `SELECT
       (SELECT COUNT(*) FROM sessions WHERE run_id IN (${inList(runIds)})) +
       (SELECT COUNT(*) FROM diagnostic_reports WHERE report_id IN (${inList(reportIds)})) +
       (SELECT COUNT(*) FROM shared_runs WHERE run_id IN (${inList(runIds)})) +
       (SELECT COUNT(*) FROM operator_deletions WHERE job_id = ${sql(manifest.deletionJob.jobId)}) AS remaining`,
    true,
  );
  const remaining = findRemaining(JSON.parse(verification.stdout));
  if (remaining !== 0) throw new Error(`Fixture D1 cleanup left ${remaining ?? "unknown"} rows`);
  const temporary = mkdtempSync(resolve(tmpdir(), "dmc-retention-verify-"));
  try {
    for (const object of manifest.objects) {
      if (objectExists(object.key, resolve(temporary, basename(object.key)))) {
        throw new Error(`Fixture R2 cleanup left object ${object.key}`);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, cleaned: manifest.namespace }, null, 2)}\n`);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/seed-retention-fixtures.mjs seed --confirm-staging [--out <manifest>]",
    "  node scripts/seed-retention-fixtures.mjs cleanup --confirm-staging --manifest <manifest>",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return process.stdout.write(`${usage()}\n`);
  assertStagingTarget(STAGING, args.includes("--confirm-staging"));
  const command = args[0];
  if (command === "seed") {
    const out = resolve(option(args, "--out") ?? resolve(root, "operator-results", `retention-${Date.now()}.json`));
    return seed(out);
  }
  if (command === "cleanup") {
    const manifest = option(args, "--manifest");
    if (!manifest) throw new Error("cleanup requires --manifest");
    return cleanup(resolve(manifest));
  }
  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
