import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  analyzeTelemetry,
  classifyEvidence,
  selectTelemetryRows,
  validateTelemetryRow,
} from "./telemetry/analysis.mjs";
import { validateComparisonSpec } from "./telemetry/comparison-schema.mjs";
import {
  assertReadOnlyQuery,
  assertPublicArtifacts,
  buildArtifacts,
  cleanupExpiredPrivate,
  cleanupPrivate,
  main,
  parseArgs,
  queryStaging,
  renderQuery,
  renderSummaryMarkdown,
  safeResultsPath,
  sanitizeWranglerFailure,
  validateWranglerResult,
  writeArtifacts,
} from "./analyze-telemetry.mjs";

const fixturePath = resolve("test-fixtures/telemetry/cohorts.json");
const rows = JSON.parse(await readFile(fixturePath, "utf8"));
const now = Date.parse("2026-09-04T00:00:00.000Z");

function comparison(overrides = {}) {
  return validateComparisonSpec(
    {
      schema: 1,
      id: "fixture-comparison",
      question: "Did the fixture candidate improve?",
      baselineBuilds: ["build-a"],
      candidateBuilds: ["build-b"],
      receivedFrom: "2026-08-24T00:00:00.000Z",
      receivedTo: "2026-08-27T00:00:00.000Z",
      filters: {
        appFlavors: ["staging"],
        platforms: ["ios"],
        inputClasses: ["touch"],
        sources: ["gameover"],
        excludeEphemeral: true,
        excludeUnknownProvenance: true,
      },
      knownChanges: ["Fixture change"],
      knownConfounders: [],
      ...overrides,
    },
    { now },
  );
}

function directionalRows() {
  const result = [];
  for (const [cohort, build, score, wave] of [
    ["baseline", "build-a", 100, 5],
    ["candidate", "build-b", 200, 7],
  ]) {
    for (let install = 0; install < 5; install += 1) {
      for (let run = 0; run < 4; run += 1) {
        const template = structuredClone(rows[cohort === "baseline" ? 0 : 2]);
        template.run_id = `run-${cohort}-${install}-${run}`;
        template.install_id = `install-${install}000`;
        template.build = build;
        template.score = score + install + run;
        template.wave_reached = wave;
        result.push(template);
      }
    }
  }
  return result;
}

describe("comparison contract", () => {
  it("accepts one bounded, disjoint comparison", () => {
    expect(comparison()).toMatchObject({ schema: 1, baselineBuilds: ["build-a"], candidateBuilds: ["build-b"] });
  });

  it("rejects overlapping, future, and unknown fields", () => {
    expect(() => comparison({ candidateBuilds: ["build-a"] })).toThrow(/overlap/);
    expect(() => comparison({ receivedTo: "2026-09-05T00:00:00.000Z" })).toThrow(/future/);
    expect(() => comparison({ surprise: true })).toThrow(/unknown field/);
  });

  it("enforces the exact 365-day retained-summary boundary", () => {
    const oldest = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(comparison({ receivedFrom: oldest })).toMatchObject({ receivedFrom: oldest });
    expect(() => comparison({ receivedFrom: new Date(Date.parse(oldest) - 1).toISOString() })).toThrow(
      /outside retained summary history/,
    );
  });

  it("parses only explicit CLI arguments", () => {
    expect(parseArgs(["--env", "staging", "--comparison", "fixture.json"])).toEqual({
      env: "staging",
      comparison: "fixture.json",
    });
    expect(() => parseArgs(["--sql", "DROP TABLE sessions"])).toThrow(/Unknown argument/);
  });
});

