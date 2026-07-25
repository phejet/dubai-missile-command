import { probeGame, type HornetRec, type ProbeResult } from "./probe";
const GAMES = 20,
  SEED = parseInt(process.argv[3] ?? "70000");
const TAG = process.argv[2] ?? "base";
const ACQ =
  (process.argv[4] ?? "2pad") === "mesh"
    ? ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"]
    : ["wildHornetsLeft", "wildHornetsRight"];
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const runs: ProbeResult[] = [];
for (let i = 0; i < GAMES; i++) runs.push(probeGame({ label: TAG, seed: SEED + i, acquired: ACQ }));
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const det = h.filter((x) => x.outcome === "detonate");
const inRole = h.filter((x) => x.targetType.startsWith("bomb") || x.targetType.startsWith("drone"));
console.log(
  [
    TAG.padEnd(14),
    `score=${mean(runs.map((r) => r.score))
      .toFixed(0)
      .padStart(6)}`,
    `wave=${mean(runs.map((r) => r.wave)).toFixed(2)}`,
    `burjHP=${mean(runs.map((r) => r.burjHealth)).toFixed(2)}`,
    `launch=${(h.length / runs.length).toFixed(0).padStart(3)}/run`,
    `hit=${p(det.length, h.length).padStart(6)}`,
    `orphan=${p(h.filter((x) => x.outcome === "orphan").length, h.length).padStart(6)}`,
    `fuel=${p(h.filter((x) => x.outcome === "fuel").length, h.length).padStart(6)}`,
    `inRole=${p(inRole.length, h.length).padStart(6)}`,
    `tgtSpd=${mean(h.map((x) => x.targetSpeed)).toFixed(2)}`,
    `medKillY=${med(det.map((x) => x.killY)).toFixed(0)}`,
  ].join("  "),
);
