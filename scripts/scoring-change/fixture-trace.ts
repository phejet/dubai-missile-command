import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReplayRunner } from "../../src/replay";
import { getRngState } from "../../src/game-logic";
import type { ReplayData } from "../../src/types";

const dir = "operator-results/scoring-change-20260919";
mkdirSync(dir, { recursive: true });
const traces = [];
for (const file of readdirSync("public/replays")
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const data: ReplayData = JSON.parse(readFileSync(`public/replays/${file}`, "utf8"));
  const runner = createReplayRunner(data);
  const g = runner.init();
  const boundaries: unknown[] = [];
  const hash = createHash("sha256");
  const sample = () => ({
    tick: runner.getTick(),
    wave: g.wave,
    state: g.state,
    rng: getRngState(),
    missiles: g.missiles.map(({ x, y, alive, type }) => ({ x, y, alive, type })),
    drones: g.drones.map(({ x, y, alive, type }) => ({ x, y, alive, type })),
    burjHealth: g.burjHealth,
    burjAlive: g.burjAlive,
    buildings: g.buildings,
    launcherHP: g.launcherHP,
    defenseSites: g.defenseSites,
    upgrades: g.upgrades,
    stats: { ...g.stats, maxCombo: undefined },
    summaries: g._waveSummaries?.map((s) => ({ ...s, scoreEarned: undefined, maxCombo: undefined })),
  });
  boundaries.push(sample());
  let iterations = 0;
  while (!runner.isFinished()) {
    assert(++iterations < 500000, `${file}: loop guard`);
    const wave = g.wave,
      state = g.state;
    if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
    else if (runner.isShopPaused()) runner.resumeFromShop();
    else runner.step();
    const value = sample();
    hash.update(JSON.stringify(value));
    if (wave !== g.wave || state !== g.state) boundaries.push(value);
  }
  traces.push({ file, boundaries, final: sample(), gameplayHash: hash.digest("hex") });
  runner.cleanup();
}
const compare = process.argv.includes("--compare");
writeFileSync(`${dir}/fixture-${compare ? "after" : "baseline"}.json`, JSON.stringify(traces, null, 2) + "\n");
if (compare)
  assert.deepEqual(
    JSON.parse(JSON.stringify(traces)),
    JSON.parse(readFileSync(`${dir}/fixture-baseline.json`, "utf8")),
  );
console.log(
  `${traces.length} fixture traces ${compare ? "match old gameplay exactly" : "captured before scoring changes"}`,
);
