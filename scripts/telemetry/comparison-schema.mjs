import { APP_FLAVORS, INPUT_CLASSES, SAFE_CAPTURE_ID, SAFE_COMPARISON_ID, SESSION_SOURCES } from "./constants.mjs";

const APP_FLAVOR_SET = new Set(APP_FLAVORS);
const INPUT_CLASS_SET = new Set(INPUT_CLASSES);
const SOURCE_SET = new Set(SESSION_SOURCES);
const DAY_MS = 24 * 60 * 60 * 1000;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new Error(`${label} has unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
}

function text(value, label, max = 500) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function stringArray(value, label, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${options.nonEmpty ? "a non-empty" : "an"} array`);
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, options.max ?? 500));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
  if (options.allowed) {
    for (const item of result)
      if (!options.allowed.has(item)) throw new Error(`${label} contains unsupported value ${item}`);
  }
  if (options.pattern) {
    for (const item of result)
      if (!options.pattern.test(item)) throw new Error(`${label} contains invalid value ${item}`);
  }
  return result;
}

function timestamp(value, label) {
  const source = text(value, label, 64);
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== source) {
    throw new Error(`${label} must be an exact ISO-8601 UTC timestamp`);
  }
  return { source, parsed };
}

export function validateComparisonSpec(input, { now = Date.now() } = {}) {
  const value = record(input, "comparison");
  exactKeys(
    value,
    [
      "schema",
      "id",
      "question",
      "baselineBuilds",
      "candidateBuilds",
      "receivedFrom",
      "receivedTo",
      "filters",
      "knownChanges",
      "knownConfounders",
    ],
    "comparison",
  );
  if (value.schema !== 1) throw new Error("comparison.schema must be 1");
  const id = text(value.id, "comparison.id", 64);
  if (!SAFE_COMPARISON_ID.test(id)) throw new Error("comparison.id contains unsafe characters");
  const question = text(value.question, "comparison.question", 500);
  const baselineBuilds = stringArray(value.baselineBuilds, "comparison.baselineBuilds", {
    nonEmpty: true,
    max: 64,
    pattern: SAFE_CAPTURE_ID,
  });
  const candidateBuilds = stringArray(value.candidateBuilds, "comparison.candidateBuilds", {
    nonEmpty: true,
    max: 64,
    pattern: SAFE_CAPTURE_ID,
  });
  const overlap = baselineBuilds.filter((build) => candidateBuilds.includes(build));
  if (overlap.length) throw new Error(`baseline and candidate builds overlap: ${overlap.join(", ")}`);

  const from = timestamp(value.receivedFrom, "comparison.receivedFrom");
  const to = timestamp(value.receivedTo, "comparison.receivedTo");
  if (from.parsed >= to.parsed) throw new Error("comparison.receivedFrom must be before receivedTo");
  if (from.parsed < now - 365 * DAY_MS) throw new Error("comparison.receivedFrom is outside retained summary history");
  if (to.parsed > now) throw new Error("comparison.receivedTo must not be in the future");

  const filters = record(value.filters, "comparison.filters");
  exactKeys(
    filters,
    ["appFlavors", "platforms", "inputClasses", "sources", "excludeEphemeral", "excludeUnknownProvenance"],
    "comparison.filters",
  );
  for (const key of ["excludeEphemeral", "excludeUnknownProvenance"]) {
    if (typeof filters[key] !== "boolean") throw new Error(`comparison.filters.${key} must be boolean`);
  }

  return {
    schema: 1,
    id,
    question,
    baselineBuilds,
    candidateBuilds,
    receivedFrom: from.source,
    receivedTo: to.source,
    receivedFromMs: from.parsed,
    receivedToMs: to.parsed,
    filters: {
      appFlavors: stringArray(filters.appFlavors, "comparison.filters.appFlavors", {
        nonEmpty: true,
        max: 32,
        allowed: APP_FLAVOR_SET,
      }),
      platforms: stringArray(filters.platforms, "comparison.filters.platforms", { nonEmpty: true, max: 128 }),
      inputClasses: stringArray(filters.inputClasses, "comparison.filters.inputClasses", {
        nonEmpty: true,
        max: 32,
        allowed: INPUT_CLASS_SET,
      }),
      sources: stringArray(filters.sources, "comparison.filters.sources", {
        nonEmpty: true,
        max: 32,
        allowed: SOURCE_SET,
      }),
      excludeEphemeral: filters.excludeEphemeral,
      excludeUnknownProvenance: filters.excludeUnknownProvenance,
    },
    knownChanges: stringArray(value.knownChanges, "comparison.knownChanges", { nonEmpty: true, max: 500 }),
    knownConfounders: stringArray(value.knownConfounders, "comparison.knownConfounders", { max: 500 }),
  };
}

export function publicComparisonSpec(spec) {
  const { receivedFromMs: _from, receivedToMs: _to, ...publicSpec } = spec;
  return publicSpec;
}
