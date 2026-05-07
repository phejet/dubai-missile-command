// Per-shot audit. Runs a game and tracks each interceptor: where it was
// aimed, what threat was nearby at fire time, did it kill/miss, what was the
// closest miss distance. Prints aggregate leading-error diagnostics per wave.
//
// Usage: npx tsx src/headless/shot-audit.ts [--seed=42] [--preset=perfect] [--maxTicks=60000]

import { setRng, fireInterceptor, dist } from "../game-logic.js";
import { initGame, update } from "../game-sim.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades, resolveBotConfig, reserveBotTarget } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };
import { buyUpgrade, buyDraftUpgrade, closeShop, fireEmp } from "../game-sim.js";
import { getUpgradeNodeDef } from "../game-sim-upgrades.js";
import type { GameState, Threat, UpgradeKey } from "../types.js";

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : def;
}

const SEED = parseInt(getArg("seed", "42"));
const PRESET = getArg("preset", "perfect");
const MAX_TICKS = parseInt(getArg("maxTicks", "60000"));

interface ShotRecord {
  fireTick: number;
  fireWave: number;
  aimX: number;
  aimY: number;
  targetType: string | null;
  targetX: number | null;
  targetY: number | null;
  targetVx: number | null;
  targetVy: number | null;
  killTick?: number;
  killedTargetType?: string;
  killedDistanceFromAim?: number;
  detonationDist?: number;
  expiredAtY?: number;
  expiredAtX?: number;
  ttd?: number; // ticks-to-detonate
}

function snapshotThreat(t: Threat | null | undefined): Pick<ShotRecord, "targetType" | "targetX" | "targetY" | "targetVx" | "targetVy"> {
  if (!t) return { targetType: null, targetX: null, targetY: null, targetVx: null, targetVy: null };
  return {
    targetType: (t as Threat & { subtype?: string }).subtype ?? t.type ?? "unknown",
    targetX: t.x,
    targetY: t.y,
    targetVx: t.vx,
    targetVy: t.vy,
  };
}

