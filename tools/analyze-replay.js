import { setRng, fireInterceptor } from "../src/game-logic.js";
import {
  initGame,
  update,
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  repairSite,
  repairLauncher,
  fireEmp,
} from "../src/game-sim.js";
import { mulberry32 } from "../src/headless/rng.js";
import { buildReplayCheckpoint } from "../src/replay-debug.js";
import { readFileSync } from "fs";

const replayFile = process.argv[2];
if (!replayFile) {
  console.error("Usage: node analyze-replay.js <replay.json>");
  process.exit(1);
}

const replayData = JSON.parse(readFileSync(replayFile, "utf8"));
const { seed, actions, draftMode } = replayData;
const checkpointsByTick = new Map((replayData.checkpoints || []).map((checkpoint) => [checkpoint.tick, checkpoint]));

const rng = mulberry32(seed);
setRng(rng);
const g = initGame();
if (draftMode) g._draftMode = true;

let actionIdx = 0;
let tick = 0;
const maxTicks = 100000;
const events = [];
let firstCheckpointMismatch = null;

function log(msg) {
  events.push({ tick, msg });
}

function compareCheckpoint(checkpointTick) {
  if (firstCheckpointMismatch) return;
  const expected = checkpointsByTick.get(checkpointTick);
  if (!expected) return;

  const actual = buildReplayCheckpoint(g, checkpointTick);
  if (actual.hash !== expected.hash) {
    firstCheckpointMismatch = {
      tick: checkpointTick,
      expected,
      actual,
    };
    log(`CHECKPOINT MISMATCH at tick ${checkpointTick}: recorded hash=${expected.hash}, replay hash=${actual.hash}`);
  }
}

// Track state for change detection
let prevWave = g.wave;
let prevBurjHP = g.burjHealth;
let prevLauncherHP = [...g.launcherHP];

compareCheckpoint(0);

