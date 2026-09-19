import { afterEach, describe, expect, it } from "vitest";
import {
  addScore,
  awardKill,
  COMBO_CAP,
  COMBO_CASHOUT_BONUS,
  createExplosion,
  damageTarget,
  getKillReward,
  getPhalanxTurrets,
  PLAYER_KILL_SOURCES,
  setRng,
  setScoreAuditSink,
  stepCombo,
  type ScoreAuditEntry,
} from "./game-logic";
import { initGame, update, updateAutoSystems } from "./game-sim";
import { buyDraftUpgrade } from "./game-sim-shop";
import { cloneGameStateForReplayAnchor } from "./replay-anchor";
import type { KillSource, Missile } from "./types";

const sources: KillSource[] = [
  "player",
  "f15",
  "emp",
  "flare",
  "hornets",
  "roadrunner",
  "patriot",
  "ironBeam",
  "phalanx",
  "impact",
  "friendlyFire",
];
function missile(x = 100): Missile {
  return { x, y: 100, vx: 0, vy: 0, accel: 1, trail: [], alive: true, type: "missile" };
}
function game() {
  setRng(() => 0.5);
  const g = initGame();
  g.wave = 5;
  g.schedule = [{ type: "missile", tick: 999999 }];
  g.scheduleIdx = 0;
  g.missiles = [];
  g.drones = [];
  g.interceptors = [];
  g.explosions = [];
  g.particles = [];
  return g;
}
afterEach(() => {
  setScoreAuditSink(null);
  setRng(Math.random);
});

