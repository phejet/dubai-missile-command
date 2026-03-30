export const CANVAS_W = 900;
export const CANVAS_H = 1600;
export const GROUND_Y = 1530;
export const CITY_Y = GROUND_Y;

export const COL = {
  sky1: "#0a0e1a",
  sky2: "#1a1040",
  sky3: "#2a1050",
  ground: "#1a1a2e",
  sand: "#2d2845",
  burj: "#c0c8d8",
  burjGlow: "#4488ff",
  building: "#1a2040",
  buildingLit: "#ffdd66",
  missile: "#ff3333",
  drone: "#ff6600",
  interceptor: "#44ffaa",
  explosion: "#ffaa00",
  plane: "#ffffff",
  planeLight: "#ff0000",
  text: "#ffffff",
  hud: "#00ffcc",
  warning: "#ff4444",
  gold: "#ffd700",
  upgradeBg: "#0c1225",
  panelBg: "#111a30",
  panelBorder: "#1a3060",
  laser: "#ff2200",
  flare: "#ff8833",
  hornet: "#ffcc00",
  roadrunner: "#44aaff",
  phalanx: "#ff8844",
  patriot: "#88ff44",
  launcherKit: "#66aaff",
  emp: "#cc44ff",
  mirv: "#dd4422",
};

export const BURJ_X = 460;
export const BURJ_H = 340;
export const MAX_PARTICLES = 500;

// Burj half-width at a given y — matches the rendered tapered silhouette
// Rendered shape: spire tip at y=GROUND_Y-BURJ_H-30 (w=0),
// then ±3 at top of tower, tapering to ±15 at base
export const BURJ_SHAPE = [
  [1.0, 3],
  [0.7, 7],
  [0.4, 11],
  [0.15, 13],
  [0, 15],
];
export function burjHalfW(py) {
  if (py < GROUND_Y - BURJ_H - 30 || py > GROUND_Y) return 0;
  if (py < GROUND_Y - BURJ_H) return 1; // spire
  const t = (GROUND_Y - py) / BURJ_H; // 1=top, 0=base
  for (let i = 0; i < BURJ_SHAPE.length - 1; i++) {
    const [t0, w0] = BURJ_SHAPE[i],
      [t1, w1] = BURJ_SHAPE[i + 1];
    if (t <= t0 && t >= t1) return w1 + ((t - t1) / (t0 - t1)) * (w0 - w1);
  }
  return 15;
}

export const LAUNCHERS = [
  { x: 60, y: GROUND_Y - 5 },
  { x: 550, y: GROUND_Y - 5 },
  { x: 860, y: GROUND_Y - 5 },
];

let _rng = Math.random;
export function setRng(fn) {
  _rng = fn;
}
export function getRng() {
  return _rng;
}

export function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
export function rand(a, b) {
  return a + _rng() * (b - a);
}
export function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function pickTarget(g, fromX) {
  // 30% chance to target Burj
  if (g.burjAlive && _rng() < 0.3) return { x: BURJ_X, y: CITY_Y };
  // 70% target defense sites / launchers, closest first
  const all = [];
  g.defenseSites.forEach((s) => {
    if (s.alive) all.push({ x: s.x, y: s.y });
  });
  LAUNCHERS.forEach((l, i) => {
    if (g.launcherHP[i] > 0) all.push({ x: l.x, y: l.y });
  });
  if (all.length === 0) {
    if (g.burjAlive) return { x: BURJ_X, y: CITY_Y };
    return null;
  }
  all.sort((a, b) => Math.abs(a.x - fromX) - Math.abs(b.x - fromX));
  const pick = Math.min(all.length - 1, _rng() < 0.7 ? 0 : 1);
  return all[pick];
}

