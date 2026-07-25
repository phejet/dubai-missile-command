import { probeGame, type HornetRec, type ProbeResult } from "./probe";
const runs: ProbeResult[] = [];
const TAG = process.argv[2] ?? "loiter";
for (let i = 0; i < 20; i++)
  runs.push(
    probeGame({ label: TAG, seed: 70000 + i, acquired: ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"] }),
  );
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const loit = h.filter((x) => x.everLoitered);
const react = loit.filter((x) => x.reactivations > 0);
const waits = react.filter((x) => x.firstWait >= 0).map((x) => x.firstWait);
console.log(`\n═══ ${TAG} — SkyMesh loiter behaviour (20 games) ═══`);
console.log(
  `  hornets: ${h.length}   score=${(runs.reduce((a, b) => a + b.score, 0) / runs.length).toFixed(0)}   hit=${p(h.filter((x) => x.outcome === "detonate").length, h.length)}`,
);
console.log(`  entered loiter at least once : ${p(loit.length, h.length)} (${loit.length})`);
console.log(`  …of those, REACTIVATED       : ${p(react.length, loit.length)}  <- new threat appeared`);
console.log(
  `  …median wait before 1st reactivation: ${med(waits).toFixed(0)} ticks (${(med(waits) / 60).toFixed(2)}s)`,
);
console.log(`     reactivated within  60t (1s): ${p(waits.filter((w) => w <= 60).length, waits.length)}`);
console.log(`     reactivated within 120t (2s): ${p(waits.filter((w) => w <= 120).length, waits.length)}`);
console.log(`     reactivated within 300t (5s): ${p(waits.filter((w) => w <= 300).length, waits.length)}`);
console.log(
  `  mean loiter stints per hornet: ${(loit.reduce((a, b) => a + b.loiterEntries, 0) / loit.length).toFixed(2)}`,
);
console.log(`  median total ticks spent loitering: ${med(loit.map((x) => x.loiterTicks)).toFixed(0)}`);
console.log(
  `  KILLS that happened after a loiter: ${p(h.filter((x) => x.killedAfterLoiter).length, h.filter((x) => x.outcome === "detonate").length)} of all kills`,
);
