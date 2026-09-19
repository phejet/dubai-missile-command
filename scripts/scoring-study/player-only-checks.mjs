import assert from "node:assert/strict";
import { rescoreRun } from "./player-only-rules.mjs";

// Hand-worked Part Six rule cases. Each builder keeps the recorded C10 combo
// consistent so rescoreRun's reproduction assertions also exercise the ledger shape.
function ledger() {
  const events = [];
  let combo = 1,
    wave = 1;
  const api = {
    wave(n) {
      wave = n;
      return api;
    },
    kill(source, base = 20) {
      events.push({ type: "reward", kind: "kill", wave, source, base, combo, amount: base * combo });
      return api;
    },
    trigger(kills, source = "player") {
      const after = kills >= 1 ? Math.min(10, combo + 1) : 1;
      events.push({ type: "combo", wave, source, before: combo, after, reportedRootKills: kills });
      combo = after;
      return api;
    },
    reward(kind, amount, source = "unattributed") {
      events.push({ type: "reward", kind, wave, source, amount });
      return api;
    },
    shots(n) {
      for (let i = 0; i < n; i++) api.kill("player").trigger(1);
      return api;
    },
    events,
  };
  return api;
}
const total = (events, id) => rescoreRun(events).reduce((n, w) => n + w.scores[id], 0);
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}

check("automated kill pays today, nothing under P", () => {
  const { events } = ledger().shots(2).kill("hornets").kill("patriot");
  // Two interceptor kills at x1, x2; then combo 3: hornet 60 + patriot 60.
  assert.equal(total(events, "today|C10"), 20 + 40 + 120);
  assert.equal(total(events, "P|C10"), 60);
});
check("F-15, EMP and flare kills are player-owned and keep the combo", () => {
  const { events } = ledger().shots(2).kill("f15").kill("emp").kill("flare");
  assert.equal(total(events, "P|C10"), 20 + 40 + 3 * 60);
});
check("impact kills earn nothing under P, impact and automated multi-kills still pay", () => {
  const { events } = ledger().kill("impact").reward("multi", 150, "impact").reward("multi", 350, "roadrunner");
  assert.equal(total(events, "P|C10"), 500);
  assert.equal(total(events, "today|C10"), 520);
});
check("cash-out: the fifth productive shot scores at x5, then pays B and resets", () => {
  const { events } = ledger().shots(5).kill("player");
  // Multipliers x1..x5 (sum 15), cash-out 350, sixth kill at x1.
  assert.equal(total(events, "P|C5-350"), 20 * 15 + 350 + 20);
  assert.equal(total(events, "P|C5-0"), 20 * 15 + 20);
  // Today: x1..x5, then the sixth kill at x6.
  assert.equal(total(events, "P|C10"), 20 * 15 + 120);
  const w = rescoreRun(events)[0];
  assert.equal(w.combo["C5-350"].cashouts, 1);
  assert.equal(w.combo["C5-0"].cashouts, 1);
  assert.equal(w.combo.C10.cashouts, 0);
});
check("C10 holds at x10; C5 cycles", () => {
  const { events } = ledger().shots(20);
  // C10: x1..x10 then x10 for ten more shots = 55 + 100 multiplier units.
  assert.equal(total(events, "P|C10"), 20 * (55 + 100));
  // C5: four full cycles of x1..x5 and four cash-outs.
  assert.equal(total(events, "P|C5-150"), 20 * 60 + 4 * 150);
});
check("an empty trigger resets both machines without a bonus", () => {
  const { events } = ledger().shots(4).trigger(0).kill("player");
  assert.equal(total(events, "P|C5-700"), 20 * 10 + 20);
  assert.equal(total(events, "P|C10"), 20 * 10 + 20);
  const w = rescoreRun(events)[0];
  assert.equal(w.emptyResets.total, 1);
  assert.equal(w.emptyResets.fromFivePlus, 1);
});
check("empty flare explosion is counted as a flare reset", () => {
  const { events } = ledger().shots(2).trigger(0, "flare");
  const w = rescoreRun(events)[0];
  assert.equal(w.emptyResets.flare, 1);
  assert.equal(w.emptyResets.flareFromTwoPlus, 1);
});
check("combo carries across waves", () => {
  const { events } = ledger().shots(4).wave(2).kill("player");
  const [, w2] = rescoreRun(events);
  assert.equal(w2.scores["P|C10"], 100);
  assert.equal(w2.scores["P|C5-350"], 100);
});
check("survival bonuses and friendly fire are unchanged", () => {
  const { events } = ledger()
    .kill("roadrunner")
    .reward("wave_clear", 250)
    .reward("building_bonus", 800)
    .reward("friendly_fire", -500);
  assert.equal(total(events, "P|C5-350"), 550);
  assert.equal(total(events, "today|C10"), 570);
});
check("survival bonus splits into wave clear and buildings; building losses are counted", () => {
  const events = [
    ...ledger().wave(3).reward("wave_clear", 750).reward("building_bonus", 2700).events,
    { type: "asset_damage", wave: 3, buildings: 1, burj: 0, launcherHP: 0, sites: 0 },
  ];
  const [w] = rescoreRun(events);
  assert.equal(w.waveClear, 750);
  assert.equal(w.buildingBonus, 2700);
  assert.equal(w.bonuses, 3450);
  assert.equal(w.buildingsLost, 1);
});
check("ledger inconsistencies and unknown kinds fail closed", () => {
  assert.throws(() =>
    rescoreRun([{ type: "reward", kind: "kill", wave: 1, source: "player", base: 20, combo: 2, amount: 40 }]),
  );
  assert.throws(() =>
    rescoreRun([{ type: "reward", kind: "kill", wave: 1, source: "laser", base: 20, combo: 1, amount: 20 }]),
  );
  assert.throws(() => rescoreRun([{ type: "reward", kind: "spending", wave: 1, amount: -100 }]));
  assert.throws(() => rescoreRun([{ type: "combo", wave: 1, before: 1, after: 3, reportedRootKills: 1 }]));
});
console.log(`${checks} rule cases passed.`);