export function fireInterceptor(g, targetX, targetY) {
  let bestIdx = -1,
    bestDist = Infinity;
  for (let i = 0; i < LAUNCHERS.length; i++) {
    if (g.ammo[i] <= 0 || g.launcherHP[i] <= 0) continue;
    const d = dist(LAUNCHERS[i].x, LAUNCHERS[i].y, targetX, targetY);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return false;
  if (!g._debugMode) g.ammo[bestIdx]--;
  g.stats.shotsFired++;
  if (!g.launcherFireTick) g.launcherFireTick = [0, 0, 0];
  g.launcherFireTick[bestIdx] = g._replayTick || 0;
  const l = LAUNCHERS[bestIdx];
  const targetAngle = Math.atan2(targetY - l.y, targetX - l.x);
  const launchAngle = -Math.PI / 2 + (targetAngle + Math.PI / 2) * 0.32;
  const speed = 10.88;
  const dx = targetX - l.x;
  const dy = targetY - l.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return false;
  g.interceptors.push({
    x: l.x,
    y: l.y,
    targetX,
    targetY,
    vx: Math.cos(launchAngle) * speed,
    vy: Math.sin(launchAngle) * speed,
    heading: launchAngle,
    speed,
    accel: 1.03,
    maxSpeed: 18.56,
    turnRate: 0.22,
    trail: [],
    alive: true,
  });
  return true;
}

// Editor override helper — returns override value if editor is active, otherwise fallback
export function ov(key, fallback) {
  const o = typeof window !== "undefined" && window.__editorOverrides;
  return o && key in o ? o[key] : fallback;
}

let _explosionId = 0;
export function createExplosion(g, x, y, radius, color, playerCaused, initialRadius = 0, options = {}) {
  const id = _explosionId++;
  g.explosions.push({
    id,
    x,
    y,
    radius: initialRadius,
    maxRadius: radius,
    growing: true,
    alpha: 1,
    color: color || COL.explosion,
    playerCaused: !!playerCaused,
    harmless: !!options.harmless,
    chain: !!options.chain,
    rootExplosionId: options.rootExplosionId ?? null,
    ringRadius: 0,
    ringAlpha: 1,
  });
  let budget = MAX_PARTICLES - g.particles.length;
  const heavy = !playerCaused; // threat explosions get more/bigger particles
  // Dot particles (smoke puffs)
  const dotCount = Math.min(heavy ? ov("particle.dotCountHeavy", 10) : ov("particle.dotCountLight", 6), budget);
  for (let i = 0; i < dotCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1, heavy ? 6 : 4);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(20, heavy ? 70 : 50),
      maxLife: heavy ? 70 : 50,
      color: _rng() > 0.5 ? "#ffcc00" : "#ff6600",
      size: rand(heavy ? 2 : 1, heavy ? 5 : 3),
    });
  }
  budget -= dotCount;
  // Debris shards — spinning triangular fragments (skip for interceptor detonation)
  const debrisCount = playerCaused && !options.chain ? 0 : Math.min(ov("particle.debrisCount", 16), budget);
  for (let i = 0; i < debrisCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1.5, 4);
    const dark = _rng() > 0.4;
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp - rand(0.5, 2),
      life: rand(30, 60),
      maxLife: 60,
      color: dark ? "#666" : _rng() > 0.5 ? "#994400" : "#aa5500",
      size: rand(1, 4),
      type: "debris",
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.25, 0.25),
      gravity: ov("particle.debrisGravity", 0.15),
      w: rand(2, 4),
      h: rand(2, 5),
      drag: ov("particle.debrisDrag", 0.96),
    });
  }
  budget -= debrisCount;
  // Sparks — fast bright particles with drag
  const sparkCount = Math.min(heavy ? ov("particle.sparkCountHeavy", 14) : ov("particle.sparkCountLight", 8), budget);
  for (let i = 0; i < sparkCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(4, heavy ? 12 : 8);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(10, heavy ? 35 : 25),
      maxLife: heavy ? 35 : 25,
      color: _rng() > 0.5 ? "#fff" : "#ffee88",
      size: rand(0.5, heavy ? 2.5 : 1.5),
      type: "spark",
      drag: ov("particle.sparkDrag", 0.93),
      gravity: 0.02,
    });
  }
  g.shakeTimer = 8;
  g.shakeIntensity = radius / 10;
}

export function destroyDefenseSite(g, site) {
  site.alive = false;
  // isSiteAlive() prevents new spawns; existing in-flight entities finish naturally
}

export function getPhalanxTurrets(level) {
  const turrets = [{ x: BURJ_X, y: GROUND_Y - 30 }];
  if (level >= 2) turrets.push({ x: 800, y: GROUND_Y - 30 });
  if (level >= 3) turrets.push({ x: 200, y: GROUND_Y - 30 });
  return turrets;
}

export function getKillReward(target) {
  if (target.type === "drone") return target.subtype === "shahed238" ? 40 : 20;
  if (target.type === "mirv") return 100;
  if (target.type === "bomb") return 42;
  if (target.type === "mirv_warhead") return 56;
  return 28;
}

export function getAmmoCapacity(wave, launcherKitLevel) {
  const baseAmmo = 12 + wave * 1;
  const multiplier = launcherKitLevel >= 3 ? 2 : launcherKitLevel >= 1 ? 1.5 : 1;
  return Math.round(baseAmmo * multiplier);
}

