import { createHash } from "node:crypto";
import {
  APP_FLAVORS,
  APPLE_ENVIRONMENTS,
  INPUT_CLASSES,
  RUN_FEEDBACK_EMOJIS,
  SAFE_CAPTURE_ID,
  SAFE_INSTALL_ID,
  SESSION_OUTCOMES,
  SESSION_SOURCES,
  THREAT_TYPES,
} from "./constants.mjs";

const OUTCOME_SET = new Set(SESSION_OUTCOMES);
const APP_FLAVOR_SET = new Set(APP_FLAVORS);
const APPLE_ENVIRONMENT_SET = new Set(APPLE_ENVIRONMENTS);
const INPUT_CLASS_SET = new Set(INPUT_CLASSES);
const SOURCE_SET = new Set(SESSION_SOURCES);
const FEEDBACK_SET = new Set(RUN_FEEDBACK_EMOJIS);
const THREAT_TYPE_SET = new Set(THREAT_TYPES);

export const ANALYSIS_POLICY = Object.freeze({
  confidence: Object.freeze({
    smokeMinimum: Object.freeze({ installs: 3, sessions: 10 }),
    directionalMinimum: Object.freeze({ installs: 5, sessions: 20 }),
  }),
  clusterBootstrap: Object.freeze({ unit: "install", iterations: 1000, interval: 0.9 }),
});

export const PRACTICAL_THRESHOLDS = Object.freeze({
  waveReached: { kind: "absolute", value: 1 },
  score: { kind: "relative", value: 0.15 },
  timePlayedMs: { kind: "relative", value: 0.15 },
  totalKills: { kind: "relative", value: 0.15 },
  killsPerMinute: { kind: "relative", value: 0.15 },
  shotsFired: { kind: "relative", value: 0.15 },
  displayHitRatio: { kind: "absolute", value: 0.1 },
  outcomeRate: { kind: "absolute", value: 0.1 },
  upgradeAdoption: { kind: "absolute", value: 0.2 },
});

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function string(value, label, { nullable = false, pattern, values } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  if (pattern && !pattern.test(value)) throw new Error(`${label} has an invalid value`);
  if (values && !values.has(value)) throw new Error(`${label} has an unsupported value`);
  return value;
}

function number(value, label, { integer = false, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a finite number from 0 to ${max}`);
  }
  if (integer && !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function binary(value, label) {
  if (value !== 0 && value !== 1) throw new Error(`${label} must be 0 or 1`);
  return value === 1;
}

function parseJson(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be JSON text`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function destroyedByType(value, label) {
  const parsed = record(parseJson(value, label), label);
  const result = {};
  for (const [key, count] of Object.entries(parsed)) {
    if (!THREAT_TYPE_SET.has(key)) throw new Error(`${label} has an unsupported threat key`);
    result[key] = number(count, `${label}.${key}`, { integer: true });
  }
  return result;
}

function upgradeTimeline(value, label) {
  const parsed = parseJson(value, label);
  if (!Array.isArray(parsed)) throw new Error(`${label} must contain an array`);
  return parsed.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    if (!Array.isArray(item.bought)) throw new Error(`${label}[${index}].bought must be an array`);
    return {
      tick: number(item.tick, `${label}[${index}].tick`, { integer: true }),
      wave: number(item.wave, `${label}[${index}].wave`, { integer: true }),
      bought: item.bought.map((id, boughtIndex) =>
        string(id, `${label}[${index}].bought[${boughtIndex}]`, { pattern: SAFE_CAPTURE_ID }),
      ),
    };
  });
}

