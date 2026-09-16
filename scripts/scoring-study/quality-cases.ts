import assert from "node:assert/strict";
import { initGame, spawnMissile, studyInternals } from "../../src/game-sim";
import { setRng, fireInterceptor, createExplosion, damageTarget } from "../../src/game-logic";
import { mulberry32 } from "../../src/headless/rng";
import * as audit from "./observer.mjs";
export function runQualityCases() {
  const passed: string[] = [];
  const fresh = () => {
    setRng(mulberry32(42));
    const g = initGame();
    g.missiles = [];
    g.drones = [];
    g.explosions = [];
    const o = audit.start({ quality: true });
    return { g, o };
  };
  {
    const { g, o } = fresh();
    assert(fireInterceptor(g, 400, 400, 0));
    const p = g.interceptors[0];
    p.alive = false;
    audit.pushProjectile(g, p);
    createExplosion(g, 400, 400, 20, "#fff", true, 20);
    audit.pop();
    spawnMissile(g);
    Object.assign(g.missiles[0], { x: 400, y: 400 });
    studyInternals.updateExplosions(g, 1);
    g.explosions[0].alpha = 0;
    audit.qualityAfter(g, "step");
    assert.equal(o.events.filter((e) => e.type === "shot_end").length, 0);
    for (const ex of g.explosions) ex.alpha = 0;
    audit.qualityAfter(g, "step");
    assert.equal(o.events.find((e) => e.type === "shot_end").status, "resolved");
    audit.stop();
    passed.push("descendant lifetime outlasts expired root");
  }
  {
    const { g, o } = fresh();
    assert(fireInterceptor(g, 400, 400, 0));
    g.wave++;
    g.interceptors = [];
    audit.qualityAfter(g, "shop");
    assert.equal(o.events.find((e) => e.type === "shot_end").status, "boundary_cleared");
    audit.stop();
    passed.push("boundary-cleared projectile excluded from resolved denominator");
  }
  {
    const { g, o } = fresh();
    assert(fireInterceptor(g, 400, 400, 0));
    audit.qualityFinish(g);
    assert.equal(o.events.find((e) => e.type === "shot_end").status, "terminal_unresolved");
    audit.stop();
    passed.push("terminal-active projectile censored");
  }
  {
    const { g, o } = fresh();
    spawnMissile(g);
    const m = g.missiles[0];
    Object.assign(m, { x: 400, y: 400 });
    assert(fireInterceptor(g, 400, 400, 0));
    assert(fireInterceptor(g, 400, 400, 1));
    const shots = o.events.filter((e) => e.type === "shot");
    assert.equal(shots[0].overlap.length, 0);
    assert.equal(shots[1].overlap.length, 1);
    audit.withSource("hornets", () => damageTarget(g, m, 1, "#fff", 10));
    const kill = o.events.find((e) => e.kind === "kill");
    assert.equal(kill.targetId, shots[0].intended[0]);
    assert.equal(kill.source, "hornets");
    audit.stop();
    passed.push("shared intended target and competing upgrade kill retain identity");
  }
  {
    const { g } = fresh();
    assert(fireInterceptor(g, 400, 400, 0));
    const original = JSON.stringify(g.fireChargeState);
    const later = audit.availableCharges(g, 1000);
    assert.equal(JSON.stringify(g.fireChargeState), original);
    assert.equal(later, g.fireChargeState.burstChargeCap);
    audit.stop();
    passed.push("charge projection catches recharge without mutation");
  }
  {
    const { g, o } = fresh();
    audit.qualityBefore(g, 0);
    g.burjHealth--;
    g.launcherHP[0]--;
    g.buildings[0].alive = false;
    audit.qualityAfter(g, "step");
    const loss = o.events.find((e) => e.type === "asset_damage");
    assert.equal(loss.burj, 1);
    assert.equal(loss.launcherHP, 1);
    assert.equal(loss.buildings, 1);
    audit.stop();
    passed.push("observed damage ledger reports asset losses separately");
  }
  return passed;
}
