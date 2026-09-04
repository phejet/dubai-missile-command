#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeTelemetry, digest } from "./telemetry/analysis.mjs";
import { publicComparisonSpec, validateComparisonSpec } from "./telemetry/comparison-schema.mjs";
import { SAFE_ARTIFACT_NAME, SAFE_CAPTURE_ID } from "./telemetry/constants.mjs";
import { cleanupExpiredPrivate, cleanupPrivate } from "./telemetry/private-artifacts.mjs";

export { cleanupExpiredPrivate, cleanupPrivate } from "./telemetry/private-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultResultsRoot = resolve(root, "telemetry-results");
const queryPath = resolve(root, "scripts/telemetry/query.sql");
const wranglerPath = resolve(root, "node_modules/.bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const STAGING_DATABASE = "dmc-captures-staging";
const PRIVATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ANSI_ESCAPE = String.fromCharCode(27);

function usage() {
  return [
    "Usage:",
    "  npm run telemetry:analyze -- --env staging --comparison <file> [--out telemetry-results/<name>]",
    "  npm run telemetry:analyze -- --cleanup-private <artifact-directory-name>",
    "  npm run telemetry:analyze -- --cleanup-expired-private",
    "",
    "Only the checked-in summary SELECT can reach the explicit Staging D1 database.",
  ].join("\n");
}

export function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--cleanup-expired-private") result.cleanupExpiredPrivate = true;
    else if (["--env", "--comparison", "--out", "--cleanup-private"].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[key] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const cleanupModes = Number(Boolean(result.cleanupPrivate)) + Number(Boolean(result.cleanupExpiredPrivate));
  if (cleanupModes > 1) throw new Error("Choose one cleanup mode");
  if (cleanupModes && (result.env || result.comparison || result.out)) {
    throw new Error("Cleanup modes cannot be combined with analysis arguments");
  }
  return result;
}

function sqlLiteral(value) {
  if (!SAFE_CAPTURE_ID.test(value)) throw new Error(`Unsafe build ID: ${value}`);
  return `'${value.replaceAll("'", "''")}'`;
}

export function assertReadOnlyQuery(sql) {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed)) throw new Error("Telemetry query must begin with SELECT");
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM)\b/i.test(trimmed)) {
    throw new Error("Telemetry query contains a mutating or administrative statement");
  }
  const semicolons = [...trimmed].filter((character) => character === ";").length;
  if (semicolons > 1 || (semicolons === 1 && !trimmed.endsWith(";"))) {
    throw new Error("Telemetry query must contain exactly one SELECT statement");
  }
}

export function renderQuery(template, spec) {
  const replacements = {
    "{{RECEIVED_FROM_MS}}": String(spec.receivedFromMs),
    "{{RECEIVED_TO_MS}}": String(spec.receivedToMs),
    "{{BUILD_LIST}}": [...spec.baselineBuilds, ...spec.candidateBuilds].map(sqlLiteral).join(", "),
  };
  let query = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    const count = query.split(placeholder).length - 1;
    if (count !== 1) throw new Error(`Telemetry query must contain ${placeholder} exactly once`);
    query = query.replace(placeholder, () => value);
  }
  if (query.includes("{{")) throw new Error("Telemetry query contains an unknown placeholder");
  assertReadOnlyQuery(query);
  return query;
}

export function validateWranglerResult(value) {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("Wrangler must return exactly one query result");
  const result = value[0];
  if (!result || typeof result !== "object" || result.success !== true || !Array.isArray(result.results)) {
    throw new Error("Wrangler returned an unsuccessful or malformed query result");
  }
  const changes = Number(result.meta?.changes ?? NaN);
  const rowsWritten = Number(result.meta?.rows_written ?? NaN);
  const rowsRead = Number(result.meta?.rows_read ?? NaN);
  if (changes !== 0 || rowsWritten !== 0) throw new Error("Telemetry SELECT reported database writes");
  if (!Number.isFinite(rowsRead) || rowsRead < 0) throw new Error("Wrangler did not report a valid rows_read count");
  return { rows: result.results, meta: { changes, rowsWritten, rowsRead } };
}

