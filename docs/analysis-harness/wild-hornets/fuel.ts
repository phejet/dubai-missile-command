import { probeGame, type HornetRec, type ProbeResult } from "./probe";
const GAMES = parseInt(process.argv[2] ?? "20");
const SEED = parseInt(process.argv[3] ?? "70000");
const TAG = process.argv[4] ?? "base";
const ACQ =
  (process.argv[5] ?? "2pad") === "mesh"
    ? ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"]
    : (process.argv[5] ?? "2pad") === "1pad"
      ? ["wildHornetsLeft"]
      : ["wildHornetsLeft", "wildHornetsRight"];
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const runs: ProbeResult[] = [];
for (let i = 0; i < GAMES; i++) runs.push(probeGame({ label: TAG, seed: SEED + i, acquired: ACQ }));
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const det = h.filter((x) => x.outcome === "detonate");
const fuel = h.filter((x) => x.outcome === "fuel");
console.log(`\n═══ ${TAG} — ${ACQ.length === 3 ? "mesh" : ACQ.length === 1 ? "1 pad" : "2 pads"} (${GAMES}g) ═══`);
console.log(
  `  score=${mean(runs.map((r) => r.score)).toFixed(0)}  launched=${(h.length / runs.length).toFixed(0)}/run  ` +
    `hit=${p(det.length, h.length)}  FUEL-OUT=${p(fuel.length, h.length)}  orphan=${p(h.filter((x) => x.outcome === "orphan").length, h.length)}`,
);

const solvable = h.filter((x) => x.pred !== null);
console.log(`  ── accel-aware prediction at launch ──`);
console.log(`    solvable (catchable at all):        ${p(solvable.length, h.length)}`);
console.log(
  `    predicted intercept <= 168 (fuel):  ${p(h.filter((x) => x.pred !== null && x.pred <= 168).length, h.length)}`,
);
console.log(`    median predicted ticks:             ${med(solvable.map((x) => x.pred!)).toFixed(0)}`);
console.log(`  ── old constant-velocity metric, for contrast ──`);
console.log(
  `    "unreachable" (straightline > range): ${p(h.filter((x) => x.launchDist > x.maxRange).length, h.length)}`,
);
console.log(`  ── does the prediction hold? (detonating hornets) ──`);
const withPred = det.filter((x) => x.pred !== null && x.pred > 0);
console.log(
  `    median ACTUAL ticks to kill: ${med(withPred.map((x) => x.ticksAlive)).toFixed(0)}  vs predicted ${med(withPred.map((x) => x.pred!)).toFixed(0)}`,
);
console.log(
  `    median actual/predicted ratio: ${med(withPred.map((x) => x.ticksAlive / x.pred!)).toFixed(2)}x   (>1 = flies further than straight line)`,
);
console.log(
  `    90th pct ratio: ${[...withPred.map((x) => x.ticksAlive / x.pred!)].sort((a, b) => a - b)[Math.floor(withPred.length * 0.9)]?.toFixed(2)}x`,
);
console.log(`  ── what actually fuels out? ──`);
const fs = fuel.filter((x) => x.pred !== null);
console.log(`    fuel-outs that were predicted UNCATCHABLE: ${p(fuel.length - fs.length, fuel.length)}`);
console.log(
  `    fuel-outs predicted catchable within 168:  ${p(fs.filter((x) => x.pred! <= 168).length, fuel.length)}`,
);
const byType: Record<string, number> = {};
for (const x of fuel) byType[x.targetType] = (byType[x.targetType] ?? 0) + 1;
console.log(
  `    fuel-out target mix: ${Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}=${p(v, fuel.length)}`)
    .join("  ")}`,
);
