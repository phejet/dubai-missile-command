// Bundle the real private updaters for isolated launch tests, without changing source.
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const out = "operator-results/building-audit-20260919/fix";
mkdirSync(out, { recursive: true });
const bundle = resolve(out, "verify-fix.mjs");
await build({
  entryPoints: ["scripts/building-audit/verify-fix-run.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  plugins: [
    {
      name: "expose-real-updaters",
      setup(b) {
        b.onLoad({ filter: /\/src\/game-sim\.ts$/ }, (args) => ({
          contents:
            readFileSync(args.path, "utf8") + "\nexport const buildingFixInternals = { updateDrones, updateMissiles };",
          loader: "ts",
          resolveDir: resolve(args.path, ".."),
        }));
      },
    },
  ],
});
const result = spawnSync(process.execPath, [bundle], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