export function validateTelemetryRow(input, index = 0) {
  const row = record(input, `row[${index}]`);
  const prefix = `row[${index}]`;
  const deathCause = row.death_cause === null ? null : string(row.death_cause, `${prefix}.death_cause`);
  const feedbackEmoji = row.feedback_emoji === null ? null : string(row.feedback_emoji, `${prefix}.feedback_emoji`);
  if (feedbackEmoji !== null && !FEEDBACK_SET.has(feedbackEmoji))
    throw new Error(`${prefix}.feedback_emoji is unsupported`);
  const replayOmittedReason =
    row.replay_omitted_reason === null
      ? null
      : string(row.replay_omitted_reason, `${prefix}.replay_omitted_reason`, {
          values: new Set(["size", "unavailable"]),
        });
  const appleEnvironment =
    row.apple_environment === null
      ? null
      : string(row.apple_environment, `${prefix}.apple_environment`, { values: APPLE_ENVIRONMENT_SET });

  return {
    runId: string(row.run_id, `${prefix}.run_id`, { pattern: SAFE_CAPTURE_ID }),
    installId: string(row.install_id, `${prefix}.install_id`, { pattern: SAFE_INSTALL_ID }),
    installEphemeral: binary(row.install_ephemeral, `${prefix}.install_ephemeral`),
    receivedAt: number(row.received_at, `${prefix}.received_at`, { integer: true }),
    build: string(row.build, `${prefix}.build`, { pattern: SAFE_CAPTURE_ID }),
    appFlavor: string(row.app_flavor, `${prefix}.app_flavor`, { values: APP_FLAVOR_SET }),
    appleEnvironment,
    platform: string(row.platform, `${prefix}.platform`),
    inputClass: string(row.input_class, `${prefix}.input_class`, { values: INPUT_CLASS_SET }),
    source: string(row.source, `${prefix}.source`, { values: SOURCE_SET }),
    outcome: string(row.outcome, `${prefix}.outcome`, { values: OUTCOME_SET }),
    deathCause,
    waveReached: number(row.wave_reached, `${prefix}.wave_reached`, { integer: true }),
    score: number(row.score, `${prefix}.score`, { integer: true }),
    timePlayedMs: number(row.time_played_ms, `${prefix}.time_played_ms`, { integer: true }),
    burjHealth: number(row.burj_health, `${prefix}.burj_health`),
    shotsFired: number(row.shots_fired, `${prefix}.shots_fired`, { integer: true }),
    totalKills: number(row.total_kills, `${prefix}.total_kills`, { integer: true }),
    displayHitRatio: number(row.hit_ratio, `${prefix}.hit_ratio`, { max: 1 }),
    multiShots: number(row.multi_shots, `${prefix}.multi_shots`, { integer: true }),
    maxCombo: number(row.max_combo, `${prefix}.max_combo`, { integer: true }),
    destroyedByType: destroyedByType(row.destroyed_by_type_json, `${prefix}.destroyed_by_type_json`),
    upgrades: upgradeTimeline(row.upgrades_json, `${prefix}.upgrades_json`),
    feedbackEmoji,
    replayPresent: binary(row.replay_present, `${prefix}.replay_present`),
    replayOmittedReason,
    replayCompleteClaimed: binary(row.replay_complete_claimed, `${prefix}.replay_complete_claimed`),
    replayVerified: binary(row.replay_verified, `${prefix}.replay_verified`),
    shared: binary(row.shared, `${prefix}.shared`),
  };
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

export function selectTelemetryRows(rawRows, spec) {
  if (!Array.isArray(rawRows)) throw new Error("Wrangler result rows must be an array");
  const declaredBuilds = new Set([...spec.baselineBuilds, ...spec.candidateBuilds]);
  const excluded = {};
  const rows = [];
  for (const [index, raw] of rawRows.entries()) {
    const row = validateTelemetryRow(raw, index);
    if (!declaredBuilds.has(row.build)) throw new Error(`row[${index}].build was not declared by the comparison`);
    if (row.receivedAt < spec.receivedFromMs || row.receivedAt >= spec.receivedToMs) {
      throw new Error(`row[${index}].received_at is outside the comparison window`);
    }
    let reason = null;
    if (!spec.filters.appFlavors.includes(row.appFlavor)) reason = "app_flavor";
    else if (!spec.filters.platforms.includes(row.platform)) reason = "platform";
    else if (!spec.filters.inputClasses.includes(row.inputClass)) reason = "input_class";
    else if (!spec.filters.sources.includes(row.source)) reason = "source";
    else if (spec.filters.excludeEphemeral && row.installEphemeral) reason = "ephemeral";
    else if (spec.filters.excludeUnknownProvenance && row.appFlavor === "unknown") reason = "unknown_provenance";
    if (reason) increment(excluded, reason);
    else rows.push(row);
  }
  return { rows, excluded };
}

function round(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function distribution(values, missing = 0) {
  return {
    count: values.length,
    missing,
    median: round(quantile(values, 0.5)),
    p10: round(quantile(values, 0.1)),
    p25: round(quantile(values, 0.25)),
    p75: round(quantile(values, 0.75)),
    p90: round(quantile(values, 0.9)),
  };
}

function group(rows, getter) {
  const map = new Map();
  for (const row of rows) {
    const value = getter(row);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const list = map.get(row.installId) ?? [];
    list.push(value);
    map.set(row.installId, list);
  }
  return map;
}

function aggregateInstallValues(rows, getter, mode = "median") {
  return new Map(
    [...group(rows, getter)].map(([installId, values]) => [
      installId,
      mode === "mean" ? values.reduce((sum, value) => sum + value, 0) / values.length : quantile(values, 0.5),
    ]),
  );
}

function metricSummary(rows, getter) {
  const values = rows.map(getter).filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  const installValues = [...aggregateInstallValues(rows, getter).values()];
  return {
    runs: distribution(values, rows.length - values.length),
    installWeighted: distribution(installValues),
  };
}

function frequency(rows, getter) {
  const counts = Object.create(null);
  for (const row of rows) increment(counts, String(getter(row)));
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => [key, { count, rate: rows.length ? round(count / rows.length) : 0 }]),
  );
}

