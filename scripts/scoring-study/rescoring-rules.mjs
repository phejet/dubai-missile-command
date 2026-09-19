import assert from "node:assert/strict";
export const variants = [
  ...[0.5, 1, 1.5].map((alpha, i) => ({ id: `A${i}`, family: "A", alpha, reference: i === 1 })),
  ...[25, 50, 100].map((productive, i) => ({
    id: `B${i}`,
    family: "B",
    productive,
    extra: productive * 2,
    reference: i === 1,
  })),
  ...[0.25, 0.5, 1].map((cap, i) => ({ id: `C${i}`, family: "C", cap, reference: i === 1 })),
];
export const sum = (xs, f = (x) => x) => xs.reduce((n, x) => n + f(x), 0);
export function contribution(e) {
  const total = sum(e.contributors, (c) => c.damage);
  assert(total > 0, "Missing applied damage");
  assert(e.contributors.every((c) => c.damage >= 0));
  return (
    (e.base *
      sum(
        e.contributors.filter((c) => c.source === "player"),
        (c) => c.damage,
      )) /
    total
  );
}
// Consume only observations. No game imports, mutable simulation state or candidate feedback.
export function rescore(events) {
  const waves = new Map(),
    shotKills = new Map();
  const row = (wave) => {
    if (!waves.has(wave))
      waves.set(wave, {
        wave,
        original: 0,
        base: 0,
        bonuses: 0,
        debits: 0,
        playerUplift: 0,
        otherUplift: 0,
        playerMulti: 0,
        otherMulti: 0,
        productive: 0,
        extra: 0,
        manualCredit: 0,
        assistCredit: 0,
        playerBase: 0,
        kills: 0,
        shots: 0,
      });
    return waves.get(wave);
  };
  for (const e of events) {
    if (e.type === "shot") row(e.wave).shots++;
    if (e.type !== "reward") continue;
    const w = row(e.wave);
    w.original += e.amount;
    if (e.kind === "kill") {
      assert(e.base > 0 && e.combo >= 1);
      assert.equal(e.base + e.uplift, e.amount);
      w.kills++;
      w.base += e.base;
      w.manualCredit += contribution(e);
      if (e.source === "player") {
        assert(Number.isInteger(e.shotId), "Manual kill without shot");
        w.playerBase += e.base;
        w.playerUplift += e.uplift;
        const n = shotKills.get(e.shotId) ?? 0;
        if (n === 0) w.productive++;
        else if (n < 4) w.extra++;
        shotKills.set(e.shotId, n + 1);
      } else {
        w.otherUplift += e.uplift;
        w.assistCredit += contribution(e);
      }
    } else if (e.kind === "multi") {
      w[e.source === "player" ? "playerMulti" : "otherMulti"] += e.amount;
    } else if (["wave_clear", "building_bonus"].includes(e.kind)) {
      assert(e.amount >= 0);
      w.bonuses += e.amount;
    } else {
      assert(["friendly_fire", "spending"].includes(e.kind));
      assert(e.amount <= 0);
      w.debits += e.amount;
    }
  }
  return [...waves.values()]
    .sort((a, b) => a.wave - b.wave)
    .map((w) => {
      assert.equal(
        w.original,
        w.base + w.playerUplift + w.otherUplift + w.playerMulti + w.otherMulti + w.bonuses + w.debits,
      );
      const scores = Object.fromEntries(
        variants.map((v) => {
          const premium =
            v.family === "A"
              ? v.alpha * w.playerUplift + w.playerMulti
              : v.family === "B"
                ? v.productive * w.productive + v.extra * w.extra
                : Math.min(w.manualCredit, v.cap * w.base);
          return [v.id, { premium, gross: w.base + w.bonuses + premium, net: w.base + w.bonuses + premium + w.debits }];
        }),
      );
      return { ...w, gross: w.original - w.debits, scores };
    });
}