for (let step = 0; step < maxTicks; step++) {
  if (g.state === "gameover") {
    log(`GAME OVER — score=${g.score} wave=${g.wave}`);
    if (!g.burjAlive) log("Cause: Burj Khalifa destroyed");
    break;
  }

  if (g.state === "shop") {
    // Don't increment tick during shop — matches browser behavior
    if (actionIdx < actions.length && actions[actionIdx].tick === tick && actions[actionIdx].type === "shop") {
      const action = actions[actionIdx];
      for (const key of action.bought) {
        if (key.startsWith("repair_launcher_")) {
          repairLauncher(g, parseInt(key.split("_")[2]));
        } else if (key.startsWith("repair_")) {
          repairSite(g, key.replace("repair_", ""));
        } else if (draftMode) {
          buyDraftUpgrade(g, key);
        } else {
          buyUpgrade(g, key);
        }
      }
      log(`SHOP: bought [${action.bought.join(", ")}] — score after: ${g.score}`);
      actionIdx++;
    }
    closeShop(g);
    continue;
  }

  // Process actions at this tick
  while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
    const action = actions[actionIdx];
    if (action.type === "fire") {
      const result = fireInterceptor(g, action.x, action.y);
      if (!result) log(`FIRE FAILED at (${Math.round(action.x)}, ${Math.round(action.y)}) — no ammo?`);
    } else if (action.type === "emp") {
      fireEmp(g, null);
      log("EMP FIRED");
    }
    actionIdx++;
  }

  // Advance simulation
  update(g, 1, (type, data) => {
    if (type === "sfx") {
      if (data.name === "mirvIncoming") log("MIRV spawned!");
      if (data.name === "mirvSplit") log("MIRV SPLIT into warheads!");
      if (data.name === "planeIncoming") log("F-15 warning");
    }
  });
  compareCheckpoint(tick + 1);

  // Detect state changes
  if (g.wave !== prevWave) {
    log(`Wave ${prevWave} → ${g.wave}`);
    prevWave = g.wave;
  }
  if (g.burjHealth !== prevBurjHP) {
    log(`Burj HP: ${prevBurjHP} → ${g.burjHealth}`);
    prevBurjHP = g.burjHealth;
  }
  for (let i = 0; i < 3; i++) {
    if (g.launcherHP[i] !== prevLauncherHP[i]) {
      log(`Launcher ${i} HP: ${prevLauncherHP[i]} → ${g.launcherHP[i]}${g.launcherHP[i] <= 0 ? " DESTROYED" : ""}`);
      prevLauncherHP[i] = g.launcherHP[i];
    }
  }

  // Track active threats every 100 ticks
  if (tick % 200 === 0 && tick > 0) {
    const aliveMissiles = g.missiles.filter((m) => m.alive);
    const aliveDrones = g.drones.filter((d) => d.alive);
    const aliveInterceptors = g.interceptors.filter((i) => i.alive);
    if (aliveMissiles.length > 0 || aliveDrones.length > 0) {
      const mirvs = aliveMissiles.filter((m) => m.type === "mirv");
      const warheads = aliveMissiles.filter((m) => m.type === "mirv_warhead");
      const bombs = aliveMissiles.filter((m) => m.type === "bomb");
      const regular = aliveMissiles.filter((m) => !m.type || m.type === "missile");
      const jets = aliveDrones.filter((d) => d.subtype === "shahed238");
      const slowDrones = aliveDrones.filter((d) => d.subtype === "shahed136");

      let parts = [];
      if (regular.length) parts.push(`${regular.length} missiles`);
      if (bombs.length) parts.push(`${bombs.length} bombs`);
      if (mirvs.length) parts.push(`${mirvs.length} MIRVs`);
      if (warheads.length) parts.push(`${warheads.length} warheads`);
      if (slowDrones.length) parts.push(`${slowDrones.length} drones`);
      if (jets.length) parts.push(`${jets.length} jet drones`);
      parts.push(`${aliveInterceptors.length} interceptors`);
      parts.push(`ammo: ${g.ammo.join("|")}`);
      log(`STATUS: ${parts.join(", ")}`);
    }
  }

  // Detect defense site destruction
  if (g.defenseSites) {
    for (const site of g.defenseSites) {
      if (!site.alive && !site._logged) {
        log(`Defense site "${site.key}" DESTROYED`);
        site._logged = true;
      }
    }
  }

  tick++;
}

// Print timeline
console.log(`\n=== REPLAY ANALYSIS: seed=${seed} ===`);
console.log(`Final: score=${g.score} wave=${g.wave} ticks=${tick}`);
console.log(`Stats: ${JSON.stringify(g.stats)}`);
if (firstCheckpointMismatch) {
  console.log(`First checkpoint mismatch: tick=${firstCheckpointMismatch.tick}`);
  console.log(`  recorded: ${JSON.stringify(firstCheckpointMismatch.expected)}`);
  console.log(`  replayed: ${JSON.stringify(firstCheckpointMismatch.actual)}`);
} else if (replayData.checkpoints?.length) {
  console.log(`Checkpoint comparison: all ${replayData.checkpoints.length} checkpoints matched`);
}
console.log(`\n--- TIMELINE ---`);
for (const e of events) {
  console.log(`  [${String(e.tick).padStart(5)}] ${e.msg}`);
}

// Summary
console.log(`\n--- SUMMARY ---`);
const totalAmmo = g.ammo.reduce((s, a) => s + a, 0);
console.log(`Ammo remaining: ${g.ammo.join("|")} (total: ${totalAmmo})`);
console.log(`Launchers: ${g.launcherHP.map((hp, i) => `L${i}=${hp}HP`).join(" ")}`);
console.log(`Burj: ${g.burjAlive ? `alive (${g.burjHealth}HP)` : "DESTROYED"}`);
console.log(
  `Upgrades:`,
  Object.entries(g.upgrades)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:L${v}`)
    .join(", ") || "none",
);
if (g.defenseSites) {
  const dead = g.defenseSites.filter((s) => !s.alive);
  if (dead.length) console.log(`Destroyed sites: ${dead.map((s) => s.key).join(", ")}`);
}

setRng(Math.random);
