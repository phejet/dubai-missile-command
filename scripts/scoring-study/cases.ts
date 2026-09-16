import type { GameState } from "../../src/types";
import assert from "node:assert/strict";
import { initGame, spawnMissile, spawnMirv, updateAutoSystems, studyInternals } from "../../src/game-sim";
import { createExplosion, damageTarget, fireInterceptor, setRng, getMultiKillBonus } from "../../src/game-logic";
import { mulberry32 } from "../../src/headless/rng";
import * as audit from "./observer.mjs";
export function runControlledCases() {
  const passed: string[] = [];
  const fresh = () => {
    setRng(mulberry32(42));
    const g = initGame();
    g.missiles = [];
    g.drones = [];
    g.explosions = [];
    audit.start();
    return g;
  };
  const missile = (g: GameState, x = 400, y = 400) => {
    spawnMissile(g);
    const m = g.missiles[g.missiles.length - 1];
    Object.assign(m, { x, y, vx: 0, vy: 0 });
    return m;
  };
  const end = (g: GameState, name: string) => {
    const o = audit.stop();
    assert.equal(o.stack.length, 0);
    assert.equal(
      o.events.filter((e) => e.type === "reward").reduce((n, e) => n + e.amount, 0),
      g.score,
    );
    passed.push(name);
    return o.events;
  };
  for (const source of ["player", "hornets", "roadrunner", "patriot", "f15", "impact"]) {
    const g = fresh();
    missile(g);
    missile(g, 445);
    audit.withSource(source, () => createExplosion(g, 400, 400, 20, "#fff", source === "player", 20));
    studyInternals.updateExplosions(g, 1);
    const root = g.explosions[0];
    g.explosions = g.explosions.filter((e) => e !== root);
    studyInternals.updateExplosions(g, 1);
    const events = end(g, source + " chain survives root removal");
    const kills = events.filter((e) => e.kind === "kill");
    assert.equal(kills.length, 2);
    assert(kills.every((e) => e.source === source && e.rootId === root.id));
  }
  {
    const g = fresh();
    spawnMirv(g);
    const m = g.missiles[0];
    Object.assign(m, { x: 400, y: 400, health: 2 });
    audit.withSource("phalanx", () => damageTarget(g, m, 1, "#fff", 20));
    audit.withSource("player", () => createExplosion(g, 400, 400, 20, "#fff", true, 20));
    studyInternals.updateExplosions(g, 1);
    const events = end(g, "damaging assist differs from final owner");
    const kill = events.find((e) => e.kind === "kill");
    assert.equal(kill.source, "player");
    assert.deepEqual(
      kill.contributors.map((e) => [e.source, e.damage]),
      [
        ["phalanx", 1],
        ["player", 1],
      ],
    );
  }
  {
    const g = fresh();
    missile(g);
    missile(g, 405);
    audit.withSource("player", () => createExplosion(g, 400, 400, 30, "#fff", true, 30));
    studyInternals.updateExplosions(g, 1);
    missile(g, 410);
    studyInternals.updateExplosions(g, 1);
    const events = end(g, "incremental multi bonus exact");
    assert.equal(
      events.filter((e) => e.kind === "multi").reduce((n, e) => n + e.amount, 0),
      getMultiKillBonus(3),
    );
    assert.equal(g.stats.multiShots, 1);
  }
  {
    const g = fresh();
    g.upgrades.flare = 2;
    const m = missile(g);
    const victim = missile(g, 410);
    m.flareControl = { mode: "turncoat", victim, patience: 200 };
    updateAutoSystems(g, 1, [m, victim]);
    studyInternals.updateExplosions(g, 1);
    studyInternals.processRootExplosionCombo(g, true);
    const events = end(g, "real flare payoff and prepopulated multi root");
    assert.equal(events.filter((e) => e.kind === "kill").length, 2);
    assert(
      events
        .filter((e) => e.kind === "kill" || e.kind === "multi" || e.type === "combo")
        .every((e) => e.source === "flare"),
    );
    assert.equal(g.stats.multiShots, 1);
    assert.equal(g.combo, 2);
  }
  {
    const g = fresh();
    g.upgrades.flare = 1;
    const m = missile(g);
    m.flareControl = { mode: "seduced", flareId: 999, patience: 200 };
    updateAutoSystems(g, 1, [m]);
    const events = end(g, "real flare neutralization unscored");
    assert.equal(g.score, 0);
    assert.equal(events.filter((e) => e.type === "destroyed").length, 1);
    assert.equal(events.find((e) => e.type === "destroyed").source, "flare");
  }
  {
    const g = fresh();
    assert(fireInterceptor(g, 400, 400, 0));
    const projectile = g.interceptors[0];
    audit.pushProjectile(g, projectile);
    createExplosion(g, 400, 400, 30, "#fff", true, 30);
    audit.pop();
    missile(g);
    studyInternals.updateExplosions(g, 1);
    const events = end(g, "successful fire retains shot identity");
    assert.equal(events.find((e) => e.kind === "kill").shotId, 1);
    assert.equal(events.filter((e) => e.type === "shot").length, g.stats.shotsFired);
  }
  return passed;
}