const upgradeNodeCache = new WeakMap();

function upgradeNodes(row) {
  const cached = upgradeNodeCache.get(row);
  if (cached) return cached;
  const nodes = new Map();
  for (const entry of row.upgrades) {
    for (const node of entry.bought) {
      const current = nodes.get(node);
      if (current === undefined || entry.wave < current) nodes.set(node, entry.wave);
    }
  }
  upgradeNodeCache.set(row, nodes);
  return nodes;
}

function upgradeSummary(rows) {
  const nodes = [...new Set(rows.flatMap((row) => [...upgradeNodes(row).keys()]))].sort();
  const installCount = new Set(rows.map((row) => row.installId)).size;
  return Object.fromEntries(
    nodes.map((node) => {
      const adoptedRows = rows.filter((row) => upgradeNodes(row).has(node));
      const adoptedInstalls = new Set(adoptedRows.map((row) => row.installId)).size;
      return [
        node,
        {
          sessionsAdopted: adoptedRows.length,
          sessionRate: rows.length ? round(adoptedRows.length / rows.length) : 0,
          installsAdopted: adoptedInstalls,
          installRate: installCount ? round(adoptedInstalls / installCount) : 0,
          firstPurchaseWave: distribution(adoptedRows.map((row) => upgradeNodes(row).get(node))),
        },
      ];
    }),
  );
}

function metricDefinitions(rows) {
  const definitions = {
    waveReached: (row) => row.waveReached,
    score: (row) => row.score,
    timePlayedMs: (row) => row.timePlayedMs,
    burjHealth: (row) => row.burjHealth,
    shotsFired: (row) => row.shotsFired,
    totalKills: (row) => row.totalKills,
    displayHitRatio: (row) => row.displayHitRatio,
    multiShots: (row) => row.multiShots,
    maxCombo: (row) => row.maxCombo,
    killsPerMinute: (row) => (row.timePlayedMs > 0 ? row.totalKills / (row.timePlayedMs / 60_000) : null),
  };
  const threats = [...new Set(rows.flatMap((row) => Object.keys(row.destroyedByType)))].sort();
  for (const threat of threats) definitions[`destroyed.${threat}`] = (row) => row.destroyedByType[threat] ?? 0;
  return definitions;
}