describe("fixed query guard", () => {
  it("renders validated scalar and build placeholders", () => {
    const query = renderQuery(
      "SELECT * FROM sessions WHERE received_at >= {{RECEIVED_FROM_MS}} AND received_at < {{RECEIVED_TO_MS}} AND build IN ({{BUILD_LIST}});",
      comparison(),
    );
    expect(query).toContain("build IN ('build-a', 'build-b')");
    expect(query).not.toContain("{{");
  });

  it("rejects mutating or multi-statement SQL", () => {
    expect(() => assertReadOnlyQuery("DELETE FROM sessions;")).toThrow(/begin with SELECT/);
    expect(() => assertReadOnlyQuery("SELECT 1; DROP TABLE sessions;")).toThrow(/mutating/);
  });

  it("requires Wrangler to prove zero writes", () => {
    expect(
      validateWranglerResult([{ success: true, results: rows, meta: { changes: 0, rows_written: 0, rows_read: 4 } }]),
    ).toMatchObject({
      rows,
      meta: { changes: 0, rowsWritten: 0, rowsRead: 4 },
    });
    expect(() =>
      validateWranglerResult([{ success: true, results: rows, meta: { changes: 1, rows_written: 1, rows_read: 4 } }]),
    ).toThrow(/writes/);
  });

  it("executes the checked-in projection against SQLite and excludes private columns", async () => {
    const database = new DatabaseSync(":memory:");
    const columns = {
      run_id: "TEXT",
      install_id: "TEXT",
      install_ephemeral: "INTEGER",
      received_at: "INTEGER",
      build: "TEXT",
      app_flavor: "TEXT",
      apple_environment: "TEXT",
      platform: "TEXT",
      input_class: "TEXT",
      source: "TEXT",
      outcome: "TEXT",
      death_cause: "TEXT",
      wave_reached: "INTEGER",
      score: "INTEGER",
      time_played_ms: "INTEGER",
      burj_health: "REAL",
      shots_fired: "INTEGER",
      total_kills: "INTEGER",
      hit_ratio: "REAL",
      multi_shots: "INTEGER",
      max_combo: "INTEGER",
      destroyed_by_type_json: "TEXT",
      upgrades_json: "TEXT",
      feedback_emoji: "TEXT",
      replay_sha256: "TEXT",
      replay_omitted_reason: "TEXT",
      replay_complete_claimed: "INTEGER",
      replay_verified: "INTEGER",
      shared: "INTEGER",
      display_name: "TEXT",
      feedback_note: "TEXT",
    };
    database.exec(
      `CREATE TABLE sessions (${Object.entries(columns)
        .map(([name, type]) => `${name} ${type}`)
        .join(", ")})`,
    );
    const names = Object.keys(columns);
    const insert = database.prepare(
      `INSERT INTO sessions (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    );
    for (const row of rows) {
      const stored = { ...row, replay_sha256: "a".repeat(64), display_name: "private", feedback_note: "private" };
      insert.run(...names.map((name) => stored[name] ?? null));
    }
    const query = renderQuery(await readFile(resolve("scripts/telemetry/query.sql"), "utf8"), comparison());
    const result = database.prepare(query).all();
    database.close();
    expect(result).toHaveLength(4);
    expect(result[0]).not.toHaveProperty("display_name");
    expect(result[0]).not.toHaveProperty("feedback_note");
    expect(result[0]).not.toHaveProperty("replay_sha256");
    expect(result[0]).toMatchObject({ replay_present: 1 });
  });

  it("pins the Wrangler adapter to Staging and preserves sanitized failure context", () => {
    let receivedArgs;
    const result = queryStaging("SELECT 1;", (_command, args) => {
      receivedArgs = args;
      return {
        status: 0,
        stdout: JSON.stringify([{ success: true, results: [], meta: { changes: 0, rows_written: 0, rows_read: 0 } }]),
      };
    });
    expect(receivedArgs).toEqual(expect.arrayContaining(["dmc-captures-staging", "--env", "staging", "--remote"]));
    expect(result).toMatchObject({ rows: [], meta: { rowsWritten: 0 } });
    expect(() => queryStaging("SELECT 1;", () => ({ status: 1, stderr: "network failed token=super-secret" }))).toThrow(
      /network failed token=<redacted>/,
    );
    expect(sanitizeWranglerFailure({ stderr: "Bearer: abc123" })).not.toContain("abc123");
  });
});

describe("telemetry analysis", () => {
  it("validates structured rows and rejects malformed summary JSON", () => {
    expect(validateTelemetryRow(rows[0])).toMatchObject({ build: "build-a", upgrades: [{ bought: ["node-a"] }] });
    expect(() => validateTelemetryRow({ ...rows[0], upgrades_json: "{" })).toThrow(/valid JSON/);
  });

  it("reports tiny fixture cohorts as smoke-only with paired install-weighted deltas", () => {
    const result = analyzeTelemetry(rows, comparison());
    expect(result.summary.confidence).toBe("smoke_only");
    expect(result.summary.comparisons.metrics.score).toMatchObject({
      absoluteDelta: 100,
      relativeDelta: 0.666667,
      paired: { installs: 2, medianDelta: 100 },
    });
    expect(result.summary.practicalSignals).toEqual([]);
    expect(result.summary.warnings.map((warning) => warning.code)).toContain("insufficient-diversity");
    expect(result.summary.comparisons.outcomes.burj_destroyed.installWeighted.clusterInterval90).not.toBeNull();
  });

  it("prevents filtered and undeclared rows from quietly entering a cohort", () => {
    const withManual = [...rows, { ...rows[0], run_id: "run-manual", source: "manual" }];
    expect(selectTelemetryRows(withManual, comparison()).excluded).toEqual({ source: 1 });
    expect(() => analyzeTelemetry([{ ...rows[0], build: "build-c" }], comparison())).toThrow(/not declared/);
  });

  it("enforces ephemeral and unknown-provenance filters independently", () => {
    const input = [
      { ...rows[0], run_id: "run-ephemeral", install_id: "eph-12345678", install_ephemeral: 1 },
      { ...rows[1], run_id: "run-unknown", app_flavor: "unknown" },
    ];
    const spec = comparison({
      filters: { ...comparison().filters, appFlavors: ["staging", "unknown"] },
    });
    expect(selectTelemetryRows(input, spec)).toMatchObject({
      rows: [],
      excluded: { ephemeral: 1, unknown_provenance: 1 },
    });
  });

  it("handles zero denominators without NaN or invented relative deltas", () => {
    const input = [
      { ...rows[0], score: 0, time_played_ms: 0, shots_fired: 0, total_kills: 0, hit_ratio: 0 },
      { ...rows[2], score: 10, time_played_ms: 0, shots_fired: 0, total_kills: 0, hit_ratio: 0 },
    ];
    const result = analyzeTelemetry(input, comparison());
    expect(result.summary.comparisons.metrics.score.relativeDelta).toBeNull();
    expect(result.summary.cohorts.baseline.metrics.killsPerMinute.runs).toMatchObject({ count: 0, missing: 1 });
    expect(JSON.stringify(result.summary)).not.toMatch(/NaN|Infinity/);
  });

  it("keeps one run outlier from dominating install medians and treats absent feedback as missing", () => {
    const input = directionalRows().map((row) => ({ ...row, feedback_emoji: null }));
    input.at(-1).score = 1_000_000;
    const result = analyzeTelemetry(input, comparison());
    expect(result.summary.cohorts.candidate.metrics.score.runs.p90).toBeLessThan(1_000);
    expect(result.summary.cohorts.candidate.metrics.score.installWeighted.median).toBeLessThan(1_000);
    expect(result.summary.cohorts.baseline.feedback).toMatchObject({ responseRate: 0, values: {} });
    expect(result.summary.cohorts.candidate.feedback).toMatchObject({ responseRate: 0, values: {} });
  });

  it("normalizes empty, repeated, reordered, and build-specific upgrade timelines", () => {
    const input = [
      { ...rows[0], upgrades_json: "[]" },
      {
        ...rows[2],
        upgrades_json: '[{"tick":400,"wave":4,"bought":["node-b","node-b"]},{"tick":200,"wave":2,"bought":["node-b"]}]',
      },
    ];
    const result = analyzeTelemetry(input, comparison());
    expect(result.summary.cohorts.baseline.upgrades).toEqual({});
    expect(result.summary.cohorts.candidate.upgrades["node-b"]).toMatchObject({
      sessionsAdopted: 1,
      firstPurchaseWave: { median: 2 },
    });
    expect(result.summary.warnings.map((warning) => warning.code)).toContain("build-specific-upgrades");
  });

  it("flags composite builds and explicitly empty cohorts", () => {
    const compositeSpec = comparison({ baselineBuilds: ["build-a+dirty"] });
    const composite = analyzeTelemetry([{ ...rows[0], build: "build-a+dirty" }, rows[2]], compositeSpec);
    expect(composite.summary.warnings.map((warning) => warning.code)).toContain("composite-build");
    const empty = analyzeTelemetry([rows[0]], comparison());
    expect(empty.summary.warnings.map((warning) => warning.code)).toContain("empty-candidate");
    expect(empty.summary.cohorts.candidate.metrics.score.installWeighted.median).toBeNull();
    expect(empty.summary.comparisons.outcomes.burj_destroyed.installWeighted.clusterInterval90).toBeNull();
    expect(renderSummaryMarkdown(empty.summary)).toContain("| abandoned | 0% | — | — | — | — |");
    expect(empty.selectionAudit.filter((entry) => entry.status === "unavailable")).toHaveLength(3);
  });

  it("emits deterministic practical signals only for sufficiently diverse cohorts", () => {
    const input = directionalRows();
    const first = analyzeTelemetry(input, comparison());
    const second = analyzeTelemetry(input, comparison());
    expect(first).toEqual(second);
    expect(first.summary.confidence).toBe("directional");
    expect(first.summary.practicalSignals.map((signal) => signal.metric)).toEqual(
      expect.arrayContaining(["waveReached", "score"]),
    );
    expect(first.summary.practicalSignals).toContainEqual(
      expect.objectContaining({ kind: "upgrade", upgrade: "node-b", direction: "increase" }),
    );
    expect(first.summary).toMatchObject({
      analysisPolicy: {
        clusterBootstrap: { unit: "install", iterations: 1000, interval: 0.9 },
      },
    });
    expect(first.calculationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("separates pooled and install-weighted proportion deltas and audits every selection rule", () => {
    const input = [];
    for (let install = 0; install < 2; install += 1) {
      input.push({
        ...rows[0],
        run_id: `run-base-proportion-${install}`,
        install_id: `install-base-${install}`,
        outcome: "survived",
        death_cause: null,
      });
    }
    for (let run = 0; run < 10; run += 1) {
      input.push({
        ...rows[2],
        run_id: `run-candidate-proportion-${run}`,
        install_id: run < 8 ? "install-heavy" : "install-light",
        outcome: run < 8 ? "burj_destroyed" : "survived",
        death_cause: run < 8 ? "burj_destroyed" : null,
      });
    }
    const result = analyzeTelemetry(input, comparison());
    const outcome = result.summary.comparisons.outcomes.burj_destroyed;
    expect(outcome.pooled.percentagePointDelta).toBe(0.8);
    expect(outcome.installWeighted).toMatchObject({
      baseline: { rate: 0 },
      candidate: { rate: 0.5 },
      percentagePointDelta: 0.5,
      clusterInterval90: { lower: 0, upper: 1 },
    });
    expect(result.selectionAudit).toHaveLength(6);
    expect(result.selectionAudit.map((entry) => entry.status)).toEqual(
      expect.arrayContaining(["selected", "fallback", "merged"]),
    );
    expect(result.candidates.every((candidate) => Array.isArray(candidate.reasons))).toBe(true);
  });

  it("classifies evidence by the weakest cohort dimension", () => {
    expect(classifyEvidence({ sessions: 100, installs: 2 }, { sessions: 100, installs: 10 })).toBe("smoke_only");
    expect(classifyEvidence({ sessions: 10, installs: 3 }, { sessions: 20, installs: 5 })).toBe("exploratory");
    expect(classifyEvidence({ sessions: 20, installs: 5 }, { sessions: 20, installs: 5 })).toBe("directional");
  });
});

describe("artifact privacy and lifecycle", () => {
  it("rejects raw Markdown identifier injection before writing", () => {
    expect(() =>
      assertPublicArtifacts(
        { manifest: {}, summary: {}, verification: {}, markdown: `context prefix ${rows[0].run_id} suffix` },
        rows,
      ),
    ).toThrow(/private run_id/);
  });

  it("rejects comparison prose that would smuggle a row ID into public Markdown", () => {
    const spec = comparison({ knownConfounders: [`prefix ${rows[0].run_id} suffix`] });
    const analysis = analyzeTelemetry(rows, spec);
    expect(() =>
      buildArtifacts({
        analysis,
        spec,
        query: "SELECT fixture;",
        queryMeta: { changes: 0, rowsWritten: 0, rowsRead: rows.length },
        generatedAt: new Date("2026-09-04T00:00:00.000Z"),
        toolBuild: "fixture",
        rawRows: rows,
      }),
    ).toThrow(/private run_id/);
  });

  it("restricts output to one safe child of the results root", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "dmc-telemetry-path-"));
    expect(safeResultsPath(directory, resolve(directory, "proof-1"))).toBe(resolve(directory, "proof-1"));
    expect(() => safeResultsPath(directory, resolve(directory, "nested/proof"))).toThrow(/one safe child/);
    expect(() => safeResultsPath(directory, resolve(directory, "../escape"))).toThrow(/one safe child/);
  });

  it("writes identifier-free public artifacts and private candidates atomically", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "dmc-telemetry-"));
    const output = resolve(directory, "fixture-comparison");
    const spec = comparison();
    const analysis = analyzeTelemetry(rows, spec);
    const artifacts = buildArtifacts({
      analysis,
      spec,
      query: "SELECT fixture;",
      queryMeta: { changes: 0, rowsWritten: 0, rowsRead: rows.length },
      generatedAt: new Date("2026-09-04T00:00:00.000Z"),
      toolBuild: "fixture",
      rawRows: rows,
    });
    await writeArtifacts(output, artifacts);
    const publicArtifact = (
      await Promise.all(
        ["manifest.json", "summary.json", "summary.md", "verification.json"].map((name) =>
          readFile(resolve(output, name), "utf8"),
        ),
      )
    ).join("\n");
    const candidates = await readFile(resolve(output, "candidates.private.json"), "utf8");
    for (const row of rows) {
      expect(publicArtifact).not.toContain(row.run_id);
      expect(publicArtifact).not.toContain(row.install_id);
    }
    expect(artifacts.manifest.queryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(artifacts.verification.privacy).toMatchObject({
      passed: true,
      checkedFormats: ["structured-json", "raw-markdown"],
    });
    expect(artifacts.verification).not.toHaveProperty("shareableArtifactsContainIdentifiers");
    expect(candidates).toContain("run-base-01");
    expect(await cleanupPrivate(directory, "fixture-comparison")).toBe(true);
    await expect(readFile(resolve(output, "candidates.private.json"), "utf8")).rejects.toThrow();
  });

  it("removes only due private files during age cleanup", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "dmc-telemetry-expiry-"));
    for (const [name, due] of [
      ["expired", "2026-09-03T00:00:00.000Z"],
      ["current", "2026-10-03T00:00:00.000Z"],
    ]) {
      const target = resolve(directory, name);
      const spec = comparison({ id: name });
      const analysis = analyzeTelemetry(rows, spec);
      const artifacts = buildArtifacts({
        analysis,
        spec,
        query: "SELECT fixture;",
        queryMeta: { changes: 0, rowsWritten: 0, rowsRead: rows.length },
        generatedAt: new Date("2026-08-04T00:00:00.000Z"),
        toolBuild: "fixture",
        rawRows: rows,
      });
      artifacts.verification.cleanupDueAt = due;
      await writeArtifacts(target, artifacts);
    }
    expect(await cleanupExpiredPrivate(directory, now)).toEqual(["expired"]);
    await expect(readFile(resolve(directory, "expired/candidates.private.json"), "utf8")).rejects.toThrow();
    expect(await readFile(resolve(directory, "current/candidates.private.json"), "utf8")).toContain("run-base-01");
  });

  it("refuses Production before attempting to read a comparison", async () => {
    await expect(main(["--env", "production", "--comparison", "missing.json"])).rejects.toThrow(/only --env staging/);
  });
});
