// Marginal value of ONE hornet pad added to an already-built defense set,
// versus the alternatives it competes with for the same draft slot.
import { probeGame, type HornetRec, type ProbeResult } from "./probe";

const GAMES = parseInt(process.env.GAMES ?? "24");
const SEED = parseInt(process.env.SEED ?? "70000");
const CORE = ["roadrunner", "patriot", "phalanx"];

const CONFIGS: { label: string; add: string[] }[] = [
  { label: "core only (no 4th)", add: [] },
  { label: "core + hornet pad", add: ["wildHornetsLeft"] },
  { label: "core + iron beam", add: ["ironBeam"] },
  { label: "core + 1 pad + MESH", add: ["wildHornetsLeft", "skyHunterMesh"] },
  { label: "core + 2 pads", add: ["wildHornetsLeft", "wildHornetsRight"] },
  { label: "core + 2 pads + MESH", add: ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"] },
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "  n/a");

let baseScore = 0;
for (const cfg of CONFIGS) {
  const runs: ProbeResult[] = [];
  for (let i = 0; i < GAMES; i++) {
    runs.push(probeGame({ label: cfg.label, seed: SEED + i, acquired: [...CORE, ...cfg.add] }));
  }
  const h: HornetRec[] = runs.flatMap((r) => r.hornets);
  const det = h.filter((x) => x.outcome === "detonate").length;
  const score = mean(runs.map((r) => r.score));
  if (!baseScore) baseScore = score;
  const totalKills = mean(runs.map((r) => r.missileKills + r.droneKills));
  const detPerRun = det / runs.length;
  console.log(
    [
      cfg.label.padEnd(22),
      `score=${score.toFixed(0).padStart(6)}`,
      `Δ=${(((score - baseScore) / baseScore) * 100).toFixed(1).padStart(6)}%`,
      `wave=${mean(runs.map((r) => r.wave)).toFixed(2)}`,
      `totalKills=${totalKills.toFixed(0).padStart(4)}`,
      `hornetHits=${detPerRun.toFixed(1).padStart(5)}/run`,
      `=${p(detPerRun, totalKills).padStart(6)} of all kills`,
      `launch=${(h.length / runs.length).toFixed(0).padStart(3)}`,
      `hit=${p(det, h.length).padStart(6)}`,
      `orphan=${p(h.filter((x) => x.outcome === "orphan").length, h.length).padStart(6)}`,
    ].join("  "),
  );
}
