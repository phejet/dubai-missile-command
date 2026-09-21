// Preserve the pre-change simulator and perf inputs without altering the shared checkout.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const out = `operator-results/target-pressure-stage-b/baseline-${revision}`;
if (existsSync(`${out}/manifest.json`)) {
  console.log(`Baseline already preserved: ${out}`);
} else {
  mkdirSync(out, { recursive: true });
  const read = (file) =>
    execFileSync("git", ["show", `${revision}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  await build({
    stdin: {
      contents: 'export { createReplayRunner } from "./src/replay";',
      resolveDir: process.cwd(),
      sourcefile: "baseline-entry.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `${out}/simulator.mjs`,
    plugins: [
      {
        name: "git-object-source",
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, (args) => {
            const relative = path.posix.normalize(
              path.posix.join(args.namespace === "git" ? path.posix.dirname(args.importer) : "", args.path),
            );
            for (const candidate of [relative, `${relative}.ts`, `${relative}.tsx`, `${relative}.json`]) {
              try {
                read(candidate);
                return { path: candidate, namespace: "git" };
              } catch {
                /* extension search only */
              }
            }
            return undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "git" }, (args) => ({
            contents: read(args.path),
            loader: args.path.endsWith(".json") ? "json" : args.path.endsWith(".tsx") ? "tsx" : "ts",
          }));
        },
      },
    ],
  });
  const fixtures = ["perf-wave1", "perf-wave4-upgrades", "perf-burj-burning"];
  for (const name of fixtures) writeFileSync(`${out}/${name}.json`, read(`public/replays/${name}.json`));
  writeFileSync(
    `${out}/manifest.json`,
    JSON.stringify(
      { revision, fixtures, description: "Matching pre-Stage-B simulator and untouched v14 perf inputs" },
      null,
      2,
    ) + "\n",
  );
  console.log(`Preserved baseline: ${out}`);
}