function cohortSummary(rows, definitions) {
  const metrics = Object.fromEntries(
    Object.entries(definitions).map(([name, getter]) => [name, metricSummary(rows, getter)]),
  );
  const replayAvailable = rows.filter((row) => row.replayPresent && !row.replayOmittedReason).length;
  const feedbackCount = rows.filter((row) => row.feedbackEmoji !== null).length;
  return {
    sessions: rows.length,
    installs: new Set(rows.map((row) => row.installId)).size,
    builds: [...new Set(rows.map((row) => row.build))].sort(),
    receivedAt: {
      first: rows.length ? new Date(Math.min(...rows.map((row) => row.receivedAt))).toISOString() : null,
      last: rows.length ? new Date(Math.max(...rows.map((row) => row.receivedAt))).toISOString() : null,
    },
    metrics,
    outcomes: frequency(rows, (row) => row.outcome),
    feedback: {
      responseRate: rows.length ? round(feedbackCount / rows.length) : 0,
      values: frequency(
        rows.filter((row) => row.feedbackEmoji !== null),
        (row) => row.feedbackEmoji,
      ),
    },
    provenance: frequency(rows, (row) => row.appFlavor),
    appleEnvironments: frequency(rows, (row) => row.appleEnvironment ?? "unknown"),
    platforms: frequency(rows, (row) => row.platform),
    inputClasses: frequency(rows, (row) => row.inputClass),
    sources: frequency(rows, (row) => row.source),
    captureQuality: {
      replayAvailable: { count: replayAvailable, rate: rows.length ? round(replayAvailable / rows.length) : 0 },
      replayVerified: {
        count: rows.filter((row) => row.replayVerified).length,
        rate: rows.length ? round(rows.filter((row) => row.replayVerified).length / rows.length) : 0,
      },
      shared: {
        count: rows.filter((row) => row.shared).length,
        rate: rows.length ? round(rows.filter((row) => row.shared).length / rows.length) : 0,
      },
    },
    upgrades: upgradeSummary(rows),
  };
}

