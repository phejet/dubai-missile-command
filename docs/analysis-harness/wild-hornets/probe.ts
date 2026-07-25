/**
 * Instrumented hornet telemetry harness (analysis artifact, not shipped code).
 * Mirrors src/headless/sim-runner.ts's loop but forces an exact hornet loadout,
 * suppresses shop purchases (hornets = only auto-defense), and diffs g.hornets
 * before/after each update() to classify every hornet's fate. No game code changes.
 */
import { assertNoEditorOverridesForDeterministicRun, setRng, fireInterceptor, dist } from "../../../src/game-logic";
import { initGame, update, buyDraftUpgrade, closeShop, completeWaveBonusAndOpenShop } from "../../../src/game-sim";
import { prepareWaveStart } from "../../../src/game-sim-shop";
import { isBonusUiPauseActive } from "../../../src/replay-loop";
import { createDefaultReplayInitialState } from "../../../src/replay-version";
import { mulberry32 } from "../../../src/headless/rng";
import { botDecideAction, resolveBotConfig, reserveBotTarget } from "../../../src/headless/bot-brain";
import defaultConfig from "../../../src/headless/bot-config.json" with { type: "json" };
import { applyReplayInitialState } from "../../../src/replay-bootstrap";
import { getUpgradeNodeDef } from "../../../src/game-sim-upgrades";
import type { GameState, Hornet, Threat } from "../../../src/types";

const FUZE = Number(process.env.HORNET_FUZE ?? "12");
// Bot-realism knobs: the default bot fires far more efficiently than a human,
// which inflates the hornet orphan rate. BOT_SKIP drops a fraction of firing
// opportunities; BOT_FOCUS_Y makes the bot ignore low threats entirely, which is
// the "let the hornets own the bottom half" strategy a human can actually play.
const BOT_SKIP = Number(process.env.BOT_SKIP ?? "0");
const BOT_FOCUS_Y = Number(process.env.BOT_FOCUS_Y ?? "0");

export interface MagStat {
  ticks: number;
  dryTicks: number;
  readyTicks: number;
  ammoSum: number;
  launches: number;
  capTicks: number;
}

export type Outcome = "detonate" | "fuel" | "bounds" | "orphan" | "waveReset";

export interface HornetRec {
  launchTick: number;
  launchWave: number;
  launchX: number;
  launchY: number;
  speed: number;
  maxLife: number;
  targetType: string;
  targetLaunchY: number;
  launchDist: number;
  maxRange: number;
  outcome: Outcome;
  ticksAlive: number;
  minDist: number;
  finalDist: number;
  retargets: number;
  killed: boolean;
  chaseTicks: number;
  liveTicks: number;
  climbTicks: number;
  deathY: number;
  deepTargetTicks: number;
  terminalTicks: number;
  pad: "left" | "right";
  crossSide: boolean;
  pred: number | null;
  targetSpeed: number; // threat px/tick at launch
  killY: number; // y at detonation
  everLoitered: boolean;
  loiterTicks: number;
  loiterEntries: number;
  reactivations: number;
  firstWait: number; // ticks loitered before the FIRST reactivation
  killedAfterLoiter: boolean;
  _prevLoiter?: number;
  hadTargetAtDeath: boolean; // launched at a target in the other pad's half
  localHalfHadThreats: boolean; // own half had live threats at launch (assigned or not)
  localHalfUnassigned: number; // own half's UNASSIGNED count at launch (the sim's actual gate)
  cpaMin: number; // continuous closest approach over the tick (swept), vs the sim's tick-start sample
  trailingAtCpa: boolean; // at closest approach, target was moving away from the hornet
  terminalClosingSum: number;
  terminalClosingN: number;
  lastTarget: Threat | null;
  lastDist: number;
  classified?: boolean;
}

export interface ProbeResult {
  label: string;
  seed: number;
  score: number;
  wave: number;
  burjHealth: number;
  deathCause: string;
  ticks: number;
  mag: { left: MagStat; right: MagStat };
  missileKills: number;
  droneKills: number;
  hornets: HornetRec[];
  peakConcurrentLoiterers: number;
  p95ConcurrentLoiterers: number;
}

function threatKey(t: Threat): string {
  const sub = (t as { subtype?: string }).subtype;
  return sub ? `${t.type}/${sub}` : t.type;
}

