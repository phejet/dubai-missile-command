import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initGame, buildingFixInternals, spawnDroneOfType } from "../../src/game-sim";
import { getGameplayBuildingBounds, getRng, setRng } from "../../src/game-logic";

type SavedBomb = {
  id: number;
  type: string;
  target: number;
  start: { x: number; y: number; vx: number; vy: number };
  initialRayHits: boolean;
};
type SavedRun = { cohort: string; status: string; studyLabel: string; audit: { records: SavedBomb[] } };
const root = "operator-results/building-audit-20260919";
const input = readFileSync(root + "/observed-results.json");
const inputHash = createHash("sha256").update(input).digest("hex");
const runs = (JSON.parse(input.toString()) as SavedRun[]).filter(
  (r) => r.cohort === "human-study" && r.status === "verified",
);
const results = [];
for (const r of runs)
  for (const bomb of r.audit.records.filter((t) => t.type === "bomb")) {
    setRng(() => 0.5);
    const g = initGame();
    g.burjAlive = false; // Isolate selected-building arrival from other collision candidates.
    g.launcherHP = [0, 0];
    g.defenseSites = [];
    g.buildings.forEach((b, i) => (b.alive = i === bomb.target));
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-bomber");
    const d = g.drones[0];
    Object.assign(d, {
      x: bomb.start.x,
      y: bomb.start.y,
      waypoints: [
        { x: bomb.start.x, y: bomb.start.y },
        { x: bomb.start.x, y: bomb.start.y },
      ],
      pathIndex: 0,
      bombIndices: [1],
      bombsDropped: 0,
    });
    const speedSample = (bomb.start.vy - 2.4) / 1.6;
    let draws = 0;
    setRng(() => {
      draws++;
      return speedSample;
    });
    buildingFixInternals.updateDrones(g, getRng(), 1);
    assert.equal(draws, 2, "Target choice and fall speed consume exactly the existing two draws");
    const actual = g.missiles[0];
    assert(actual, "Bomb spawned");
    assert.equal(actual.vy, bomb.start.vy, "Original vertical speed preserved");
    const bounds = getGameplayBuildingBounds(g.buildings[bomb.target]);
    const roofX = actual.x + (actual.vx * (bounds.top - actual.y)) / actual.vy;
    assert(Math.abs(roofX - (bounds.left + bounds.right) / 2) < 1e-9);
    const steps = Math.ceil((bounds.top - actual.y) / actual.vy) + 1;
    let ticks = 0;
    while (actual.alive && ticks < steps) {
      buildingFixInternals.updateMissiles(g, 1);
      ticks++;
    }
    assert(!actual.alive && !g.buildings[bomb.target].alive, "Actual endpoint collision destroys selected building");
    results.push({
      run: r.studyLabel,
      id: bomb.id,
      previouslyMissed: !bomb.initialRayHits,
      roofError: roofX - (bounds.left + bounds.right) / 2,
      ticks,
    });
  }
setRng(Math.random);
assert.equal(results.length, 1238);
assert.equal(results.filter((r) => r.previouslyMissed).length, 132);
assert.equal(
  createHash("sha256")
    .update(readFileSync(root + "/observed-results.json"))
    .digest("hex"),
  inputHash,
);
const result = {
  launches: results.length,
  previouslyMisaligned: 132,
  hits: results.length,
  inputSha256: inputHash,
  simulationSha256: createHash("sha256").update(readFileSync("src/game-sim.ts")).digest("hex"),
  results,
};
writeFileSync(root + "/fix/results.json", JSON.stringify(result, null, 2));
console.log(
  "All 1,238 recorded launches hit their selected building in isolated real updates; all 132 former misses corrected. Vertical speeds and two RNG draws preserved; historical ledger unchanged.",
);
