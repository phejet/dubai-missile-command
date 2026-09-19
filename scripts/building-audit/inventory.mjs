import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const out = "operator-results/building-audit-20260919";
mkdirSync(out, { recursive: true });
const found = [];
function extract(d, path, pointer = "") {
  if (!d || typeof d !== "object") return;
  if (!Array.isArray(d) && Number.isFinite(d.seed) && Array.isArray(d.actions)) {
    found.push({ path, pointer, replay: d });
    return;
  }
  // Diagnostic bundles can nest replay payloads; avoid traversing huge unrelated ledgers.
  if (path.startsWith("diag-results/")) for (const [k, v] of Object.entries(d)) extract(v, path, pointer + "/" + k);
}
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".git",
        "ios",
        "dist",
        "browser-temp",
        "building-audit-20260919",
        "attribution",
        "quality",
        "progression",
        "rescoring",
      ].includes(e.name)
    )
      continue;
    const p = dir === "." ? e.name : dir + "/" + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json")) {
      try {
        extract(JSON.parse(readFileSync(p, "utf8")), p);
      } catch {
        /* Non-JSON config files aren't replay payloads. */
      }
    }
  }
}
walk(".");
const groups = new Map();
for (const f of found) {
  const r = f.replay;
  const signature = {
    seed: r.seed,
    actions: r.actions,
    initialState: r.initialState,
    draftMode: r.draftMode,
    isHuman: r.isHuman,
    finalTick: r.finalTick,
    version: r.version,
    build: r._buildId,
  };
  const hash = createHash("sha256").update(JSON.stringify(signature)).digest("hex");
  if (!groups.has(hash)) groups.set(hash, { hash, replay: r, sources: [] });
  const v = groups.get(hash);
  v.sources.push({ path: f.path, pointer: f.pointer });
  if (f.path.includes("scoring-study-20260915")) v.replay = r;
}
const rows = [...groups.values()].map((r, i) => {
  const study = r.sources.find((s) => s.path.includes("scoring-study-20260915/") && s.path.endsWith("-replay.json"));
  const env = JSON.stringify(r.replay._env ?? "");
  const cohort = study
    ? "human-study"
    : /HeadlessChrome/i.test(env)
      ? "automated"
      : r.replay.isHuman
        ? "unconfirmed-human"
        : "fixture";
  return {
    ...r,
    label: "audit-" + String(i + 1).padStart(3, "0"),
    cohort,
    studyLabel: study?.path.match(/run-\d+/)?.[0] ?? null,
  };
});
writeFileSync(out + "/inventory.json", JSON.stringify({ files: found.length, unique: rows.length, rows }), {
  mode: 0o600,
});
console.log({
  files: found.length,
  unique: rows.length,
  cohorts: rows.reduce((a, r) => ((a[r.cohort] = (a[r.cohort] ?? 0) + 1), a), {}),
});