describe("player scoring rules", () => {
  it("advances four times, cashes out the fifth hit, then starts again", () => {
    let combo = 1;
    for (let hit = 1; hit <= 6; hit++) {
      const result = stepCombo(combo, "hit");
      expect(result).toEqual({
        combo: hit === 5 ? 1 : hit === 6 ? 2 : hit + 1,
        bonus: hit === 5 ? 1000 : 0,
        cashout: hit === 5,
      });
      combo = result.combo;
    }
    for (let level = 1; level <= COMBO_CAP; level++) {
      expect(stepCombo(level, "hold").combo).toBe(level);
      expect(stepCombo(level, "miss").combo).toBe(1);
    }
  });
  it.each(sources)("audits ownership for %s, including zero awards", (source) => {
    const g = game(),
      target = missile(),
      entries: ScoreAuditEntry[] = [];
    g.combo = 4;
    setScoreAuditSink((entry) => entries.push(entry));
    awardKill(g, target, source);
    expect(target.killedBy).toBe(source);
    expect(g.score).toBe(PLAYER_KILL_SOURCES.has(source) ? getKillReward(target) * 4 : 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amount: g.score, kind: "kill", source, combo: 4 });
  });
  it.each(["ironBeam", "phalanx", "emp"] as const)("direct damage attributes %s", (source) => {
    const g = game(),
      target = missile();
    damageTarget(g, target, 1, "#fff", 20, source);
    expect(target.alive).toBe(false);
    expect(target.killedBy).toBe(source);
    expect(g.score).toBe(source === "emp" ? getKillReward(target) : 0);
    expect(g.stats.missileKills).toBe(1);
  });
  it.each(["hornets", "roadrunner", "patriot", "f15", "flare", "player"] as const)(
    "explosion scoring and chains retain %s",
    (source) => {
      const g = game();
      const a = missile(),
        b = missile(150);
      g.missiles = [a, b];
      createExplosion(g, 100, 100, 20, "#fff", source === "player" || source === "flare", 20, { source });
      update(g, 1);
      update(g, 1);
      expect(a.killedBy).toBe(source);
      expect(b.killedBy).toBe(source);
      expect(g.stats.missileKills).toBe(2);
      expect(g.explosions.filter((ex) => ex.chain).every((ex) => ex.source === source)).toBe(true);
      expect(g.score).toBe(PLAYER_KILL_SOURCES.has(source) ? 2 * getKillReward(a) : 0);
    },
  );
  it("pays exactly the multi bonus for an automated double kill", () => {
    const g = game();
    g.missiles = [missile(), missile(112)];
    createExplosion(g, 100, 100, 80, "#fff", false, 80, { source: "patriot" });
    update(g, 1);
    expect(g.score).toBe(150);
    expect(g.stats.missileKills).toBe(2);
  });
  it("cash-out resolves after kills, clears the increment toast and restarts the streak", () => {
    const g = game();
    for (let hit = 1; hit <= 6; hit++) {
      const target = missile();
      g.missiles = [target];
      createExplosion(g, 100, 100, 20, "#fff", true, 20, { source: "player" });
      const root = g.explosions[g.explosions.length - 1];
      const before = g.score,
        multiplier = g.combo;
      update(g, 1);
      expect(g.score - before).toBe(getKillReward(target) * multiplier);
      root.growing = false;
      root.alpha = 0;
      update(g, 1);
      expect(g.combo).toBe(hit === 5 ? 1 : hit === 6 ? 2 : hit + 1);
      expect(g.score - before).toBe(getKillReward(target) * multiplier + (hit === 5 ? COMBO_CASHOUT_BONUS : 0));
      if (hit === 5) {
        expect(g.comboToast).toBeNull();
        expect(g.comboBonusToast?.bonus).toBe(1000);
      }
      g.explosions = [];
    }
  });
  it("processes overlapping roots in order at expiry", () => {
    const g = game();
    g.combo = 4;
    for (let i = 0; i < 2; i++) {
      createExplosion(g, 100, 100, 20, "#fff", true, 20, { source: "player" });
      Object.assign(g.explosions[i], { kills: 1, growing: false, alpha: i === 0 ? 0 : 0.5 });
    }
    update(g, 1);
    expect(g.combo).toBe(5);
    expect(g.score).toBe(0);
    g.explosions[0].alpha = 0;
    update(g, 1);
    expect(g.combo).toBe(1);
    expect(g.score).toBe(1000);
  });
  it.each([
    { source: "flare", killedBy: undefined, timing: "none", expected: 4 },
    { source: "player", killedBy: "hornets", timing: "before", expected: 4 },
    { source: "player", killedBy: "patriot", timing: "during", expected: 4 },
    { source: "player", killedBy: "patriot", timing: "after", expected: 1 },
    { source: "player", killedBy: "player", timing: "before", expected: 1 },
    { source: "player", killedBy: undefined, timing: "none", expected: 1 },
  ] as const)("hold cutoff: $source / $killedBy / $timing", ({ source, killedBy, timing, expected }) => {
    const g = game(),
      target = missile(700);
    g.combo = 4;
    if (timing === "before") {
      target.alive = false;
      target.killedBy = killedBy;
    }
    createExplosion(g, 100, 100, 20, "#fff", true, 20, { source, intendedTargets: killedBy ? [target] : [] });
    const root = g.explosions[0];
    update(g, 1);
    if (timing === "during") {
      target.alive = false;
      target.killedBy = killedBy;
    }
    root.growing = false;
    root.alpha = 0.21;
    update(g, 1);
    if (timing === "after") {
      target.alive = false;
      target.killedBy = killedBy;
    }
    root.alpha = 0;
    update(g, 1);
    expect(g.combo).toBe(expected);
  });
  it("Phalanx kills through its real turret path score zero", () => {
    const g = game();
    expect(buyDraftUpgrade(g, "phalanx")).toBe(true);
    const turret = getPhalanxTurrets(1)[0];
    const target = { ...missile(turret.x), y: turret.y - 50, vy: 0, accel: 0 };
    g.missiles = [target];
    g.combo = 3;
    let rolls = 0;
    setRng(() => (rolls++ % 2 ? 0.1 : 0.5)); // alternate aim jitter and a guaranteed hit roll
    for (let tick = 0; tick < 60 && target.alive; tick++) updateAutoSystems(g, 1, g.missiles);
    expect(target.alive).toBe(false);
    expect(target.killedBy).toBe("phalanx");
    expect(g.stats.missileKills).toBe(1);
    expect(g.score).toBe(0);
  });
  it("a wave-ending cash-out lands before the wave bonus screen", () => {
    const g = game();
    g.schedule = [];
    g.combo = COMBO_CAP;
    g.missiles = [missile()];
    createExplosion(g, 100, 100, 80, "#fff", true, 80, { source: "player" });
    const entries: ScoreAuditEntry[] = [];
    setScoreAuditSink((entry) => entries.push(entry));
    let atBonus: { score: number; combo: number; audited: number; kinds: string[] } | null = null;
    for (let tick = 0; tick < 300 && !atBonus; tick++)
      update(g, 1, (type) => {
        if (type === "waveBonusStart" && !atBonus)
          atBonus = {
            score: g.score,
            combo: g.combo,
            audited: entries.reduce((sum, e) => sum + e.amount, 0),
            kinds: entries.map((e) => e.kind),
          };
      });
    expect(atBonus).not.toBeNull();
    expect(atBonus!.kinds).toEqual(["kill", "wave_clear", "cashout"]);
    expect(atBonus!.combo).toBe(1);
    expect(atBonus!.score).toBe(atBonus!.audited);
    expect(atBonus!.score).toBe(getKillReward(missile()) * COMBO_CAP + 250 * g.wave + COMBO_CASHOUT_BONUS);
  });
  it("overlapping roots score each kill at the multiplier current when it lands", () => {
    const g = game();
    g.combo = 4;
    const entries: ScoreAuditEntry[] = [];
    setScoreAuditSink((entry) => entries.push(entry));
    g.missiles = [missile(100)];
    createExplosion(g, 100, 100, 20, "#fff", true, 20, { source: "player" });
    createExplosion(g, 700, 100, 20, "#fff", true, 20, { source: "player" });
    const [first, second] = g.explosions;
    update(g, 1); // first root kills at x4
    Object.assign(first, { growing: false, alpha: 0 });
    Object.assign(second, { growing: false, alpha: 0.9 });
    update(g, 1); // first root resolves: x4 -> x5
    expect(g.combo).toBe(5);
    g.missiles = [missile(700)];
    second.alpha = 0.9;
    update(g, 1); // second root kills at x5
    second.alpha = 0;
    update(g, 1); // second root resolves: cash-out
    const base = getKillReward(missile());
    expect(entries.map((e) => [e.kind, e.amount])).toEqual([
      ["kill", base * 4],
      ["kill", base * 5],
      ["cashout", COMBO_CASHOUT_BONUS],
    ]);
    expect(g.combo).toBe(1);
  });
  it("replay anchors keep intended-target identity, so restored runs hold identically", () => {
    const g = game(),
      target = missile(700);
    g.missiles = [target];
    g.combo = 4;
    createExplosion(g, 100, 100, 20, "#fff", true, 20, { source: "player", intendedTargets: [target] });
    const clone = cloneGameStateForReplayAnchor(g);
    expect(clone.explosions[0].intendedTargets![0]).toBe(clone.missiles[0]);
    for (const state of [g, clone]) {
      const stolen = state.missiles[0];
      stolen.alive = false;
      awardKill(state, stolen, "patriot");
      update(state, 1);
      Object.assign(state.explosions[0], { growing: false, alpha: 0.21 });
      update(state, 1);
      state.explosions[0].alpha = 0;
      update(state, 1);
      expect(state.combo).toBe(4);
    }
  });
  it("reconciles bonuses and spending through the audit", () => {
    const g = game();
    let total = 0;
    setScoreAuditSink((entry) => {
      total += entry.amount;
    });
    addScore(g, 1000, "building_bonus");
    addScore(g, -200, "spending");
    expect(g.score).toBe(total);
  });
});
