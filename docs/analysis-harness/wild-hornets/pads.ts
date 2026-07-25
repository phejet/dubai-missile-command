import { probeGame, type HornetRec, type ProbeResult } from "./probe";

const GAMES = parseInt(process.argv[2] ?? "20");
const SEED_BASE = parseInt(process.argv[3] ?? "70000");
const TAG = process.argv[4] ?? "base";
const ACQ =
  (process.argv[5] ?? "2pad") === "mesh"
    ? ["wildHornetsLeft", "wildHornetsRight", "skyHunterMesh"]
    : ["wildHornetsLeft", "wildHornetsRight"];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "n/a");

const runs: ProbeResult[] = [];
for (let i = 0; i < GAMES; i++) runs.push(probeGame({ label: TAG, seed: SEED_BASE + i, acquired: ACQ }));
const h: HornetRec[] = runs.flatMap((r) => r.hornets);
const det = (xs: HornetRec[]) => xs.filter((x) => x.outcome === "detonate").length;

console.log(`\n═══ ${TAG} (${ACQ.length === 3 ? "2 pads + SkyMesh" : "2 pads"}, ${GAMES} games) ═══`);
console.log(
  `  score=${mean(runs.map((r) => r.score)).toFixed(0)}  wave=${mean(runs.map((r) => r.wave)).toFixed(2)}  ` +
    `launched=${(h.length / runs.length).toFixed(0)}/run  hit=${p(det(h), h.length)}  ` +
    `orphan=${p(h.filter((x) => x.outcome === "orphan").length, h.length)}  ` +
    `fuel=${p(h.filter((x) => x.outcome === "fuel").length, h.length)}`,
);

console.log(`  ── magazines (independent per pad) ──`);
for (const side of ["left", "right"] as const) {
  const m = runs.map((r) => r.mag[side]);
  const ticks = m.reduce((a, b) => a + b.ticks, 0);
  console.log(
    `    ${side.padEnd(5)} launches=${(m.reduce((a, b) => a + b.launches, 0) / runs.length).toFixed(1)}/run  ` +
      `mean ammo=${(m.reduce((a, b) => a + b.ammoSum, 0) / ticks).toFixed(2)}/2  ` +
      `dry(ammo=0)=${p(
        m.reduce((a, b) => a + b.dryTicks, 0),
        ticks,
      )}  ` +
      `AT-CAP(no reload progress)=${p(
        m.reduce((a, b) => a + b.capTicks, 0),
        ticks,
      )}  ` +
      `ready-but-idle=${p(
        m.reduce((a, b) => a + b.readyTicks, 0),
        ticks,
      )}`,
  );
}

console.log(`  ── cross-side launches (pad firing into the OTHER half) ──`);
const cross = h.filter((x) => x.crossSide);
const same = h.filter((x) => !x.crossSide);
console.log(`    cross-side: ${p(cross.length, h.length)} (${cross.length})   same-side: ${p(same.length, h.length)}`);
for (const side of ["left", "right"] as const) {
  const pad = h.filter((x) => x.pad === side);
  console.log(
    `      ${side.padEnd(5)} pad: ${p(pad.filter((x) => x.crossSide).length, pad.length)} of its launches went cross-side`,
  );
}
console.log(`  ── was the cross-launch justified? ──`);
const crossWithLocal = cross.filter((x) => x.localHalfHadThreats);
console.log(
  `    cross-launches fired while own half DID have live threats: ${p(crossWithLocal.length, cross.length)} (${crossWithLocal.length})`,
);
console.log(
  `      of those, own-half unassigned count was 0 (sim's gate): ${p(crossWithLocal.filter((x) => x.localHalfUnassigned === 0).length, crossWithLocal.length)}`,
);
console.log(`  ── outcome: cross-side vs same-side ──`);
for (const [name, xs] of [
  ["same", same],
  ["cross", cross],
] as const) {
  const fuelN = xs.filter((x) => x.outcome === "fuel").length;
  console.log(
    `    ${name.padEnd(5)} n=${String(xs.length).padStart(4)}  hit=${p(det(xs), xs.length).padStart(6)}  ` +
      `fuel=${p(fuelN, xs.length).padStart(6)}  ` +
      `medLaunchDist=${[...xs.map((x) => x.launchDist)].sort((a, b) => a - b)[Math.floor(xs.length / 2)]?.toFixed(0) ?? "-"}px  ` +
      `unreachable=${p(xs.filter((x) => x.launchDist > x.maxRange).length, xs.length)}`,
  );
}