export function probeGame(opts: { label: string; seed: number; acquired: string[]; maxTicks?: number }): ProbeResult {
  assertNoEditorOverridesForDeterministicRun("Hornet probe");
  const config = resolveBotConfig(defaultConfig as never, "average");
  const maxTicks = opts.maxTicks ?? 60000;
  const rng = mulberry32(opts.seed);
  const botRng = mulberry32(opts.seed ^ 0x5f3759df);
  const humanRng = mulberry32(opts.seed ^ 0x9e3779b9);
  setRng(rng);

  const g: GameState = initGame();
  applyReplayInitialState(g, createDefaultReplayInitialState());
  (g as unknown as { _draftMode: boolean })._draftMode = true;

  const completed = new Set(g.metaProgression.completedObjectives);
  for (const id of opts.acquired) for (const o of getUpgradeNodeDef(id)?.objectives ?? []) completed.add(o);
  g.metaProgression = { ...g.metaProgression, completedObjectives: [...completed].sort() };
  for (const id of opts.acquired) {
    if (!buyDraftUpgrade(g, id)) throw new Error(`could not force ${id}`);
  }
  prepareWaveStart(g);

  const withBotRng = <T>(fn: () => T): T => {
    setRng(botRng);
    const r = fn();
    setRng(rng);
    return r;
  };

  const mag = {
    left: { ticks: 0, dryTicks: 0, readyTicks: 0, ammoSum: 0, launches: 0, capTicks: 0 },
    right: { ticks: 0, dryTicks: 0, readyTicks: 0, ammoSum: 0, launches: 0, capTicks: 0 },
  };
  const recs = new Map<Hornet, HornetRec>();
  const finished: HornetRec[] = [];
  const pendingKill: { rec: HornetRec; target: Threat; untilTick: number }[] = [];
  const concurrentLoiterers: number[] = [];
  let lastFireTick = -Infinity;
  let deathCause = "timeout";
  let tick = 0;

  for (; tick < maxTicks; tick++) {
    if (g.state === "gameover") {
      deathCause = "destroyed";
      break;
    }
    if (g.state === "shop") closeShop(g); // buy nothing: isolate hornets

    let action = withBotRng(() => botDecideAction(g, config, lastFireTick, tick));
    if (action && BOT_FOCUS_Y > 0 && (action.targetRef?.y ?? 0) > BOT_FOCUS_Y) action = null;
    if (action && BOT_SKIP > 0 && humanRng() < BOT_SKIP) action = null;
    if (action) {
      g.crosshairX = action.x;
      g.crosshairY = action.y;
      if (fireInterceptor(g, action.x, action.y, tick)) {
        reserveBotTarget(g, action.targetRef, action.reservationUntil ?? tick, tick);
        lastFireTick = tick;
      }
    }

    // updateAutoSystems() runs FIRST inside update(), so every branch the hornet
    // takes this tick is evaluated against *these* pre-update positions. Snapshot
    // them so removals can be classified by reproducing the sim's own conditions
    // instead of guessing from post-update state (the blast kills the target in
    // the same tick, which otherwise looks identical to "target died elsewhere").
    const preH = new Map<Hornet, { x: number; y: number; life: number }>();
    for (const h of g.hornets) preH.set(h, { x: h.x, y: h.y, life: h.life });
    const preT = new Map<Threat, { x: number; y: number; alive: boolean }>();
    for (const m of g.missiles) preT.set(m, { x: m.x, y: m.y, alive: m.alive });
    for (const d of g.drones) preT.set(d, { x: d.x, y: d.y, alive: d.alive });

    // Reproduce the sim's launch-gate view of the world from pre-update state.
    // Left pad is processed first, so its numbers are exact; the right pad's may
    // differ by one if the left pad launched in the same tick.
    const preAssigned = new Set<Threat>();
    for (const hh of g.hornets) if (hh.alive && hh.targetRef?.alive) preAssigned.add(hh.targetRef);
    const preLive: Threat[] = [];
    for (const m of g.missiles) if (m.alive && m.y >= 0) preLive.push(m);
    for (const d of g.drones) if (d.alive && d.y >= 0) preLive.push(d);
    const localHalfLive = (isLeft: boolean) => preLive.filter((t) => (isLeft ? t.x < 460 : t.x >= 460)).length;
    const localHalfUnassignedCount = (isLeft: boolean) =>
      preLive.filter((t) => (isLeft ? t.x < 460 : t.x >= 460) && !preAssigned.has(t)).length;

    // Magazine telemetry, sampled before the sim mutates it
    for (const site of g.hornetSites ?? []) {
      const key = site.key === "wildHornetsLeft" ? "left" : "right";
      mag[key].ticks++;
      if (site.ammo === 0) mag[key].dryTicks++;
      if (site.ammo >= 2) mag[key].capTicks++; // at cap => reloadTimer pinned to 0, no production
      if (site.ammo > 0 && site.launchCooldown <= 0) mag[key].readyTicks++;
      mag[key].ammoSum += site.ammo;
    }

    update(g, 1, null);
    if (isBonusUiPauseActive(g)) completeWaveBonusAndOpenShop(g, null);
    concurrentLoiterers.push(g.hornets.filter((hornet) => hornet.phase === "loitering").length);

    for (const h of g.hornets) {
      if (recs.has(h)) continue;
      const t = h.targetRef ?? null;
      const d = t ? dist(h.x, h.y, t.x, t.y) : 0;
      recs.set(h, {
        launchTick: tick,
        launchWave: g.wave,
        launchX: h.x,
        launchY: h.y,
        speed: h.speed,
        maxLife: h.maxLife,
        targetType: t ? threatKey(t) : "none",
        targetLaunchY: t?.y ?? 0,
        launchDist: d,
        maxRange: h.speed * h.maxLife,
        outcome: "waveReset",
        ticksAlive: 0,
        minDist: d,
        finalDist: d,
        retargets: 0,
        killed: false,
        chaseTicks: 0,
        liveTicks: 0,
        climbTicks: 0,
        deathY: h.y,
        deepTargetTicks: 0,
        terminalTicks: 0,
        pad: h.x < 400 ? "left" : "right",
        crossSide: !!t && (h.x < 400 ? t.x >= 460 : t.x < 460),
        pred: (h as unknown as { _pred?: number | null })._pred ?? null,
        targetSpeed: t ? Math.hypot(t.vx || 0, t.vy || 0) : 0,
        killY: -1,
        hadTargetAtDeath: false,
        everLoitered: false,
        loiterTicks: 0,
        loiterEntries: 0,
        reactivations: 0,
        firstWait: -1,
        killedAfterLoiter: false,
        localHalfHadThreats: localHalfLive(h.x < 400) > 0,
        localHalfUnassigned: localHalfUnassignedCount(h.x < 400),
        cpaMin: Infinity,
        trailingAtCpa: false,
        terminalClosingSum: 0,
        terminalClosingN: 0,
        lastTarget: t,
        lastDist: d,
      });
      mag[h.x < 400 ? "left" : "right"].launches++;
    }

    const alive = new Set(g.hornets);
    for (const h of g.hornets) {
      const r = recs.get(h)!;
      r.liveTicks++;
      if (h.phase === "dying" && !r.classified) {
        r.outcome = h.fate === "fuelOut" ? "fuel" : "orphan";
        r.ticksAlive = tick - r.launchTick + 1;
        r.hadTargetAtDeath = !!r.lastTarget?.alive;
        r.deathY = h.y;
        r.classified = true;
      }
      // Swept closest approach: the sim only tests d<12 at tick start, but both
      // bodies move several px per tick. Compute the true minimum over the tick.
      const hp0 = preH.get(h);
      const t0ref = h.targetRef ?? null;
      const tp0 = t0ref ? preT.get(t0ref) : undefined;
      if (hp0 && tp0 && t0ref) {
        const rx = hp0.x - tp0.x;
        const ry = hp0.y - tp0.y;
        const vx = h.x - hp0.x - (t0ref.x - tp0.x);
        const vy = h.y - hp0.y - (t0ref.y - tp0.y);
        const vv = vx * vx + vy * vy;
        const s = vv > 1e-9 ? Math.max(0, Math.min(1, -(rx * vx + ry * vy) / vv)) : 0;
        const cx = rx + vx * s;
        const cy = ry + vy * s;
        const cpa = Math.sqrt(cx * cx + cy * cy);
        if (cpa < r.cpaMin) {
          r.cpaMin = cpa;
          // trailing = target velocity points away from the hornet at closest approach
          const tvx = t0ref.x - tp0.x;
          const tvy = t0ref.y - tp0.y;
          const tv = Math.hypot(tvx, tvy);
          const toH = Math.hypot(-cx, -cy);
          r.trailingAtCpa = tv > 0.01 && toH > 0.01 ? (tvx * -cx + tvy * -cy) / (tv * toH) < -0.3 : false;
        }
      }
      const loiterNow = h.phase === "loitering" ? (h.loiterAngle ?? 1) : 0;
      const wasLoitering = r.loiterTicks > 0 && r._prevLoiter! > 0;
      if (loiterNow > 0) {
        if (!r._prevLoiter) r.loiterEntries++;
        r.everLoitered = true;
        r.loiterTicks++;
      } else if (r._prevLoiter && r._prevLoiter > 0) {
        r.reactivations++;
        if (r.firstWait < 0) r.firstWait = r._prevLoiter;
      }
      void wasLoitering;
      r._prevLoiter = loiterNow;
      const t = h.targetRef ?? null;
      if (t && t !== r.lastTarget) r.retargets++;
      const d = t ? dist(h.x, h.y, t.x, t.y) : Infinity;
      if (Number.isFinite(d)) {
        if (d < r.minDist) r.minDist = d;
        const closing = r.lastTarget === t ? r.lastDist - d : NaN;
        if (d < 250 && Number.isFinite(closing) && closing < 1.0) r.chaseTicks++;
        if (d >= FUZE && d < 150) r.terminalTicks++;
        if (d < 150 && Number.isFinite(closing)) {
          r.terminalClosingSum += closing;
          r.terminalClosingN++;
        }
        if (t && t.y > 1100 && t.alive) r.deepTargetTicks++;
      }
      // "climb/loiter" branch: target is below the hornet, so it drifts upward at half speed
      if (t && t.alive && t.y > h.y + 80) r.climbTicks++;
      r.lastTarget = t;
      r.lastDist = d;
      if (Number.isFinite(d)) r.finalDist = d;
      r.deathY = h.y;
    }

    for (const [h, r] of recs) {
      if (alive.has(h)) continue;
      const hp = preH.get(h);
      const t = h.targetRef ?? null; // post-retarget target the sim actually used
      const tp = t ? preT.get(t) : undefined;
      const d = hp && tp ? dist(hp.x, hp.y, tp.x, tp.y) : Infinity;
      r.ticksAlive = tick - r.launchTick + 1;
      r.hadTargetAtDeath = !!(t && t.alive);
      r.deathY = hp?.y ?? h.y;
      if (Number.isFinite(d)) r.finalDist = d;
      if (!r.classified) {
        if (!hp) r.outcome = "waveReset";
        else if (hp.life - 1 <= 0) r.outcome = "fuel";
        else if (hp.x < -60 || hp.x > 960 || hp.y < -60 || hp.y > 1620) r.outcome = "bounds";
        else if (!t || !tp || !tp.alive) r.outcome = "orphan";
        else if (d < FUZE) {
          r.outcome = "detonate";
          r.killY = hp.y;
          r.killedAfterLoiter = r.everLoitered;
          pendingKill.push({ rec: r, target: t, untilTick: tick + 12 });
        } else r.outcome = "waveReset";
      }
      finished.push(r);
      recs.delete(h);
    }

    for (let i = pendingKill.length - 1; i >= 0; i--) {
      const p = pendingKill[i];
      if (!p.target.alive) {
        p.rec.killed = true;
        pendingKill.splice(i, 1);
      } else if (tick > p.untilTick) pendingKill.splice(i, 1);
    }
  }

  setRng(Math.random);
  for (const r of recs.values()) {
    r.outcome = "waveReset";
    finished.push(r);
  }

  return {
    label: opts.label,
    seed: opts.seed,
    score: g.score,
    wave: g.wave,
    burjHealth: g.burjHealth,
    deathCause,
    ticks: tick,
    mag,
    missileKills: g.stats.missileKills,
    droneKills: g.stats.droneKills,
    hornets: finished,
    peakConcurrentLoiterers: concurrentLoiterers.length ? Math.max(...concurrentLoiterers) : 0,
    p95ConcurrentLoiterers: concurrentLoiterers.length
      ? [...concurrentLoiterers].sort((a, b) => a - b)[Math.floor(concurrentLoiterers.length * 0.95)]
      : 0,
  };
}