function hashSeed(value) {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function aggregate(values, mode) {
  if (!values.length) return null;
  return mode === "mean" ? values.reduce((sum, value) => sum + value, 0) / values.length : quantile(values, 0.5);
}

function sampledAggregate(values, random, mode) {
  if (!values.length) return null;
  const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
  return aggregate(sample, mode);
}

function bootstrapDifference(
  baselineRows,
  candidateRows,
  getter,
  seed,
  { withinInstall = "median", acrossInstalls = "median" } = {},
) {
  const baseline = [...aggregateInstallValues(baselineRows, getter, withinInstall).values()];
  const candidate = [...aggregateInstallValues(candidateRows, getter, withinInstall).values()];
  if (baseline.length < 2 || candidate.length < 2) return null;
  const random = randomSource(hashSeed(seed));
  const differences = [];
  for (let iteration = 0; iteration < ANALYSIS_POLICY.clusterBootstrap.iterations; iteration += 1) {
    differences.push(
      sampledAggregate(candidate, random, acrossInstalls) - sampledAggregate(baseline, random, acrossInstalls),
    );
  }
  const tail = (1 - ANALYSIS_POLICY.clusterBootstrap.interval) / 2;
  return { lower: round(quantile(differences, tail)), upper: round(quantile(differences, 1 - tail)) };
}

function pairedDifference(baselineRows, candidateRows, getter) {
  const baseline = aggregateInstallValues(baselineRows, getter);
  const candidate = aggregateInstallValues(candidateRows, getter);
  const installs = [...baseline.keys()].filter((installId) => candidate.has(installId));
  const differences = installs.map((installId) => candidate.get(installId) - baseline.get(installId));
  return { installs: installs.length, medianDelta: round(quantile(differences, 0.5)) };
}

export function classifyEvidence(baseline, candidate) {
  const smoke = ANALYSIS_POLICY.confidence.smokeMinimum;
  const directional = ANALYSIS_POLICY.confidence.directionalMinimum;
  if (
    baseline.installs < smoke.installs ||
    candidate.installs < smoke.installs ||
    baseline.sessions < smoke.sessions ||
    candidate.sessions < smoke.sessions
  ) {
    return "smoke_only";
  }
  if (
    baseline.installs >= directional.installs &&
    candidate.installs >= directional.installs &&
    baseline.sessions >= directional.sessions &&
    candidate.sessions >= directional.sessions
  ) {
    return "directional";
  }
  return "exploratory";
}

function comparisonForMetric(name, getter, baselineRows, candidateRows, baseline, candidate, spec) {
  const baselineMedian = baseline.metrics[name].installWeighted.median;
  const candidateMedian = candidate.metrics[name].installWeighted.median;
  const absoluteDelta = baselineMedian === null || candidateMedian === null ? null : candidateMedian - baselineMedian;
  return {
    baseline: baseline.metrics[name],
    candidate: candidate.metrics[name],
    absoluteDelta: round(absoluteDelta),
    relativeDelta: baselineMedian ? round(absoluteDelta / Math.abs(baselineMedian)) : null,
    clusterInterval90: bootstrapDifference(baselineRows, candidateRows, getter, `${spec.id}:${name}`),
    paired: pairedDifference(baselineRows, candidateRows, getter),
  };
}

function proportionComparison(label, getter, baselineRows, candidateRows, spec) {
  const baselineCount = baselineRows.filter(getter).length;
  const candidateCount = candidateRows.filter(getter).length;
  const baselinePooledRate = baselineRows.length ? baselineCount / baselineRows.length : null;
  const candidatePooledRate = candidateRows.length ? candidateCount / candidateRows.length : null;
  const baselineInstallRates = [
    ...aggregateInstallValues(baselineRows, (row) => (getter(row) ? 1 : 0), "mean").values(),
  ];
  const candidateInstallRates = [
    ...aggregateInstallValues(candidateRows, (row) => (getter(row) ? 1 : 0), "mean").values(),
  ];
  const baselineInstallWeightedRate = aggregate(baselineInstallRates, "mean");
  const candidateInstallWeightedRate = aggregate(candidateInstallRates, "mean");
  return {
    pooled: {
      baseline: { count: baselineCount, total: baselineRows.length, rate: round(baselinePooledRate) },
      candidate: { count: candidateCount, total: candidateRows.length, rate: round(candidatePooledRate) },
      percentagePointDelta: round(
        baselinePooledRate === null || candidatePooledRate === null ? null : candidatePooledRate - baselinePooledRate,
      ),
    },
    installWeighted: {
      baseline: { installs: baselineInstallRates.length, rate: round(baselineInstallWeightedRate) },
      candidate: { installs: candidateInstallRates.length, rate: round(candidateInstallWeightedRate) },
      percentagePointDelta: round(
        baselineInstallWeightedRate === null || candidateInstallWeightedRate === null
          ? null
          : candidateInstallWeightedRate - baselineInstallWeightedRate,
      ),
      clusterInterval90: bootstrapDifference(
        baselineRows,
        candidateRows,
        (row) => (getter(row) ? 1 : 0),
        `${spec.id}:${label}`,
        { withinInstall: "mean", acrossInstalls: "mean" },
      ),
    },
  };
}

function upgradeComparisons(baselineRows, candidateRows, baseline, candidate, spec) {
  const nodes = [...new Set([...Object.keys(baseline.upgrades), ...Object.keys(candidate.upgrades)])].sort();
  return Object.fromEntries(
    nodes.map((node) => {
      const adopted = (row) => upgradeNodes(row).has(node);
      const firstWave = (row) => upgradeNodes(row).get(node) ?? null;
      const baselineWave = metricSummary(baselineRows, firstWave);
      const candidateWave = metricSummary(candidateRows, firstWave);
      const baselineMedian = baselineWave.installWeighted.median;
      const candidateMedian = candidateWave.installWeighted.median;
      const absoluteDelta =
        baselineMedian === null || candidateMedian === null ? null : candidateMedian - baselineMedian;
      return [
        node,
        {
          adoption: proportionComparison(`upgrade:${node}`, adopted, baselineRows, candidateRows, spec),
          firstPurchaseWave: {
            baseline: baselineWave,
            candidate: candidateWave,
            absoluteDelta: round(absoluteDelta),
            relativeDelta: baselineMedian ? round(absoluteDelta / Math.abs(baselineMedian)) : null,
            clusterInterval90: bootstrapDifference(
              baselineRows,
              candidateRows,
              firstWave,
              `${spec.id}:upgrade-wave:${node}`,
            ),
            paired: pairedDifference(baselineRows, candidateRows, firstWave),
          },
        },
      ];
    }),
  );
}

function intervalExcludesZero(interval) {
  return interval && (interval.lower > 0 || interval.upper < 0);
}

function practicalSignal(name, comparison, confidence) {
  const threshold = PRACTICAL_THRESHOLDS[name];
  if (!threshold || confidence !== "directional" || comparison.absoluteDelta === null) return null;
  const observed = threshold.kind === "relative" ? comparison.relativeDelta : comparison.absoluteDelta;
  if (
    observed === null ||
    Math.abs(observed) < threshold.value ||
    !intervalExcludesZero(comparison.clusterInterval90)
  ) {
    return null;
  }
  return { kind: "metric", metric: name, direction: observed > 0 ? "increase" : "decrease", observed, threshold };
}

function warningCollector() {
  const warnings = [];
  const keys = new Set();
  return {
    add(code, message) {
      if (keys.has(code)) return;
      keys.add(code);
      warnings.push({ code, message });
    },
    warnings,
  };
}

function maxInstallShare(rows) {
  if (!rows.length) return 0;
  const counts = new Map();
  for (const row of rows) counts.set(row.installId, (counts.get(row.installId) ?? 0) + 1);
  return Math.max(...counts.values()) / rows.length;
}

function addWarnings(collector, baselineRows, candidateRows, confidence, spec, upgrades) {
  if (baselineRows.length === 0) collector.add("empty-baseline", "The baseline cohort contains no selected rows.");
  if (candidateRows.length === 0) collector.add("empty-candidate", "The candidate cohort contains no selected rows.");
  if (confidence === "smoke_only") collector.add("insufficient-diversity", "At least one cohort is smoke-only.");
  else if (confidence === "exploratory") collector.add("exploratory-only", "Cohorts do not meet directional minima.");
  if (maxInstallShare(baselineRows) > 0.4 || maxInstallShare(candidateRows) > 0.4) {
    collector.add("install-dominance", "One install contributes more than 40% of at least one cohort.");
  }
  const baselineInstalls = new Set(baselineRows.map((row) => row.installId));
  const overlap = new Set(
    candidateRows.map((row) => row.installId).filter((installId) => baselineInstalls.has(installId)),
  );
  if (overlap.size === 0) collector.add("unpaired-cohorts", "No install appears in both cohorts.");
  if ([...baselineRows, ...candidateRows].some((row) => row.appFlavor === "unknown")) {
    collector.add("unknown-provenance", "At least one included row has legacy unknown app provenance.");
  }
  if ([...spec.baselineBuilds, ...spec.candidateBuilds].some((build) => build.includes("+"))) {
    collector.add("composite-build", "At least one cohort uses a dirty/composite build ID.");
  }
  for (const [field, code] of [
    ["appFlavor", "mixed-app-flavor"],
    ["appleEnvironment", "mixed-apple-environment"],
    ["platform", "mixed-platform"],
    ["inputClass", "mixed-input-class"],
    ["source", "mixed-source"],
  ]) {
    if (new Set([...baselineRows, ...candidateRows].map((row) => row[field])).size > 1) {
      collector.add(code, `Included cohorts contain more than one ${field}.`);
    }
  }
  const baselineFeedback = baselineRows.length
    ? baselineRows.filter((row) => row.feedbackEmoji !== null).length / baselineRows.length
    : 0;
  const candidateFeedback = candidateRows.length
    ? candidateRows.filter((row) => row.feedbackEmoji !== null).length / candidateRows.length
    : 0;
  if (Math.abs(candidateFeedback - baselineFeedback) >= 0.2) {
    collector.add("feedback-response-mix", "Feedback response rates differ by at least 20 percentage points.");
  }
  const baselineNodes = new Set(Object.keys(upgrades.baseline));
  const candidateNodes = new Set(Object.keys(upgrades.candidate));
  if (
    [...baselineNodes].some((node) => !candidateNodes.has(node)) ||
    [...candidateNodes].some((node) => !baselineNodes.has(node))
  ) {
    collector.add("build-specific-upgrades", "At least one upgrade ID appears in only one cohort.");
  }
  collector.add("missing-run-context", "D1 does not currently retain draft mode or starting progression context.");
  collector.add("declared-change-set", "Builds may bundle multiple declared changes; signals are observational.");
}

function selectedCandidateRows(rows, cohort, summary, signals, definitions) {
  const selected = [];
  const selectedById = new Map();
  const installCounts = new Map();
  const selectionAudit = [];
  function choose(rankedRows, rule) {
    const ranked = rankedRows.filter(Boolean);
    const preferred = ranked[0];
    const chosen = ranked.find((row) => !selectedById.has(row.runId) && (installCounts.get(row.installId) ?? 0) < 2);
    if (chosen) {
      const candidate = {
        runId: chosen.runId,
        cohort,
        build: chosen.build,
        receivedAt: chosen.receivedAt,
        reasons: [rule],
      };
      selected.push(candidate);
      selectedById.set(chosen.runId, candidate);
      installCounts.set(chosen.installId, (installCounts.get(chosen.installId) ?? 0) + 1);
      selectionAudit.push({
        cohort,
        rule,
        status: chosen === preferred ? "selected" : "fallback",
        runId: chosen.runId,
      });
      return;
    }
    const existing = preferred ? selectedById.get(preferred.runId) : null;
    if (existing) {
      existing.reasons.push(rule);
      selectionAudit.push({ cohort, rule, status: "merged", runId: preferred.runId });
      return;
    }
    selectionAudit.push({ cohort, rule, status: "unavailable", reason: ranked.length ? "per-install-cap" : "no-row" });
  }
  function closest(getter, target) {
    if (target === null || !rows.length) return [];
    return [...rows]
      .filter((row) => Number.isFinite(getter(row)))
      .sort((a, b) => Math.abs(getter(a) - target) - Math.abs(getter(b) - target) || a.runId.localeCompare(b.runId));
  }
  const wave = definitions.waveReached;
  choose(closest(wave, summary.metrics.waveReached.installWeighted.median), "install-weighted median wave");
  choose(closest(wave, summary.metrics.waveReached.runs.p10), "lower-tail wave");
  choose(closest(wave, summary.metrics.waveReached.runs.p90), "upper-tail wave");
  for (const signal of signals.filter((item) => item.kind === "metric")) {
    const getter = definitions[signal.metric];
    if (!getter) continue;
    const ordered = [...rows]
      .filter((row) => Number.isFinite(getter(row)))
      .sort((a, b) => getter(a) - getter(b) || a.runId.localeCompare(b.runId));
    choose(signal.direction === "increase" ? ordered.reverse() : ordered, `${signal.metric} ${signal.direction}`);
  }
  for (const signal of signals.filter((item) => item.kind === "upgrade" || item.kind === "outcome")) {
    const getter =
      signal.kind === "upgrade"
        ? (row) => upgradeNodes(row).has(signal.upgrade)
        : (row) => row.outcome === signal.outcome;
    const candidateShouldMatch = signal.direction === "increase";
    const shouldMatch = cohort === "candidate" ? candidateShouldMatch : !candidateShouldMatch;
    const ranked = [...rows]
      .filter((item) => getter(item) === shouldMatch)
      .sort((a, b) => a.runId.localeCompare(b.runId));
    choose(ranked, `${signal.upgrade ?? signal.outcome} ${signal.direction}`);
  }
  return { candidates: selected, selectionAudit };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stable(value));
}

