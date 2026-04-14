import { CANVAS_W, BURJ_X } from "./game-logic";
import type { Star } from "./types";

const SKY_FRAME_COUNT = 8;
const SKY_PERIOD_SECONDS = 24;
const GAME_TITLE_STARFIELD_DENSITY = 260;
const HERO_STAR_THRESHOLD = 0.72;

export interface SkyAssets {
  frames: HTMLCanvasElement[];
  frameCount: number;
  period: number;
}

type PreparedStar = Star & {
  seed: number;
  hero: boolean;
};

function hash01(a: number, b = 0, c = 0, d = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

function getStarTwinkleProfile(time: number, phase: number, seed: number) {
  const hero = seed > HERO_STAR_THRESHOLD;
  const seedA = hash01(seed, phase, 1.7);
  const seedB = hash01(seed, phase, 8.3);
  const seedC = hash01(seed, phase, 15.1);
  const timeA = time + seedA * 23 + seedB * 11;
  const timeB = time + seedB * 31 + seedC * 7;
  const timeC = time + seedC * 41 + seedA * 13;
  const twinkleRate = 1.05;
  const shimmer =
    0.55 +
    0.28 * Math.sin(timeA * twinkleRate * (0.74 + seedA * 0.43) + phase * (0.92 + seedB * 0.28) + seedC * Math.PI * 2) +
    0.17 * Math.sin(timeB * twinkleRate * (1.48 + seedC * 0.62) + phase * (0.34 + seedA * 0.12) + seedB * Math.PI * 2);
  const flareWave =
    0.5 +
    0.5 *
      Math.sin(
        timeB * twinkleRate * (0.52 + seedA * 0.28) +
          phase * (0.74 + seedB * 0.24) +
          seedC * 9.7 +
          Math.sin(timeC * twinkleRate * (0.43 + seedC * 0.24) + seedA * 7.3) * 1.4,
      );
  const flare = hero ? Math.pow(flareWave, 2.2) : 0;
  return { shimmer, flare };
}

function createStubCanvasContext(width: number, height: number): CanvasRenderingContext2D {
  const raw: Record<string, unknown> = {
    fillRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    canvas: { width, height },
    fillStyle: "",
    globalAlpha: 1,
  };
  return raw as unknown as CanvasRenderingContext2D;
}

export function createSpriteCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  const ctx = createStubCanvasContext(width, height);
  return {
    width,
    height,
    getContext: (kind: string) => (kind === "2d" ? ctx : null),
  } as unknown as HTMLCanvasElement;
}

function drawStaticBackground(ctx: CanvasRenderingContext2D, renderHeight: number, groundY: number) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGrad.addColorStop(0, "#050810");
  skyGrad.addColorStop(0.5, "#0a1030");
  skyGrad.addColorStop(1, "#120d24");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  ctx.save();
  ctx.fillStyle = "rgba(0,255,200,0.018)";
  for (let y = 0; y < renderHeight; y += 3) ctx.fillRect(0, y, CANVAS_W, 1);
  ctx.restore();

  const skyGlow = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGlow.addColorStop(0, "#050812");
  skyGlow.addColorStop(0.5, "#0a1030");
  skyGlow.addColorStop(1, "#130f2d");
  ctx.fillStyle = skyGlow;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  for (let i = 0; i < GAME_TITLE_STARFIELD_DENSITY; i++) {
    const sx = hash01(i, 2, 7) * CANVAS_W;
    const sy = hash01(i, 5, 11) * 1500 + 8;
    const size = (0.7 + hash01(i, 3, 1) * 1.6) * 0.92;
    ctx.fillStyle = "rgba(220, 235, 255, 0.428)";
    ctx.fillRect(sx, sy, size, size);
  }

  ctx.save();
  ctx.translate(764, 56);
  ctx.fillStyle = "rgba(235, 232, 214, 0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#070912";
  ctx.beginPath();
  ctx.arc(6, -3, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const bloom = ctx.createRadialGradient(BURJ_X, groundY - 220, 20, BURJ_X, groundY - 220, 320);
  bloom.addColorStop(0, "rgba(110, 205, 255, 0.12)");
  bloom.addColorStop(0.45, "rgba(90, 120, 255, 0.08)");
  bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);
}

function drawBakedStars(ctx: CanvasRenderingContext2D, stars: PreparedStar[], time: number) {
  for (const star of stars) {
    if (star.hero) continue;
    ctx.fillStyle = "rgba(220, 235, 255, 0.158)";
    ctx.fillRect(star.x, star.y, star.size * 1.2, star.size * 1.2);
  }

  ctx.fillStyle = "rgb(220,235,255)";
  for (const star of stars) {
    if (!star.hero) continue;
    const { shimmer, flare } = getStarTwinkleProfile(time, star.twinkle, star.seed);
    const alpha = 0.08 + shimmer * 0.1 + flare * 0.42;
    const sizeMul = 1 + flare * 0.95;
    ctx.globalAlpha = alpha;
    ctx.fillRect(star.x, star.y, star.size * 1.2 * sizeMul, star.size * 1.2 * sizeMul);
    if (flare > 0.12) {
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.globalAlpha = 0.12 + flare * 0.52;
      const reach = star.size * (0.8 + flare * 2.4);
      ctx.fillRect(star.x - reach, star.y, reach * 2.4, Math.max(1, star.size * 0.45));
      ctx.fillRect(star.x, star.y - reach, Math.max(1, star.size * 0.45), reach * 2.4);
      ctx.fillStyle = "rgb(220,235,255)";
    }
  }
  ctx.globalAlpha = 1;
}

export function buildSkyAssets(stars: Star[], renderHeight: number, groundY: number): SkyAssets {
  const preparedStars: PreparedStar[] = stars.map((star) => {
    const seed = hash01(star.x, star.y, star.twinkle);
    return { ...star, seed, hero: seed > HERO_STAR_THRESHOLD };
  });

  const frames = Array.from({ length: SKY_FRAME_COUNT }, (_, index) => {
    const canvas = createSpriteCanvas(CANVAS_W, renderHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    drawStaticBackground(ctx, renderHeight, groundY);
    drawBakedStars(ctx, preparedStars, (index / SKY_FRAME_COUNT) * SKY_PERIOD_SECONDS);
    return canvas;
  });

  return {
    frames,
    frameCount: SKY_FRAME_COUNT,
    period: SKY_PERIOD_SECONDS,
  };
}