export function sanitizeWranglerFailure(result) {
  const source = [result?.stderr, result?.error?.message].filter((value) => typeof value === "string").join("\n");
  return source
    .replaceAll(ANSI_ESCAPE, "")
    .replace(/\[[0-9;]*m/g, "")
    .replace(/\b(authorization|bearer|token|secret)\b\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .replaceAll(root, "<repo>")
    .trim()
    .slice(0, 1200);
}

export function queryStaging(query, spawn = spawnSync) {
  const result = spawn(
    wranglerPath,
    [
      "d1",
      "execute",
      STAGING_DATABASE,
      "--config",
      "worker/wrangler.jsonc",
      "--env",
      "staging",
      "--remote",
      "--json",
      "--command",
      query,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = sanitizeWranglerFailure(result);
    throw new Error(
      `Staging telemetry query failed with exit ${result.status ?? "unknown"}${detail ? `:\n${detail}` : ": no diagnostics"}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Wrangler stdout was not exact JSON; refusing to interpret mixed logs as telemetry");
  }
  return validateWranglerResult(parsed);
}

function oneLine(value) {
  return String(value)
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMetric(value) {
  return value === null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatPercent(value) {
  return value === null ? "—" : `${formatMetric(value * 100)}%`;
}

function formatPercentagePointInterval(interval) {
  return interval ? `[${formatMetric(interval.lower * 100)}, ${formatMetric(interval.upper * 100)}]` : "—";
}

export function renderSummaryMarkdown(summary) {
  const baseline = summary.cohorts.baseline;
  const candidate = summary.cohorts.candidate;
  const primary = [
    "waveReached",
    "score",
    "timePlayedMs",
    "totalKills",
    "killsPerMinute",
    "shotsFired",
    "displayHitRatio",
  ];
  const lines = [
    `# ${oneLine(summary.comparison.id)}`,
    "",
    oneLine(summary.comparison.question),
    "",
    `**Confidence:** \`${summary.confidence}\`  `,
    `**Rows:** ${summary.selectedRows} selected  `,
    `**Calculation digest:** \`${summary.calculationDigest}\``,
    "",
    "## Declared context",
    "",
    "**Known changes**",
    "",
    ...summary.comparison.knownChanges.map((item) => `- ${oneLine(item)}`),
    "",
    "**Known confounders**",
    "",
    ...(summary.comparison.knownConfounders.length
      ? summary.comparison.knownConfounders.map((item) => `- ${oneLine(item)}`)
      : ["- None declared."]),
    "",
    "## Cohorts",
    "",
    "| Cohort | Builds | Sessions | Installs |",
    "| --- | --- | ---: | ---: |",
    `| Baseline | ${baseline.builds.map(oneLine).join(", ")} | ${baseline.sessions} | ${baseline.installs} |`,
    `| Candidate | ${candidate.builds.map(oneLine).join(", ")} | ${candidate.sessions} | ${candidate.installs} |`,
    "",
    "## Primary metrics",
    "",
    "| Metric | Baseline install median | Candidate install median | Absolute Δ | Relative Δ |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const name of primary) {
    const metric = summary.comparisons.metrics[name];
    lines.push(
      `| ${name} | ${formatMetric(metric.baseline.installWeighted.median)} | ${formatMetric(metric.candidate.installWeighted.median)} | ${formatMetric(metric.absoluteDelta)} | ${metric.relativeDelta === null ? "—" : `${formatMetric(metric.relativeDelta * 100)}%`} |`,
    );
  }
  lines.push(
    "",
    "## Outcomes",
    "",
    "| Outcome | Baseline pooled | Candidate pooled | Pooled pp Δ | Install-weighted pp Δ | Install-cluster 90% interval |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [outcome, comparison] of Object.entries(summary.comparisons.outcomes)) {
    lines.push(
      `| ${outcome} | ${formatPercent(comparison.pooled.baseline.rate)} | ${formatPercent(comparison.pooled.candidate.rate)} | ${comparison.pooled.percentagePointDelta === null ? "—" : formatMetric(comparison.pooled.percentagePointDelta * 100)} | ${comparison.installWeighted.percentagePointDelta === null ? "—" : formatMetric(comparison.installWeighted.percentagePointDelta * 100)} | ${formatPercentagePointInterval(comparison.installWeighted.clusterInterval90)} |`,
    );
  }
  lines.push("", "## Upgrade adoption", "");
  const upgrades = Object.entries(summary.comparisons.upgrades);
  if (upgrades.length === 0) lines.push("No purchased upgrades recorded.");
  else {
    lines.push(
      "| Upgrade | Baseline pooled | Candidate pooled | Pooled pp Δ | Install-weighted pp Δ | Install-cluster 90% interval |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const [upgrade, comparison] of upgrades) {
      lines.push(
        `| ${oneLine(upgrade)} | ${formatPercent(comparison.adoption.pooled.baseline.rate)} | ${formatPercent(comparison.adoption.pooled.candidate.rate)} | ${comparison.adoption.pooled.percentagePointDelta === null ? "—" : formatMetric(comparison.adoption.pooled.percentagePointDelta * 100)} | ${comparison.adoption.installWeighted.percentagePointDelta === null ? "—" : formatMetric(comparison.adoption.installWeighted.percentagePointDelta * 100)} | ${formatPercentagePointInterval(comparison.adoption.installWeighted.clusterInterval90)} |`,
      );
    }
  }
  lines.push("", "## Practical signals", "");
  if (summary.practicalSignals.length === 0) lines.push("None. The evidence or practical threshold did not qualify.");
  else {
    for (const signal of summary.practicalSignals) {
      lines.push(`- ${oneLine(signal.metric ?? signal.outcome ?? signal.upgrade)}: ${signal.direction}`);
    }
  }
  lines.push("", "## Warnings", "");
  if (summary.warnings.length === 0) lines.push("None.");
  else
    for (const warning of summary.warnings) lines.push(`- **${oneLine(warning.code)}:** ${oneLine(warning.message)}`);
  lines.push("", "## Exclusions", "");
  const exclusions = Object.entries(summary.excludedRows);
  if (exclusions.length === 0) lines.push("None.");
  else for (const [reason, count] of exclusions) lines.push(`- ${oneLine(reason)}: ${count}`);
  lines.push("", "## Capture quality", "");
  lines.push(
    `- Baseline replay availability: ${formatMetric(baseline.captureQuality.replayAvailable.rate * 100)}%`,
    `- Candidate replay availability: ${formatMetric(candidate.captureQuality.replayAvailable.rate * 100)}%`,
    `- Baseline feedback response: ${formatMetric(baseline.feedback.responseRate * 100)}%`,
    `- Candidate feedback response: ${formatMetric(candidate.feedback.responseRate * 100)}%`,
    "",
    "Generated from compact Staging summaries. This is exploratory playtest evidence, not a causal or competitive result.",
    "",
  );
  return lines.join("\n");
}

export function safeResultsPath(resultsRoot, requested) {
  const target = resolve(root, requested);
  const relation = relative(resultsRoot, target);
  if (
    !relation ||
    relation.startsWith("..") ||
    isAbsolute(relation) ||
    relation.includes("/") ||
    relation.includes("\\") ||
    !SAFE_ARTIFACT_NAME.test(relation)
  ) {
    throw new Error("Output must be one safe child directory of telemetry-results");
  }
  return target;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertPublicArtifacts(publicArtifacts, rawRows) {
  const { markdown, ...structuredArtifacts } = publicArtifacts;
  if (typeof markdown !== "string") throw new Error("Public Markdown artifact is missing");
  const serialized = JSON.stringify(structuredArtifacts);
  const forbiddenFields = [
    "run_id",
    "install_id",
    "display_name",
    "feedback_note",
    "submitter_key_id_hash",
    "apple_bundle_id",
    "replay_sha256",
    "r2_key",
    "runId",
    "installId",
    "displayName",
    "feedbackNote",
    "submitterKeyIdHash",
    "appleBundleId",
    "replaySha256",
    "r2Key",
  ];
  for (const field of forbiddenFields) {
    if (serialized.includes(`"${field}"`) || markdown.includes(field)) {
      throw new Error(`Public artifact contains forbidden field ${field}`);
    }
  }
  let privateValuesChecked = 0;
  for (const row of rawRows) {
    for (const field of ["run_id", "install_id"]) {
      const value = row?.[field];
      if (typeof value === "string" && value.length) {
        privateValuesChecked += 1;
        if (serialized.includes(value) || markdown.includes(value)) {
          throw new Error(`Public artifact contains a private ${field} value`);
        }
      }
    }
  }
  return {
    passed: true,
    checkedFormats: ["structured-json", "raw-markdown"],
    forbiddenFieldsChecked: forbiddenFields.length,
    privateValuesChecked,
  };
}

export function buildArtifacts({
  analysis,
  spec,
  query,
  queryMeta,
  generatedAt = new Date(),
  toolBuild = "unknown",
  rawRows,
}) {
  const cleanupDueAt = new Date(generatedAt.getTime() + PRIVATE_RETENTION_MS).toISOString();
  const manifest = {
    schema: 1,
    environment: "staging",
    generatedAt: generatedAt.toISOString(),
    toolBuild,
    comparison: publicComparisonSpec(spec),
    query: queryMeta,
    queryDigest: digest(query),
    dataDigest: analysis.dataDigest,
    calculationDigest: analysis.calculationDigest,
    candidateDigest: analysis.candidateDigest,
  };
  const verificationBase = {
    schema: 1,
    comparisonId: spec.id,
    queryReportedZeroWrites: queryMeta.changes === 0 && queryMeta.rowsWritten === 0,
    queryDigest: digest(query),
    rowsValidated:
      analysis.summary.selectedRows + Object.values(analysis.summary.excludedRows).reduce((a, b) => a + b, 0),
    cleanupDueAt,
  };
  const candidatesPrivate = {
    schema: 1,
    comparisonId: spec.id,
    generatedAt: generatedAt.toISOString(),
    cleanupDueAt,
    calculationDigest: analysis.calculationDigest,
    candidates: analysis.candidates.map((candidate) => ({
      ...candidate,
      receivedAt: new Date(candidate.receivedAt).toISOString(),
    })),
    selectionAudit: analysis.selectionAudit,
  };
  const markdown = renderSummaryMarkdown(analysis.summary);
  const privacy = assertPublicArtifacts(
    { manifest, summary: analysis.summary, verification: verificationBase, markdown },
    rawRows,
  );
  const verification = { ...verificationBase, privacy };
  return { manifest, summary: analysis.summary, verification, candidatesPrivate, markdown };
}

export async function writeArtifacts(output, artifacts) {
  if (await exists(output)) throw new Error(`Output already exists: ${relative(root, output)}`);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const temporary = resolve(parent, `.${basename(output)}.tmp-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    await Promise.all([
      writeFile(resolve(temporary, "manifest.json"), `${JSON.stringify(artifacts.manifest, null, 2)}\n`, {
        mode: 0o600,
      }),
      writeFile(resolve(temporary, "summary.json"), `${JSON.stringify(artifacts.summary, null, 2)}\n`, {
        mode: 0o600,
      }),
      writeFile(resolve(temporary, "summary.md"), artifacts.markdown, { mode: 0o600 }),
      writeFile(resolve(temporary, "verification.json"), `${JSON.stringify(artifacts.verification, null, 2)}\n`, {
        mode: 0o600,
      }),
      writeFile(
        resolve(temporary, "candidates.private.json"),
        `${JSON.stringify(artifacts.candidatesPrivate, null, 2)}\n`,
        { mode: 0o600 },
      ),
    ]);
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function currentToolBuild(spawn = spawnSync) {
  const head = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  const status = spawn("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (head.status !== 0 || status.status !== 0) return "unknown";
  return `${head.stdout.trim()}${status.stdout.trim() ? "+dirty" : ""}`;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  const resultsRoot = defaultResultsRoot;
  if (options.cleanupPrivate) {
    const removed = await cleanupPrivate(resultsRoot, options.cleanupPrivate);
    console.log(
      removed
        ? `Removed private candidates for artifact ${options.cleanupPrivate}`
        : "No private candidate artifact found",
    );
    return;
  }
  if (options.cleanupExpiredPrivate) {
    const removed = await cleanupExpiredPrivate(resultsRoot);
    console.log(`Removed ${removed.length} expired private candidate artifact${removed.length === 1 ? "" : "s"}`);
    return;
  }
  if (options.env !== "staging") throw new Error("RM-06 v1 accepts only --env staging");
  if (!options.comparison) throw new Error("--comparison is required");
  const comparisonPath = resolve(root, options.comparison);
  const spec = validateComparisonSpec(JSON.parse(await readFile(comparisonPath, "utf8")));
  const output = options.out ? safeResultsPath(resultsRoot, options.out) : resolve(resultsRoot, spec.id);
  const template = await readFile(queryPath, "utf8");
  const query = renderQuery(template, spec);
  const queried = queryStaging(query);
  const analysis = analyzeTelemetry(queried.rows, spec);
  const artifacts = buildArtifacts({
    analysis,
    spec,
    query,
    queryMeta: queried.meta,
    toolBuild: currentToolBuild(),
    rawRows: queried.rows,
  });
  await writeArtifacts(output, artifacts);
  console.log(`Telemetry report written to ${relative(root, output)}`);
  console.log(`Confidence: ${analysis.summary.confidence}`);
  console.log(
    `Cohorts: ${analysis.summary.cohorts.baseline.sessions}/${analysis.summary.cohorts.baseline.installs} baseline sessions/installs; ${analysis.summary.cohorts.candidate.sessions}/${analysis.summary.cohorts.candidate.installs} candidate`,
  );
  console.log(`Warnings: ${analysis.summary.warnings.map((warning) => warning.code).join(", ") || "none"}`);
  console.log(`Calculation digest: ${analysis.calculationDigest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