export function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function analyzeTelemetry(rawRows, spec) {
  const selected = selectTelemetryRows(rawRows, spec);
  const baselineRows = selected.rows.filter((row) => spec.baselineBuilds.includes(row.build));
  const candidateRows = selected.rows.filter((row) => spec.candidateBuilds.includes(row.build));
  const definitions = metricDefinitions(selected.rows);
  const baseline = cohortSummary(baselineRows, definitions);
  const candidate = cohortSummary(candidateRows, definitions);
  const confidence = classifyEvidence(baseline, candidate);
  const metrics = Object.fromEntries(
    Object.entries(definitions).map(([name, getter]) => [
      name,
      comparisonForMetric(name, getter, baselineRows, candidateRows, baseline, candidate, spec),
    ]),
  );
  const outcomes = Object.fromEntries(
    [...SESSION_OUTCOMES]
      .sort()
      .map((outcome) => [
        outcome,
        proportionComparison(`outcome:${outcome}`, (row) => row.outcome === outcome, baselineRows, candidateRows, spec),
      ]),
  );
  const upgrades = { baseline: baseline.upgrades, candidate: candidate.upgrades };
  const upgradeComparison = upgradeComparisons(baselineRows, candidateRows, baseline, candidate, spec);
  const signals = Object.entries(metrics)
    .map(([name, comparison]) => practicalSignal(name, comparison, confidence))
    .filter(Boolean);
  if (confidence === "directional") {
    for (const [outcome, comparison] of Object.entries(outcomes)) {
      const estimate = comparison.installWeighted;
      if (
        estimate.percentagePointDelta !== null &&
        Math.abs(estimate.percentagePointDelta) >= PRACTICAL_THRESHOLDS.outcomeRate.value &&
        intervalExcludesZero(estimate.clusterInterval90)
      ) {
        signals.push({
          kind: "outcome",
          outcome,
          direction: estimate.percentagePointDelta > 0 ? "increase" : "decrease",
          observed: estimate.percentagePointDelta,
          threshold: PRACTICAL_THRESHOLDS.outcomeRate,
        });
      }
    }
    for (const [upgrade, comparison] of Object.entries(upgradeComparison)) {
      const estimate = comparison.adoption.installWeighted;
      const delta = estimate.percentagePointDelta;
      if (
        delta !== null &&
        Math.abs(delta) >= PRACTICAL_THRESHOLDS.upgradeAdoption.value &&
        intervalExcludesZero(estimate.clusterInterval90)
      ) {
        signals.push({
          kind: "upgrade",
          upgrade,
          direction: delta > 0 ? "increase" : "decrease",
          observed: delta,
          threshold: PRACTICAL_THRESHOLDS.upgradeAdoption,
        });
      }
    }
  }
  const collector = warningCollector();
  addWarnings(collector, baselineRows, candidateRows, confidence, spec, upgrades);
  const dataDigest = digest(selected.rows);
  const summaryWithoutDigest = {
    schema: 1,
    comparison: {
      id: spec.id,
      question: spec.question,
      baselineBuilds: spec.baselineBuilds,
      candidateBuilds: spec.candidateBuilds,
      receivedFrom: spec.receivedFrom,
      receivedTo: spec.receivedTo,
      filters: spec.filters,
      knownChanges: spec.knownChanges,
      knownConfounders: spec.knownConfounders,
    },
    confidence,
    analysisPolicy: { ...ANALYSIS_POLICY, practicalThresholds: PRACTICAL_THRESHOLDS },
    selectedRows: selected.rows.length,
    excludedRows: Object.fromEntries(Object.entries(selected.excluded).sort(([a], [b]) => a.localeCompare(b))),
    cohorts: { baseline, candidate },
    comparisons: { metrics, outcomes, upgrades: upgradeComparison },
    practicalSignals: signals,
    warnings: collector.warnings,
    candidateCount: 0,
    dataDigest,
  };
  const baselineSelection = selectedCandidateRows(baselineRows, "baseline", baseline, signals, definitions);
  const candidateSelection = selectedCandidateRows(candidateRows, "candidate", candidate, signals, definitions);
  const candidates = [...baselineSelection.candidates, ...candidateSelection.candidates];
  const selectionAudit = [...baselineSelection.selectionAudit, ...candidateSelection.selectionAudit];
  summaryWithoutDigest.candidateCount = candidates.length;
  summaryWithoutDigest.candidateSelectionRules = selectionAudit.length;
  summaryWithoutDigest.unavailableCandidateSelectionRules = selectionAudit.filter(
    (entry) => entry.status === "unavailable",
  ).length;
  const calculationDigest = digest(summaryWithoutDigest);
  return {
    summary: { ...summaryWithoutDigest, calculationDigest },
    candidates,
    selectionAudit,
    dataDigest,
    calculationDigest,
    candidateDigest: digest({ candidates, selectionAudit }),
  };
}