function run(): void {
  const config = resolveBotConfig(defaultConfig as Record<string, unknown>, PRESET);
  const rng = mulberry32(SEED);
  const botRng = mulberry32(SEED ^ 0x5f3759df);
  setRng(rng);

  const g = initGame() as GameState & { _draftMode: boolean; _draftOffers?: string[] };
  g._draftMode = true;

  const shots: ShotRecord[] = [];
  // Track last-seen position for each tagged interceptor; when its tag disappears
  // from g.interceptors, we know it just got filtered out (=detonated this tick).
  const lastSeen = new Map<number, { x: number; y: number; tick: number }>();
  let lastFireTick = -Infinity;
  let tick = 0;

  function withBotRng<T>(fn: () => T): T {
    setRng(botRng);
    const r = fn();
    setRng(rng);
    return r;
  }

  for (tick = 0; tick < MAX_TICKS; tick++) {
    if (g.state === "gameover") break;

    if (g.state === "shop") {
      const { priority } = withBotRng(() => botDecideUpgrades(g, config));
      if (g._draftOffers) {
        for (const key of priority) {
          const offerId = g._draftOffers.find((nodeId: string) => {
            const node = getUpgradeNodeDef(nodeId);
            return node?.family === key || nodeId === key;
          });
          if (offerId) {
            buyDraftUpgrade(g, offerId);
            break;
          }
        }
      } else {
        let bought = true;
        while (bought) {
          bought = false;
          for (const key of priority) {
            if (buyUpgrade(g, key as UpgradeKey)) bought = true;
          }
        }
      }
      closeShop(g);
    }

    if (g.empReady) {
      const empCfg = (config as { emp?: { impactY?: number; impactRadius?: number; minImminentThreats?: number } }).emp || {};
      const impactY = empCfg.impactY || 420;
      const impactRadius = empCfg.impactRadius || 200;
      const minImminent = empCfg.minImminentThreats || 2;
      let imminent = 0;
      for (const m of g.missiles) if (m.alive && m.y >= impactY && Math.abs(m.x - 460) < impactRadius) imminent++;
      for (const d of g.drones) if (d.alive && d.y >= impactY && Math.abs(d.x - 460) < impactRadius) imminent++;
      if (imminent >= minImminent) fireEmp(g, null);
    }

    const action = withBotRng(() => botDecideAction(g, config, lastFireTick, tick));
    if (action) {
      const fired = fireInterceptor(g, action.x, action.y, tick);
      if (fired) {
        reserveBotTarget(g, action.targetRef, action.reservationUntil ?? tick, tick);
        lastFireTick = tick;
        const ic = g.interceptors[g.interceptors.length - 1];
        const record: ShotRecord = {
          fireTick: tick,
          fireWave: g.wave,
          aimX: action.x,
          aimY: action.y,
          ...snapshotThreat(action.targetRef),
        };
        (ic as unknown as { _shotIdx: number })._shotIdx = shots.length;
        shots.push(record);
      }
    }

    update(g, 1, null);

    // Snapshot positions of all tagged live interceptors after this tick's update.
    const stillAlive = new Set<number>();
    for (const ic of g.interceptors) {
      const idx = (ic as unknown as { _shotIdx?: number })._shotIdx;
      if (typeof idx !== "number") continue;
      stillAlive.add(idx);
      lastSeen.set(idx, { x: ic.x, y: ic.y, tick });
    }
    // Any tagged shot that was alive last tick but missing now — detonated.
    for (const [idx, info] of lastSeen.entries()) {
      if (stillAlive.has(idx)) continue;
      const s = shots[idx];
      if (!s || s.detonationDist !== undefined) continue;
      s.detonationDist = dist(info.x, info.y, s.aimX, s.aimY);
      s.ttd = info.tick - s.fireTick + 1;
    }
  }

  // Aggregate
  const kills = g.stats.missileKills + g.stats.droneKills;
  const eff = kills / Math.max(1, g.stats.shotsFired);
  console.log(
    `\nGame: wave=${g.wave} score=${g.score} cause=${g.state === "gameover" ? "destroyed" : "timeout"}  burjHP=${g.burjHealth} launchersAlive=${g.launcherHP.filter((h) => h > 0).length}/3`,
  );
  console.log(`Shots: ${g.stats.shotsFired}, Kills: ${kills}, Eff: ${eff.toFixed(3)}`);

  // Per-wave fire/efficiency
  const perWave = new Map<number, { fires: number; closeHits: number; aimAvg: number; aimAvgCount: number }>();
  for (const s of shots) {
    const w = s.fireWave;
    if (!perWave.has(w)) perWave.set(w, { fires: 0, closeHits: 0, aimAvg: 0, aimAvgCount: 0 });
    const p = perWave.get(w)!;
    p.fires++;
    if (s.detonationDist !== undefined) {
      p.aimAvg += s.detonationDist;
      p.aimAvgCount++;
      if (s.detonationDist < 80) p.closeHits++;
    }
  }
  console.log(`\nPer-wave:`);
  for (const [w, p] of [...perWave.entries()].sort((a, b) => a[0] - b[0])) {
    const avg = p.aimAvgCount > 0 ? p.aimAvg / p.aimAvgCount : 0;
    console.log(`  wave ${w}: fires=${p.fires}  closeHits<80=${p.closeHits}  avgDetDist=${avg.toFixed(0)}`);
  }

  const detonated = shots.filter((s) => s.detonationDist !== undefined);
  console.log(`\nDetonations: ${detonated.length}/${shots.length} (others still in flight at end)`);
  if (detonated.length === 0) return;

  const ttds = detonated.map((s) => s.ttd ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  if (ttds.length) {
    const med = ttds[Math.floor(ttds.length / 2)];
    const p10 = ttds[Math.floor(ttds.length * 0.1)];
    const p90 = ttds[Math.floor(ttds.length * 0.9)];
    console.log(`Time-to-detonate (ticks): median=${med}, p10=${p10}, p90=${p90}`);
  }

  // Detonation distance from AIM (how far interceptor was from aim when it died)
  // Small: aim was right + interceptor reached it. Large: detonated early on a drifting target.
  const detDistsToAim = detonated.map((s) => s.detonationDist ?? 0).sort((a, b) => a - b);
  if (detDistsToAim.length) {
    const med = detDistsToAim[Math.floor(detDistsToAim.length / 2)];
    const p10 = detDistsToAim[Math.floor(detDistsToAim.length * 0.1)];
    const p90 = detDistsToAim[Math.floor(detDistsToAim.length * 0.9)];
    console.log(`Detonation distance from aim: median=${med.toFixed(0)}, p10=${p10.toFixed(0)}, p90=${p90.toFixed(0)}`);
  }

  // Lead error: where target actually was at detonation time vs aim point
  // For each shot, simulate target's actual final position by extrapolating from initial v, accel
  // (already integrated by sim so we'd need positions at det time — skipping for now;
  // detonationDist + ttd is the cleanest signal we have post-hoc)

  // Per-target-type breakdown
  const byType: Record<string, { count: number; ttdSum: number; detSum: number }> = {};
  for (const s of detonated) {
    const t = s.targetType || "unknown";
    byType[t] = byType[t] || { count: 0, ttdSum: 0, detSum: 0 };
    byType[t].count++;
    byType[t].ttdSum += s.ttd ?? 0;
    byType[t].detSum += s.detonationDist ?? 0;
  }
  console.log(`\nPer-target-type:`);
  for (const [type, stats] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `  ${type.padEnd(20)} count=${stats.count}  avgTTD=${(stats.ttdSum / stats.count).toFixed(1)}  avgDetDist=${(stats.detSum / stats.count).toFixed(1)}`,
    );
  }
}

run();