export function getMultiKillBonus(kills) {
  if (kills >= 4) return 700;
  if (kills === 3) return 350;
  if (kills === 2) return 150;
  return 0;
}

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function sampleCubicBezier(p0, p1, p2, p3, stepSize) {
  const N = 500;
  const fine = [];
  for (let i = 0; i <= N; i++) {
    fine.push(cubicBezier(p0, p1, p2, p3, i / N));
  }
  // Compute cumulative arc lengths
  const arcLen = [0];
  for (let i = 1; i < fine.length; i++) {
    const dx = fine[i].x - fine[i - 1].x;
    const dy = fine[i].y - fine[i - 1].y;
    arcLen.push(arcLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  // Walk at uniform stepSize intervals
  const totalLen = arcLen[arcLen.length - 1];
  const waypoints = [{ x: fine[0].x, y: fine[0].y }];
  let nextDist = stepSize;
  for (let i = 1; i < fine.length; i++) {
    while (nextDist <= arcLen[i] && nextDist <= totalLen) {
      const segStart = arcLen[i - 1];
      const segEnd = arcLen[i];
      const frac = segEnd > segStart ? (nextDist - segStart) / (segEnd - segStart) : 0;
      waypoints.push({
        x: fine[i - 1].x + (fine[i].x - fine[i - 1].x) * frac,
        y: fine[i - 1].y + (fine[i].y - fine[i - 1].y) * frac,
      });
      nextDist += stepSize;
    }
  }
  // Ensure endpoint is included
  const last = fine[fine.length - 1];
  const wLast = waypoints[waypoints.length - 1];
  if (Math.abs(wLast.x - last.x) > 0.5 || Math.abs(wLast.y - last.y) > 0.5) {
    waypoints.push({ x: last.x, y: last.y });
  }
  return waypoints;
}

export function computeShahed238Path(spawnX, spawnY, goingRight, speed, target) {
  const dir = goingRight ? 1 : -1;

  // Transition point — where cruise ends and dive arc begins
  const transX = spawnX + dir * CANVAS_W * 0.55;
  const transY = spawnY + rand(25, 50);

  // Cruise segment (horizontal flight with gentle descent)
  const cruiseWaypoints = sampleCubicBezier(
    { x: spawnX, y: spawnY },
    { x: spawnX + dir * CANVAS_W * 0.2, y: spawnY + rand(5, 15) },
    { x: transX - dir * 80, y: spawnY + rand(15, 30) },
    { x: transX, y: transY },
    speed,
  );

  const diveStartIndex = cruiseWaypoints.length;

  // Dive arc segment (smooth bank into target)
  // P1 extends forward to maintain momentum. P2 approaches at ~45-60° angle
  // by offsetting horizontally from the target (same side the drone came from).
  const diveExtend = Math.abs(target.x - transX) * 0.5;
  const diveWaypoints = sampleCubicBezier(
    { x: transX, y: transY },
    { x: transX + dir * Math.max(diveExtend, 120), y: transY + 80 },
    { x: target.x + dir * 100, y: target.y - 150 },
    { x: target.x, y: target.y },
    speed * 1.2,
  );

  const waypoints = cruiseWaypoints.concat(diveWaypoints.slice(1));

  // Bomb drop positions: 35% and 65% through cruise
  const bombIdx0 = Math.floor(diveStartIndex * 0.35);
  const bombIdx1 = Math.min(diveStartIndex - 1, bombIdx0 + Math.min(90, Math.floor(diveStartIndex * 0.3)));
  const bombIndices = [Math.max(1, bombIdx0), Math.max(2, bombIdx1)];

  return { waypoints, diveStartIndex, bombIndices };
}

export function damageTarget(g, target, damage, color, radius, { noExplosion = false } = {}) {
  if (target.type === "drone") {
    target.health -= damage;
    if (target.health <= 0) {
      target.alive = false;
      g.score += getKillReward(target);
      g.stats.droneKills++;
      if (!noExplosion) createExplosion(g, target.x, target.y, radius, color);
    }
  } else if (target.type === "mirv") {
    target.health -= damage;
    if (target.health <= 0) {
      target.alive = false;
      g.score += getKillReward(target);
      g.stats.missileKills++;
      if (!noExplosion) createExplosion(g, target.x, target.y, 60, color);
    }
  } else {
    target.alive = false;
    g.score += getKillReward(target);
    g.stats.missileKills++;
    if (!noExplosion) createExplosion(g, target.x, target.y, radius, color);
  }
}
