import assert from "node:assert/strict";
import { rescore } from "./rescoring-rules.mjs";
const kill = (shotId, source = "player", base = 20, combo = 10, contributors = [{ source, damage: 1 }], wave = 1) => ({
  type: "reward",
  kind: "kill",
  wave,
  shotId,
  source,
  base,
  combo,
  uplift: base * (combo - 1),
  amount: base * combo,
  contributors,
});
const totals = (events) => rescore(events)[0].scores;
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
check("manual combo stays; automated combo removed", () => {
  const s = totals([kill(1), kill(null, "beam")]);
  assert.equal(s.A1.net, 220);
  assert.equal(s.B1.net, 90);
  assert.equal(s.C1.net, 60);
});
check("empty shots never directly earn", () => {
  const events = [kill(1)];
  assert.deepEqual(totals(events), totals([...events, { type: "shot", shotId: 2, wave: 1 }]));
});
check("four singles versus one cluster", () => {
  assert.equal(totals([1, 2, 3, 4].map((s) => kill(s))).B1.net, 280);
  assert.equal(totals([1, 1, 1, 1].map((s) => kill(s))).B1.net, 430);
});
check("cap makes splitting large clusters profitable on paper", () => {
  assert.equal(totals(Array.from({ length: 8 }, () => kill(1))).B1.net, 510);
  assert.equal(totals(Array.from({ length: 8 }, (_, i) => kill(i < 4 ? 1 : 2))).B1.net, 860);
});
check("credit follows damage rather than last-hit identity", () => {
  const contributors = [
    { source: "player", damage: 1 },
    { source: "beam", damage: 3 },
  ];
  const a = totals([kill(1, "player", 40, 10, contributors)]),
    b = totals([kill(null, "beam", 40, 10, contributors)]);
  assert.equal(a.C1.net, 50);
  assert.equal(b.C1.net, 50);
  assert.notEqual(a.A1.net, b.A1.net);
});
check("contribution saturation removes further manual premium", () => {
  assert.equal(totals([kill(1), kill(2)]).C1.net, 60);
  assert.equal(totals([kill(1), kill(null, "beam")]).C1.net, 60);
});
check("original bonuses, spending and friendly-fire retained", () => {
  const events = [
    kill(1),
    ...[
      ["wave_clear", 250],
      ["building_bonus", 100],
      ["spending", -200],
      ["friendly_fire", -500],
    ].map(([kind, amount]) => ({ type: "reward", kind, amount, wave: 1 })),
  ];
  const s = totals(events);
  assert.equal(s.A1.gross, 550);
  assert.equal(s.A1.net, -150);
});
check("nonmanual multi removed, manual multi kept only in A", () => {
  const s = totals([
    kill(1),
    { type: "reward", kind: "multi", source: "player", amount: 150, wave: 1 },
    { type: "reward", kind: "multi", source: "beam", amount: 350, wave: 1 },
  ]);
  assert.equal(s.A1.net, 350);
  assert.equal(s.B1.net, 70);
});
check("incremental shot bonus follows kill wave across boundary", () => {
  const w = rescore([kill(1), kill(1, "player", 20, 1, undefined, 2)]);
  assert.equal(w[0].scores.B1.net, 70);
  assert.equal(w[1].scores.B1.net, 120);
});
check("unresolved shot earns only observed kills", () => {
  assert.equal(totals([kill(1), { type: "shot_end", shotId: 1, wave: 1, status: "terminal_unresolved" }]).B1.net, 70);
});
check("missing damage and unknown score awards fail closed", () => {
  assert.throws(() => totals([kill(1, "player", 20, 1, [])]));
  assert.throws(() => totals([{ type: "reward", wave: 1, kind: "unknown", amount: 1 }]));
});
console.log(`${checks} independent rule cases passed.`);
