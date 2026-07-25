import { probeGame, type HornetRec, type ProbeResult } from "./probe";
const runs: ProbeResult[] = [];
for (let i = 0; i < 20; i++)
  runs.push(
    probeGame({ label: "m", seed: 70000 + i, acquired: ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"] }),
  );
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const fuel = h.filter((x) => x.outcome === "fuel");
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");
console.log(`\nSkyMesh fuel-outs: ${fuel.length} (${p(fuel.length, h.length)} of ${h.length} hornets)`);
console.log(
  `  had a LIVE target when fuel ran out : ${p(fuel.filter((x) => x.hadTargetAtDeath).length, fuel.length)}  <- genuinely failed to catch it`,
);
console.log(
  `  had NO target (drifting, out of work): ${p(fuel.filter((x) => !x.hadTargetAtDeath).length, fuel.length)}  <- nothing left to hunt`,
);
console.log(`  mean retargets before dying: ${(fuel.reduce((a, b) => a + b.retargets, 0) / fuel.length).toFixed(2)}`);
console.log(
  `  median closest approach ever: ${[...fuel.map((x) => x.minDist)].sort((a, b) => a - b)[Math.floor(fuel.length / 2)].toFixed(0)}px`,
);
