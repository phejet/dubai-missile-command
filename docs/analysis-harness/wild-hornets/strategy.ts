// Does "cede the bottom half to hornets" pay off, and does it depend on how
// much hornet you own? Same loadouts, two player strategies.
import { probeGame, type ProbeResult, type HornetRec } from "./probe";
const GAMES = 24,
  SEED = 70000;
const CORE = ["roadrunner", "patriot", "phalanx"];
const LOADOUTS: { label: string; add: string[] }[] = [
  { label: "core + 1 pad", add: ["wildHornetsLeft"] },
  { label: "core + 2 pads", add: ["wildHornetsLeft", "wildHornetsRight"] },
  { label: "core + 2 pads + mesh", add: ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"] },
];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
for (const l of LOADOUTS) {
  const runs: ProbeResult[] = [];
  for (let i = 0; i < GAMES; i++)
    runs.push(probeGame({ label: l.label, seed: SEED + i, acquired: [...CORE, ...l.add] }));
  const h: HornetRec[] = runs.flatMap((r) => r.hornets);
  const det = h.filter((x) => x.outcome === "detonate").length;
  console.log(
    [
      l.label.padEnd(21),
      `score=${mean(runs.map((r) => r.score))
        .toFixed(0)
        .padStart(6)}`,
      `wave=${mean(runs.map((r) => r.wave)).toFixed(2)}`,
      `hornetHits=${(det / runs.length).toFixed(1).padStart(5)}/run`,
      `hit=${p(det, h.length).padStart(6)}`,
      `orphan=${p(h.filter((x) => x.outcome === "orphan").length, h.length).padStart(6)}`,
    ].join("  "),
  );
}
