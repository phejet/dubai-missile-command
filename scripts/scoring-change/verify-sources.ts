import assert from "node:assert/strict";
import { runGame } from "../../src/headless/sim-runner";
import { createReplayRunner } from "../../src/replay";
import { AUTOMATED_KILL_SOURCES, COL } from "../../src/game-logic";
import { CURRENT_REPLAY_VERSION } from "../../src/replay-version";
import type { Explosion, KillSource, ReplayData, Threat } from "../../src/types";

// Independent checks of the player-only scoring implementation on real bot games:
// 1. Every root explosion's new `source` agrees with the weapon colour its call site
//    already used before this change (colour is set independently of `source`).
// 2. Every chain explosion inherits its root's source.
// 3. Every frozen `_holdEligible` agrees with an oracle rebuilt from observed threat
//    death ticks and the tick the blast's damage window closed (alpha <= 0.2).
const COLOUR_SOURCES: Record<string, KillSource[]> = {
  [COL.interceptor]: ["player"],
  "#aaccff": ["f15"],
  [COL.hornet]: ["hornets"],
  [COL.roadrunner]: ["roadrunner"],
  [COL.patriot]: ["patriot"],
  [COL.flare]: ["flare"],
  [COL.phalanx]: ["phalanx"],
  "#ff2200": ["ironBeam", "impact"], // COL.laser is also the Burj-destroyed blast colour
  "#ff0000": ["friendlyFire"],
  "#ff5500": ["impact"],
  "#ff4400": ["impact"],
  "#ff6600": ["impact"],
  "#ffb36b": ["impact"],
  [COL.mirv]: ["impact"],
};

interface Seen {
  ex: Explosion;
  closeTick?: number;
  holdEligible?: boolean;
}
const totals = { explosions: 0, chains: 0, bySource: {} as Record<string, number>, holds: 0, misses: 0 };
const holdCheck = { agreed: 0, sameTickAmbiguous: 0, automationStolen: 0 };

// Random draft runs, plus bootstrapped runs so the bot also owns EMP, F-15 and Phalanx.
const RUNS: { seed: number; bootstrap?: ReplayData["bootstrap"] }[] = [
  ...Array.from({ length: 24 }, (_, i) => ({ seed: 1000 + i * 7919 })),
  ...["emp", "f15", "phalanx"].flatMap((upgrade) =>
    [11, 22, 33].map((seed) => ({ seed, bootstrap: { startWave: 4, acquiredUpgrades: [upgrade] } })),
  ),
];
const killsBySource: Record<string, number> = {};
for (const { seed, bootstrap } of RUNS) {
  const result = runGame(null, { seed, record: true, draftMode: true, maxTicks: 30000, bootstrap });
  const replay: ReplayData = {
    version: CURRENT_REPLAY_VERSION,
    seed,
    actions: result.actions!,
    initialState: result.initialState!,
    draftMode: true,
    ...(bootstrap ? { bootstrap } : {}),
  };
  const runner = createReplayRunner(replay);
  const g = runner.init();
  const seen = new Map<number, Seen>();
  const deaths = new Map<Threat, number>();
  let live = new Set<Threat>();
  let guard = 0;
  while (!runner.isFinished() && runner.getTick() < result.ticks) {
    assert(++guard < 200000, "loop guard");
    if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
    else if (runner.isShopPaused()) runner.resumeFromShop();
    else runner.step();
    const tick = runner.getTick();
    const now = new Set<Threat>([...g.missiles, ...g.drones].filter((t) => t.alive));
    for (const t of live) if (!now.has(t) && !deaths.has(t)) deaths.set(t, tick);
    live = now;
    for (const ex of g.explosions) {
      let s = seen.get(ex.id);
      if (!s) {
        s = { ex };
        seen.set(ex.id, s);
        totals.explosions++;
        totals.bySource[ex.source] = (totals.bySource[ex.source] ?? 0) + 1;
        if (ex.rootExplosionId !== null) {
          totals.chains++;
          const root = seen.get(ex.rootExplosionId);
          assert(root, `seed ${seed}: chain ${ex.id} without an observed root`);
          assert.equal(ex.source, root.ex.source, `seed ${seed}: chain source differs from root`);
        } else {
          const allowed = COLOUR_SOURCES[ex.color];
          assert(allowed, `seed ${seed}: unmapped explosion colour ${ex.color} (source ${ex.source})`);
          assert(allowed.includes(ex.source), `seed ${seed}: colour ${ex.color} labelled ${ex.source}`);
        }
      }
      if (s.closeTick === undefined && ex.alpha <= 0.2) s.closeTick = tick;
      if (ex._holdEligible !== undefined) s.holdEligible = ex._holdEligible;
    }
  }
  runner.cleanup();
  for (const t of deaths.keys()) if (t.killedBy) killsBySource[t.killedBy] = (killsBySource[t.killedBy] ?? 0) + 1;

  for (const { ex, closeTick, holdEligible } of seen.values()) {
    if (!ex.playerCaused || ex.rootExplosionId !== null || (ex.kills ?? 0) > 0 || closeTick === undefined) continue;
    if (ex.source === "flare") {
      totals.holds++;
      continue;
    }
    if (!ex.intendedTargets) {
      assert.notEqual(holdEligible, true, `seed ${seed}: hold without intended targets`);
      totals.misses++;
      continue;
    }
    const stolen = ex.intendedTargets.filter((t) => t.killedBy && AUTOMATED_KILL_SOURCES.has(t.killedBy));
    if (stolen.some((t) => deaths.get(t) === closeTick)) {
      holdCheck.sameTickAmbiguous++;
      continue;
    }
    const expected = stolen.some((t) => (deaths.get(t) ?? Infinity) < closeTick);
    assert.equal(holdEligible ?? false, expected, `seed ${seed}: hold decision for explosion ${ex.id}`);
    holdCheck.agreed++;
    if (expected) {
      holdCheck.automationStolen++;
      totals.holds++;
    } else totals.misses++;
  }
}
assert(holdCheck.automationStolen > 0, "No automation-stolen hold exercised");
// Phalanx is hidden from the draft and its 100px turret range rarely engages in bot play;
// src/player-scoring.test.ts covers its real turret path instead.
for (const source of ["player", "f15", "emp", "flare", "hornets", "roadrunner", "patriot", "ironBeam"])
  assert((killsBySource[source] ?? 0) > 0, `no ${source} kill exercised`);
console.log({ runs: RUNS.length, ...totals, killsBySource, holdCheck, result: "source and hold checks passed" });
