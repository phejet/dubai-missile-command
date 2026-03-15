export const CANVAS_W = 900;
export const CANVAS_H = 640;
export const GROUND_Y = 570;
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
};

export const BURJ_X = 460;
export const BURJ_H = 340;

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

export function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
export function rand(a, b) {
  return a + Math.random() * (b - a);
}
export function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function pickTarget(g, fromX) {
  // 30% chance to target Burj
  if (g.burjAlive && Math.random() < 0.3) return { x: BURJ_X, y: CITY_Y };
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
  const pick = Math.min(all.length - 1, Math.random() < 0.7 ? 0 : 1);
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
  if (bestIdx === -1) return;
  g.ammo[bestIdx]--;
  g.stats.shotsFired++;
  const l = LAUNCHERS[bestIdx];
  const speed = 5;
  const dx = targetX - l.x;
  const dy = targetY - l.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  g.interceptors.push({
    x: l.x,
    y: l.y,
    targetX,
    targetY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    trail: [],
    alive: true,
  });
}

export function createExplosion(g, x, y, radius, color, playerCaused) {
  g.explosions.push({
    x,
    y,
    radius: 0,
    maxRadius: radius,
    growing: true,
    alpha: 1,
    color: color || COL.explosion,
    playerCaused: !!playerCaused,
  });
  for (let i = 0; i < 12; i++) {
    const angle = rand(0, Math.PI * 2);
    const sp = rand(1, 4);
    g.particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: rand(20, 50),
      maxLife: 50,
      color: Math.random() > 0.5 ? "#ffcc00" : "#ff6600",
      size: rand(1, 3),
    });
  }
  g.shakeTimer = 8;
  g.shakeIntensity = radius / 10;
}
