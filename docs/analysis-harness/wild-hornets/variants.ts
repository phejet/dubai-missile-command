import { probeGame, type ProbeResult } from "./probe";

const CONFIGS: { label: string; acquired: string[] }[] = [
  { label: "1pad ", acquired: ["wildHornetsLeft"] },
  { label: "2pad ", acquired: ["wildHornetsLeft", "wildHornetsRight"] },
  { label: "2+mesh", acquired: ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"] },
];
const GAMES = parseInt(process.argv[2] ?? "20");
const SEED_BASE = parseInt(process.argv[3] ?? "70000");
const TAG = process.argv[4] ?? "base";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

for (const cfg of CONFIGS) {
  const runs: ProbeResult[] = [];
  for (let i = 0; i < GAMES; i++)
    runs.push(probeGame({ label: cfg.label, seed: SEED_BASE + i, acquired: cfg.acquired }));
  const h = runs.flatMap((r) => r.hornets);
  const det = h.filter((x) => x.outcome === "detonate").length;
  const fuel = h.filter((x) => x.outcome === "fuel").length;
  const orph = h.filter((x) => x.outcome === "orphan").length;
  const unreach = h.filter((x) => x.launchDist > x.maxRange).length;
  const trail = h.filter((x) => x.minDist < 150);
  const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
  console.log(
    [
      TAG.padEnd(9),
      cfg.label,
      `score=${mean(runs.map((r) => r.score))
        .toFixed(0)
        .padStart(6)}`,
      `wave=${mean(runs.map((r) => r.wave)).toFixed(2)}`,
      `launched=${(h.length / runs.length).toFixed(0).padStart(3)}/run`,
      `hit=${p(det, h.length).padStart(4)}%`,
      `hits/run=${(det / runs.length).toFixed(1).padStart(5)}`,
      `fuel=${p(fuel, h.length).padStart(4)}%`,
      `orphan=${p(orph, h.length).padStart(4)}%`,
      `unreachable=${p(unreach, h.length).padStart(4)}%`,
      `trailAtCPA=${p(trail.filter((x) => x.trailingAtCpa).length, trail.length).padStart(4)}%`,
    ].join("  "),
  );
}
