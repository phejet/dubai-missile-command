import { setRng, fireInterceptor } from "../src/game-logic.js";
import { initGame, update, buyUpgrade, closeShop, fireEmp, repairSite, repairLauncher } from "../src/game-sim.js";
import { mulberry32 } from "../src/headless/rng.js";
import { readFileSync } from "fs";

const replayFile = process.argv[2];
if (!replayFile) {
  console.error("Usage: node analyze-hornets.js <replay.json>");
  process.exit(1);
}

const replayData = JSON.parse(readFileSync(replayFile, "utf8"));
const { seed, actions } = replayData;

const rng = mulberry32(seed);
setRng(rng);
const g = initGame();

let actionIdx = 0;
let tick = 0;

// Track hornets and explosions
const hornetEvents = [];

for (let step = 0; step < 100000; step++) {
  if (g.state === "gameover") break;

  if (g.state === "shop") {
    let shopAction = null;
    while (actionIdx < actions.length) {
      if (actions[actionIdx].type === "shop") {
        shopAction = actions[actionIdx];
        actionIdx++;
        break;
      }
      actionIdx++;
    }
    if (shopAction) {
      for (const key of shopAction.bought) {
        if (key.startsWith("repair_launcher_")) repairLauncher(g, parseInt(key.split("_")[2]));
        else if (key.startsWith("repair_")) repairSite(g, key.replace("repair_", ""));
        else buyUpgrade(g, key);
      }
    }
    closeShop(g);
    continue;
  }

  while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
    const action = actions[actionIdx];
    if (action.type === "fire") fireInterceptor(g, action.x, action.y);
    else if (action.type === "emp") fireEmp(g, null);
    actionIdx++;
  }

  // Snapshot hornets before update
  const hornetsBefore = (g.hornets || []).map((h) => ({
    alive: h.alive,
    x: h.x,
    y: h.y,
    targetAlive: h.targetRef?.alive,
    targetX: h.targetRef?.x,
    targetY: h.targetRef?.y,
    targetType: h.targetRef?.type || h.targetRef?.subtype || "unknown",
    targetHealth: h.targetRef?.health,
    blastRadius: h.blastRadius,
  }));

  // Snapshot threats before update
  const threatsBefore = {
    missiles: g.missiles.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, type: m.type, health: m.health })),
    drones: g.drones.filter((d) => d.alive).map((d) => ({ x: d.x, y: d.y, subtype: d.subtype, health: d.health })),
  };

  // Count explosions before
  const explosionCountBefore = g.explosions.length;

  update(g, 1, null);

  // Check which hornets died this tick
  const hornetsAfter = g.hornets || [];
  for (let i = 0; i < hornetsBefore.length; i++) {
    const before = hornetsBefore[i];
    // Find if this hornet is now dead (detonated)
    if (before.alive) {
      // Check if hornet no longer exists or is dead
      const after = hornetsAfter[i];
      const died = !after || !after.alive;
      if (died) {
        // New explosions created this tick
        const newExplosions = g.explosions.slice(explosionCountBefore);
        // Find the hornet's explosion (closest to hornet's target position)
        let hornetExplosion = null;
        for (const ex of newExplosions) {
          const d = Math.sqrt((ex.x - before.targetX) ** 2 + (ex.y - before.targetY) ** 2);
          if (d < 50) {
            hornetExplosion = ex;
            break;
          }
        }

        // Check what threats died this tick
        const threatsAfterUpdate = {
          missiles: g.missiles.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, type: m.type, health: m.health })),
          drones: g.drones
            .filter((d) => d.alive)
            .map((d) => ({ x: d.x, y: d.y, subtype: d.subtype, health: d.health })),
        };

        const missilesDied = threatsBefore.missiles.length - threatsAfterUpdate.missiles.length;
        const dronesDied = threatsBefore.drones.length - threatsAfterUpdate.drones.length;
        const totalKills = missilesDied + dronesDied;

        // Check if the specific target is still alive
        // The targetRef is a direct reference so check current state
        const targetStillAlive =
          before.targetAlive &&
          (g.missiles.some(
            (m) => m.alive && Math.abs(m.x - before.targetX) < 2 && Math.abs(m.y - before.targetY) < 2,
          ) ||
            g.drones.some((d) => d.alive && Math.abs(d.x - before.targetX) < 2 && Math.abs(d.y - before.targetY) < 2));

        hornetEvents.push({
          tick,
          hornetPos: { x: Math.round(before.x), y: Math.round(before.y) },
          targetPos: { x: Math.round(before.targetX), y: Math.round(before.targetY) },
          targetType: before.targetType,
          targetHealth: before.targetHealth,
          blastRadius: before.blastRadius,
          hadExplosion: !!hornetExplosion,
          totalKillsThisTick: totalKills,
          targetSurvived: targetStillAlive,
          wasted: totalKills === 0,
        });
      }
    }
  }

  tick++;
}

setRng(Math.random);

console.log(`\n=== HORNET ANALYSIS: seed=${seed} ===`);
console.log(`Total hornet detonations: ${hornetEvents.length}`);

const wasted = hornetEvents.filter((e) => e.wasted);
const targetSurvived = hornetEvents.filter((e) => e.targetSurvived);

console.log(`Kills: ${hornetEvents.filter((e) => !e.wasted).length}`);
console.log(`Wasted (no kills): ${wasted.length}`);
console.log(`Target survived detonation: ${targetSurvived.length}`);

console.log(`\n--- ALL DETONATIONS ---`);
for (const e of hornetEvents) {
  const status = e.wasted ? "MISS" : e.targetSurvived ? "HIT (target survived)" : "KILL";
  console.log(
    `  [tick ${String(e.tick).padStart(5)}] ${status} | target: ${e.targetType} hp=${e.targetHealth} at (${e.targetPos.x},${e.targetPos.y}) | hornet at (${e.hornetPos.x},${e.hornetPos.y}) | blast=${e.blastRadius} | kills this tick: ${e.totalKillsThisTick}`,
  );
}

if (wasted.length > 0) {
  console.log(`\n--- WASTED DETONATIONS (potential bugs) ---`);
  for (const e of wasted) {
    const dist = Math.sqrt((e.hornetPos.x - e.targetPos.x) ** 2 + (e.hornetPos.y - e.targetPos.y) ** 2);
    console.log(
      `  [tick ${e.tick}] hornet (${e.hornetPos.x},${e.hornetPos.y}) -> target ${e.targetType} (${e.targetPos.x},${e.targetPos.y}) dist=${dist.toFixed(1)} blast=${e.blastRadius} hp=${e.targetHealth}`,
    );
  }
}
