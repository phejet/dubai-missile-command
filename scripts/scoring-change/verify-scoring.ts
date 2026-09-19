import assert from "node:assert/strict";
import { runGame } from "../../src/headless/sim-runner";
import { COMBO_CAP, COMBO_CASHOUT_BONUS, PLAYER_KILL_SOURCES, setScoreAuditSink } from "../../src/game-logic";

let automatedMulti = 0;
for (const seed of [42, 123, 456]) {
  let total = 0,
    entries = 0,
    cashouts = 0;
  setScoreAuditSink((entry) => {
    total += entry.amount;
    entries++;
    assert(entry.combo >= 1 && entry.combo < COMBO_CAP, "live combo must stay below the cap");
    if (entry.kind === "kill") {
      assert(entry.source !== undefined && entry.base !== undefined);
      assert.equal(entry.amount, PLAYER_KILL_SOURCES.has(entry.source) ? entry.base * entry.combo : 0);
    }
    if (entry.kind === "cashout") {
      assert.equal(entry.combo, COMBO_CAP - 1, "cash-out must come from the hit that reaches the cap");
      assert.equal(entry.amount, COMBO_CASHOUT_BONUS);
      cashouts++;
    }
    if (entry.kind === "multi" && entry.source && !PLAYER_KILL_SOURCES.has(entry.source) && entry.amount > 0)
      automatedMulti++;
  });
  try {
    // Human mode includes building bonuses, exercising the complete score ledger.
    const result = runGame(null, { seed, maxTicks: 30000, draftMode: true, isHuman: true });
    assert.equal(result.score, total, `seed ${seed}: score ledger mismatch`);
    assert(result.stats.maxCombo <= COMBO_CAP);
    assert(entries > 0 && cashouts > 0, `seed ${seed}: insufficient audit coverage`);
    console.log({ seed, entries, cashouts, score: result.score });
  } finally {
    setScoreAuditSink(null);
  }
}
assert(automatedMulti > 0, "No automated multi-kill bonus observed");
console.log({ automatedMulti, result: "score audit passed" });
