// Does cross-side launching produce BETTER terminal geometry, as hypothesised?
// The raw cross-vs-same hit rate is confounded: cross-side hornets fly further, so
// more die en route. Condition on "actually arrived" to isolate the geometry claim.
import { probeGame, type HornetRec, type ProbeResult } from "./probe";

const GAMES = parseInt(process.argv[2] ?? "20");
const SEED_BASE = parseInt(process.argv[3] ?? "70000");
const TAG = process.argv[4] ?? "base";
const ACQ =
  (process.argv[5] ?? "2pad") === "mesh"
    ? ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"]
    : ["wildHornetsLeft", "wildHornetsRight"];

const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const runs: ProbeResult[] = [];
for (let i = 0; i < GAMES; i++) runs.push(probeGame({ label: TAG, seed: SEED_BASE + i, acquired: ACQ }));
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const det = (xs: HornetRec[]) => xs.filter((x) => x.outcome === "detonate").length;
const fuel = (xs: HornetRec[]) => xs.filter((x) => x.outcome === "fuel").length;

console.log(`\n═══ ${TAG} — ${ACQ.length === 3 ? "2 pads + SkyMesh" : "2 pads"} (${GAMES} games) ═══`);
console.log(
  `  score=${mean(runs.map((r) => r.score)).toFixed(0)}  launched=${(h.length / runs.length).toFixed(0)}/run`,
);

const groups = [
  ["same ", h.filter((x) => !x.crossSide)],
  ["cross", h.filter((x) => x.crossSide)],
] as const;

console.log(`\n  ── ALL launches (confounded by flight distance) ──`);
for (const [name, xs] of groups) {
  console.log(
    `    ${name} n=${String(xs.length).padStart(4)}  hit=${p(det(xs), xs.length).padStart(6)}  ` +
      `fuel=${p(fuel(xs), xs.length).padStart(6)}  medDist=${med(xs.map((x) => x.launchDist)).toFixed(0)}px`,
  );
}

console.log(`\n  ── ARRIVED (closed within 150px) — isolates terminal geometry ──`);
for (const [name, xs] of groups) {
  const arr = xs.filter((x) => x.minDist < 150);
  console.log(
    `    ${name} arrived=${p(arr.length, xs.length).padStart(6)} (n=${String(arr.length).padStart(4)})  ` +
      `→ converted=${p(det(arr), arr.length).padStart(6)}  ` +
      `trailingAtCPA=${p(arr.filter((x) => x.trailingAtCpa).length, arr.length).padStart(6)}  ` +
      `medCPA=${med(arr.map((x) => x.cpaMin)).toFixed(1)}px`,
  );
}

console.log(`\n  ── why the non-arrivals died ──`);
for (const [name, xs] of groups) {
  const miss = xs.filter((x) => x.minDist >= 150);
  console.log(
    `    ${name} n=${String(miss.length).padStart(4)}  fuel=${p(fuel(miss), miss.length).padStart(6)}  ` +
      `orphan=${p(miss.filter((x) => x.outcome === "orphan").length, miss.length).padStart(6)}  ` +
      `unreachableAtLaunch=${p(miss.filter((x) => x.launchDist > x.maxRange).length, miss.length)}`,
  );
}
