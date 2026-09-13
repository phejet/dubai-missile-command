import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const directory = resolve(process.argv[2] ?? "dist");
const manifest = JSON.parse(readFileSync(resolve(directory, ".vite/manifest.json"), "utf8"));
const fixture = new URL("../test-fixtures/operator-bundle-budget.json", import.meta.url);
function graph(entry) {
  const seen = new Set(),
    files = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing manifest chunk ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const key of chunk.imports ?? []) visit(key);
  }
  visit(entry);
  return {
    files: [...files].sort(),
    gzipBytes: [...files].reduce((sum, file) => sum + gzipSync(readFileSync(resolve(directory, file))).length, 0),
  };
}
const initial = graph("operator.html");
if (process.argv.includes("--record-baseline")) {
  writeFileSync(
    fixture,
    JSON.stringify(
      { source: "RM-04 operator before RM-08, 2026-09-13", ...initial, maxAdditionalGzipBytes: 20 * 1024 },
      null,
      2,
    ) + "\n",
  );
} else {
  const baseline = JSON.parse(readFileSync(fixture, "utf8"));
  if (initial.gzipBytes > baseline.gzipBytes + baseline.maxAdditionalGzipBytes)
    throw new Error("Operator initial bundle exceeds budget");
  for (const file of initial.files) {
    if (/pixi|renderer|GraphicsContext|WebGL|WebGPU|game-sim|run-recap|upgrade-graph/i.test(file))
      throw new Error(`Renderer/simulation in initial operator graph: ${file}`);
  }
  const lazyKey = Object.keys(manifest).find((key) => key.endsWith("operator-inspection.ts"));
  console.log(
    JSON.stringify(
      {
        initial,
        deltaGzipBytes: initial.gzipBytes - baseline.gzipBytes,
        lazyInspection: lazyKey ? graph(lazyKey) : null,
      },
      null,
      2,
    ),
  );
}
