import { CANVAS_W, BURJ_H, BURJ_X, SCENIC_BUILDING_LAYOUT } from "./game-logic";
import type { Building, Star } from "./types";

const SKY_FRAME_COUNT = 8;
const SKY_PERIOD_SECONDS = 24;
const GAME_TITLE_STARFIELD_DENSITY = 260;
const HERO_STAR_THRESHOLD = 0.72;
const BURJ_ANIM_FRAME_COUNT = 8;
const BURJ_ANIM_PERIOD_SECONDS = 20;
const GLOW_MARGIN = 80;
const GAMEPLAY_BUILDING_ANIM_FRAME_COUNT = 8;
const GAMEPLAY_BUILDING_ANIM_PERIOD_SECONDS = 20;
const TITLE_BUILDING_ANIM_FRAME_COUNT = 8;
const TITLE_BUILDING_BAKE_PERIOD_SECONDS = 40;
const TITLE_BUILDING_LIT_THRESHOLD = 0.08;

export interface SkyAssets {
  frames: HTMLCanvasElement[];
  frameCount: number;
  period: number;
}

export interface BurjAssets {
  staticSprite: HTMLCanvasElement;
  animFrames: HTMLCanvasElement[];
  offset: { x: number; y: number };
  frameCount: number;
  period: number;
  resolutionScale: number;
}

export interface BuildingAssets {
  staticSprites: HTMLCanvasElement[];
  animFrames: HTMLCanvasElement[][];
  staticOffsets: Array<{ x: number; y: number }>;
  animOffsets: Array<{ x: number; y: number }>;
  frameCount: number;
  period: number;
}

export type TitleTower = {
  x: number;
  w: number;
  h: number;
  windows: number;
  profile?: "generic" | "leftLandmark" | "twinSpire" | "slantedBlock" | "eggTower" | "bladeTower";
  roof?:
    | "flat"
    | "spire"
    | "crown"
    | "slantL"
    | "slantR"
    | "needle"
    | "roundedCrownL"
    | "twinCrown"
    | "curvedR"
    | "curvedL"
    | "tapered";
  glow?: number;
};

type PreparedStar = Star & {
  seed: number;
  hero: boolean;
};

interface DrawSharedTowerOptions {
  structureOnly?: boolean;
  animOnly?: boolean;
  litOnlyAnim?: boolean;
  litThreshold?: number;
  quantizedAnim?: boolean;
}

export const TITLE_SKYLINE_TOWERS: TitleTower[] = [...SCENIC_BUILDING_LAYOUT];

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
    clip: () => {},
    stroke: () => {},
    scale: () => {},
    rotate: () => {},
    ellipse: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    setTransform: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    canvas: { width, height },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    font: "10px sans-serif",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  return raw as unknown as CanvasRenderingContext2D;
}

export function getLightFlicker(time: number, seed: number) {
  const seedA = hash01(seed, 1.1, 3.7);
  const seedB = hash01(seed, 5.9, 8.2);
  const seedC = hash01(seed, 11.7, 2.4);
  const swell = 0.5 + 0.5 * Math.sin(time * (0.0056 + seedA * 0.00595) + seedB * Math.PI * 2);
  const flutter =
    0.5 +
    0.5 *
      Math.sin(
        time * (0.020125 + seedB * 0.01925) +
          seedC * Math.PI * 2 +
          Math.sin(time * (0.01085 + seedA * 0.0049) + seedB * 7.1) * (0.35 + seedC * 0.5),
      );
  const sparkle = Math.pow(0.5 + 0.5 * Math.sin(time * (0.042 + seedC * 0.02625) + seedA * 8.4), 5);
  return Math.min(1, 0.32 + swell * 0.26 + flutter * 0.3 + sparkle * 0.42);
}

export function drawFlickerWindows(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    w,
    h,
    rows,
    cols,
    time,
    seed,
    warmBias = 0.5,
    paneW = 3,
    paneH = 3,
    gapX = 4,
    gapY = 6,
    drawUnlit = true,
    litThreshold = -0.42,
    groupRows = 1,
    groupCols = 1,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    rows: number;
    cols: number;
    time: number;
    seed: number;
    warmBias?: number;
    paneW?: number;
    paneH?: number;
    gapX?: number;
    gapY?: number;
    drawUnlit?: boolean;
    litThreshold?: number;
    groupRows?: number;
    groupCols?: number;
  },
) {
  const totalW = cols * paneW + (cols - 1) * gapX;
  const totalH = rows * paneH + (rows - 1) * gapY;
  const startX = x + Math.max(0, (w - totalW) * 0.5);
  const startY = y + Math.max(0, (h - totalH) * 0.5);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const groupRow = Math.floor(row / groupRows);
      const groupCol = Math.floor(col / groupCols);
      const lightSeed = hash01(seed, groupRow, groupCol);
      const paneX = startX + col * (paneW + gapX);
      const paneY = startY + row * (paneH + gapY);
      const lit =
        Math.sin(time * (0.044 + lightSeed * 0.028) + groupRow * 1.17 + groupCol * 2.03 + lightSeed * 12) >
        litThreshold;
      if (!lit) {
        if (!drawUnlit) continue;
        ctx.fillStyle = "rgba(3, 6, 12, 0.74)";
        ctx.fillRect(paneX, paneY, paneW, paneH);
        continue;
      }
      const flicker = getLightFlicker(time, seed * 13 + groupRow * 1.9 + groupCol * 2.7);
      const warm = hash01(seed, groupRow, groupCol, 4.7) < warmBias;
      const spillRgb = warm ? "255, 198, 122" : "210, 232, 255";
      const coreRgb = warm ? "255, 234, 186" : "236, 246, 255";
      ctx.fillStyle = `rgba(${spillRgb}, ${0.06 + flicker * 0.24})`;
      ctx.fillRect(paneX - 1, paneY - 1, paneW + 2, paneH + 2);
      ctx.fillStyle = `rgba(${coreRgb}, ${0.12 + flicker * 0.72})`;
      ctx.fillRect(paneX, paneY, paneW, paneH);
    }
  }
}

export function drawSharedTower(
  ctx: CanvasRenderingContext2D,
  tower: TitleTower,
  baseY: number,
  t: number,
  offset = 0,
  glowScale = 1,
  opts: DrawSharedTowerOptions = {},
) {
  if (opts.structureOnly && opts.animOnly) return;
  const x = tower.x + offset;
  const top = baseY - tower.h;
  const right = x + tower.w;
  const mid = x + tower.w / 2;

  ctx.save();
  if (!opts.animOnly) {
    if (tower.glow) {
      const glow = ctx.createRadialGradient(mid, top + tower.h * 0.3, 0, mid, top + tower.h * 0.3, tower.w * 1.8);
      glow.addColorStop(0, `rgba(120, 190, 255, ${tower.glow * glowScale})`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - tower.w, top - tower.w, tower.w * 3, tower.h + tower.w * 2);
    }

    ctx.beginPath();
    switch (tower.roof ?? "flat") {
      case "spire":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 12);
        ctx.lineTo(mid - 2, top + 12);
        ctx.lineTo(mid, top - 16);
        ctx.lineTo(mid + 2, top + 12);
        ctx.lineTo(right, top + 12);
        ctx.lineTo(right, baseY);
        break;
      case "needle":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 8);
        ctx.lineTo(mid - 3, top + 8);
        ctx.lineTo(mid - 1, top - 24);
        ctx.lineTo(mid + 1, top - 24);
        ctx.lineTo(mid + 3, top + 8);
        ctx.lineTo(right, top + 8);
        ctx.lineTo(right, baseY);
        break;
      case "crown":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 16);
        ctx.lineTo(x + tower.w * 0.22, top + 4);
        ctx.lineTo(mid - 3, top + 14);
        ctx.lineTo(mid, top - 12);
        ctx.lineTo(mid + 3, top + 14);
        ctx.lineTo(x + tower.w * 0.78, top + 4);
        ctx.lineTo(right, top + 16);
        ctx.lineTo(right, baseY);
        break;
      case "roundedCrownL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 34);
        ctx.quadraticCurveTo(x + tower.w * 0.06, top + 6, x + tower.w * 0.34, top + 4);
        ctx.lineTo(x + tower.w * 0.34, top - 18);
        ctx.lineTo(x + tower.w * 0.43, top - 18);
        ctx.lineTo(x + tower.w * 0.43, top + 6);
        ctx.quadraticCurveTo(x + tower.w * 0.68, top + 8, right, top + 24);
        ctx.lineTo(right, baseY);
        break;
      case "twinCrown":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 18);
        ctx.lineTo(x + tower.w * 0.18, top + 10);
        ctx.lineTo(x + tower.w * 0.22, top - 16);
        ctx.lineTo(x + tower.w * 0.3, top - 16);
        ctx.lineTo(x + tower.w * 0.34, top + 12);
        ctx.lineTo(x + tower.w * 0.5, top + 16);
        ctx.lineTo(x + tower.w * 0.66, top + 12);
        ctx.lineTo(x + tower.w * 0.7, top - 16);
        ctx.lineTo(x + tower.w * 0.78, top - 16);
        ctx.lineTo(x + tower.w * 0.82, top + 10);
        ctx.lineTo(right, top + 18);
        ctx.lineTo(right, baseY);
        break;
      case "curvedR":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 42);
        ctx.quadraticCurveTo(x + tower.w * 0.12, top + 20, x + tower.w * 0.46, top + 12);
        ctx.quadraticCurveTo(x + tower.w * 0.9, top + 26, right, top + 46);
        ctx.lineTo(right, baseY);
        break;
      case "curvedL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 46);
        ctx.quadraticCurveTo(x + tower.w * 0.18, top + 18, x + tower.w * 0.58, top + 10);
        ctx.quadraticCurveTo(x + tower.w * 0.88, top + 6, right, top + 24);
        ctx.lineTo(right, baseY);
        break;
      case "tapered":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + tower.w * 0.04, top + 22);
        ctx.lineTo(mid - 3, top + 10);
        ctx.lineTo(mid, top - 8);
        ctx.lineTo(mid + 3, top + 10);
        ctx.lineTo(right - tower.w * 0.04, top + 22);
        ctx.lineTo(right, baseY);
        break;
      case "slantL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 4);
        ctx.lineTo(right, top + 18);
        ctx.lineTo(right, baseY);
        break;
      case "slantR":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 18);
        ctx.lineTo(right, top + 4);
        ctx.lineTo(right, baseY);
        break;
      default:
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top);
        ctx.lineTo(right, top);
        ctx.lineTo(right, baseY);
        break;
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
    ctx.fill();

    ctx.fillStyle = "rgba(18, 24, 38, 0.94)";
    ctx.fillRect(x + 1, top + 2, Math.max(0, tower.w - 2), 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.fillRect(right - 3, top + 8, 3, tower.h - 8);
  }

  if (!opts.structureOnly && tower.profile === "leftLandmark") {
    const ribAlphaA = getLightFlicker(t, tower.x * 0.09 + tower.h * 0.03 + 1.1);
    const ribAlphaB = getLightFlicker(t, tower.x * 0.07 + tower.w * 0.13 + 2.6);
    ctx.fillStyle = `rgba(245, 246, 250, ${0.46 + ribAlphaA * 0.38})`;
    ctx.fillRect(x + tower.w * 0.28, top + 22, 2.1, tower.h - 42);
    ctx.fillStyle = `rgba(225, 238, 252, ${0.26 + ribAlphaB * 0.26})`;
    ctx.fillRect(x + tower.w * 0.39, top + 18, 1.4, tower.h - 52);
    for (let row = 0; row < 12; row++) {
      const wy = top + 26 + row * 12;
      const rowFlicker = getLightFlicker(t, tower.x * 0.11 + row * 1.7 + 4.2);
      ctx.fillStyle =
        row % 2 === 0
          ? `rgba(250, 240, 212, ${0.08 + rowFlicker * 0.72})`
          : `rgba(215, 228, 246, ${0.02 + rowFlicker * 0.28})`;
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.9);
    }
    drawFlickerWindows(ctx, {
      x: x + tower.w * 0.48,
      y: top + 28,
      w: tower.w * 0.28,
      h: tower.h - 44,
      rows: 10,
      cols: 2,
      time: t,
      seed: tower.x * 0.17 + 2.1,
      warmBias: 0.75,
      paneW: 2,
      paneH: 3,
      gapX: 4,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "twinSpire") {
    const spineA = getLightFlicker(t, tower.x * 0.08 + 6.1);
    const spineB = getLightFlicker(t, tower.x * 0.11 + 8.7);
    ctx.fillStyle = `rgba(250, 244, 220, ${0.24 + spineA * 0.34})`;
    ctx.fillRect(x + tower.w * 0.23, top + 18, 1.6, tower.h - 28);
    ctx.fillStyle = `rgba(242, 236, 214, ${0.22 + spineB * 0.32})`;
    ctx.fillRect(x + tower.w * 0.73, top + 18, 1.6, tower.h - 28);
    for (let row = 0; row < 11; row++) {
      const wy = top + 24 + row * 13;
      const rowFlicker = getLightFlicker(t, tower.x * 0.06 + row * 2.1 + 9.2);
      ctx.fillStyle =
        row % 3 === 0
          ? `rgba(255, 232, 186, ${0.06 + rowFlicker * 0.68})`
          : `rgba(205, 220, 240, ${0.01 + rowFlicker * 0.22})`;
      ctx.fillRect(x + 5, wy, tower.w - 10, 1.6);
    }
    drawFlickerWindows(ctx, {
      x: x + 6,
      y: top + 28,
      w: tower.w - 12,
      h: tower.h - 40,
      rows: 9,
      cols: 3,
      time: t,
      seed: tower.x * 0.19 + 4.8,
      warmBias: 0.68,
      paneW: 2.2,
      paneH: 3,
      gapX: 5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "slantedBlock") {
    for (let row = 0; row < 10; row++) {
      const wy = top + 16 + row * 12;
      const inset = row * 0.95;
      const rowFlicker = getLightFlicker(t, tower.x * 0.09 + row * 1.9 + 12.4);
      ctx.fillStyle = `rgba(224, 236, 250, ${0.02 + rowFlicker * 0.32})`;
      ctx.fillRect(x + 6 + inset, wy, tower.w - 18 - inset, 1.5);
    }
    ctx.fillStyle = `rgba(248, 244, 222, ${0.22 + getLightFlicker(t, tower.x * 0.05 + 15.1) * 0.34})`;
    ctx.fillRect(right - 4, top + 9, 2, tower.h - 18);
    drawFlickerWindows(ctx, {
      x: x + 7,
      y: top + 24,
      w: tower.w - 16,
      h: tower.h - 34,
      rows: 8,
      cols: 3,
      time: t,
      seed: tower.x * 0.13 + 7.4,
      warmBias: 0.58,
      paneW: 2.6,
      paneH: 2.8,
      gapX: 5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "eggTower") {
    for (let row = 0; row < 9; row++) {
      const wy = top + 22 + row * 11;
      const shrink = Math.abs(row - 4) * 0.8;
      const rowFlicker = getLightFlicker(t, tower.x * 0.08 + row * 1.4 + 18.3);
      ctx.fillStyle = `rgba(224, 238, 252, ${0.02 + rowFlicker * 0.36})`;
      ctx.fillRect(x + 5 + shrink, wy, tower.w - 10 - shrink * 2, 1.7);
    }
    ctx.fillStyle = `rgba(248, 240, 214, ${0.16 + getLightFlicker(t, tower.x * 0.05 + 22.8) * 0.24})`;
    ctx.fillRect(x + tower.w * 0.68, top + 18, 1.7, tower.h - 26);
    drawFlickerWindows(ctx, {
      x: x + 8,
      y: top + 30,
      w: tower.w - 16,
      h: tower.h - 46,
      rows: 7,
      cols: 3,
      time: t,
      seed: tower.x * 0.11 + 10.2,
      warmBias: 0.62,
      paneW: 2.3,
      paneH: 2.8,
      gapX: 4.5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "bladeTower") {
    ctx.fillStyle = `rgba(236, 244, 255, ${0.1 + getLightFlicker(t, tower.x * 0.09 + 25.2) * 0.22})`;
    ctx.fillRect(x + tower.w * 0.16, top + 12, 1.4, tower.h - 18);
    ctx.fillStyle = `rgba(255, 238, 205, ${0.2 + getLightFlicker(t, tower.x * 0.07 + 28.9) * 0.28})`;
    ctx.fillRect(right - 3.2, top + 10, 1.8, tower.h - 16);
    for (let row = 0; row < 11; row++) {
      const wy = top + 20 + row * 14;
      const rowFlicker = getLightFlicker(t, tower.x * 0.1 + row * 2.4 + 31.3);
      ctx.fillStyle =
        row % 2 === 0
          ? `rgba(215, 232, 248, ${0.01 + rowFlicker * 0.26})`
          : `rgba(255, 242, 214, ${0.01 + rowFlicker * 0.2})`;
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.35);
    }
    drawFlickerWindows(ctx, {
      x: x + 7,
      y: top + 24,
      w: tower.w - 14,
      h: tower.h - 38,
      rows: 9,
      cols: 2,
      time: t,
      seed: tower.x * 0.09 + 12.6,
      warmBias: 0.45,
      paneW: 2.4,
      paneH: 3,
      gapX: 6,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else {
    const rows = Math.max(2, Math.floor(tower.h / 17));
    const cols = tower.windows;
    const winW = cols === 1 ? 3 : 4;
    const gap = cols === 1 ? 0 : 6;
    const startX = x + Math.max(2, (tower.w - cols * winW - (cols - 1) * gap) / 2);
    const groupRows = opts.quantizedAnim ? 2 : 1;
    const groupCols = opts.quantizedAnim ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const groupRow = Math.floor(row / groupRows);
        const groupCol = Math.floor(col / groupCols);
        const litSeed = hash01(tower.x, groupRow, groupCol);
        const lit = Math.sin(t * 0.06 + litSeed * 10 + groupRow * 0.65 + groupCol * 2.1) > (opts.litThreshold ?? -0.2);
        const flicker = getLightFlicker(t, litSeed * 100 + tower.w * 0.07 + tower.h * 0.01);
        const wx = startX + col * (winW + gap);
        const wy = top + 10 + row * 14;
        if (wy > baseY - 8) continue;
        if (lit) {
          ctx.fillStyle = `rgba(255, 202, 132, ${0.02 + litSeed * 0.06 + flicker * 0.44})`;
          ctx.fillRect(wx - 1, wy - 1, winW + 2, 5);
          ctx.fillStyle = `rgba(255, 226, 176, ${0.05 + litSeed * 0.08 + flicker * 0.84})`;
          ctx.fillRect(wx, wy, winW, 3);
          if (flicker > 0.64) {
            ctx.fillStyle = `rgba(255, 236, 194, ${(flicker - 0.64) * 1.15})`;
            ctx.fillRect(wx, wy, winW, 1.4);
          }
        } else if (!opts.litOnlyAnim) {
          ctx.fillStyle = "rgba(4, 6, 12, 0.66)";
          ctx.fillRect(wx, wy, winW, 3);
        }
      }
    }
  }
  ctx.restore();
}

export function mapGameplayBuildingTower(
  building: Pick<Building, "x" | "w" | "h" | "windows">,
  index: number,
): TitleTower {
  const scenicTower = TITLE_SKYLINE_TOWERS[index];
  return {
    x: building.x,
    w: building.w,
    h: building.h,
    windows: building.windows,
    profile: scenicTower?.profile ?? "generic",
    roof: scenicTower?.roof ?? "flat",
    glow: scenicTower?.glow ?? 0.06,
  };
}

function buildTowerAssets(
  towers: readonly TitleTower[],
  baseY: number,
  glowScale: number,
  frameCount: number,
  period: number,
  litOnlyAnim = false,
  quantizedAnim = false,
): BuildingAssets {
  const staticSprites: HTMLCanvasElement[] = [];
  const animFrames: HTMLCanvasElement[][] = [];
  const staticOffsets: Array<{ x: number; y: number }> = [];
  const animOffsets: Array<{ x: number; y: number }> = [];

  for (const tower of towers) {
    const top = baseY - tower.h;
    const staticCanvas = createSpriteCanvas(tower.w + GLOW_MARGIN * 2, tower.h + GLOW_MARGIN);
    const staticCtx = staticCanvas.getContext("2d");
    if (staticCtx) {
      staticCtx.translate(-tower.x + GLOW_MARGIN, -top + GLOW_MARGIN);
      drawSharedTower(staticCtx, tower, baseY, 0, 0, glowScale, { structureOnly: true });
    }
    staticSprites.push(staticCanvas);
    staticOffsets.push({
      x: tower.x - GLOW_MARGIN,
      y: top - GLOW_MARGIN,
    });

    const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
      const canvas = createSpriteCanvas(tower.w, tower.h);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.translate(-tower.x, -top);
        drawSharedTower(ctx, tower, baseY, (frameIndex / frameCount) * period, 0, glowScale, {
          animOnly: true,
          litOnlyAnim,
          litThreshold: litOnlyAnim ? TITLE_BUILDING_LIT_THRESHOLD : undefined,
          quantizedAnim,
        });
      }
      return canvas;
    });
    animFrames.push(frames);
    animOffsets.push({ x: tower.x, y: top });
  }

  return {
    staticSprites,
    animFrames,
    staticOffsets,
    animOffsets,
    frameCount,
    period,
  };
}

export function buildBuildingAssets(baseY: number): BuildingAssets {
  const towers = SCENIC_BUILDING_LAYOUT.map((building, index) => mapGameplayBuildingTower(building, index));
  return buildTowerAssets(
    towers,
    baseY,
    0.48,
    GAMEPLAY_BUILDING_ANIM_FRAME_COUNT,
    GAMEPLAY_BUILDING_ANIM_PERIOD_SECONDS,
  );
}

export function buildTitleBuildingAssets(baseY: number): BuildingAssets {
  return buildTowerAssets(
    TITLE_SKYLINE_TOWERS,
    baseY,
    1,
    TITLE_BUILDING_ANIM_FRAME_COUNT,
    TITLE_BUILDING_BAKE_PERIOD_SECONDS,
    true,
    true,
  );
}

export const burjLeftSections = [
  { top: 1.0, bottom: 0.982, w: 0.7 },
  { top: 0.982, bottom: 0.958, w: 0.9 },
  { top: 0.958, bottom: 0.928, w: 1.15 },
  { top: 0.928, bottom: 0.892, w: 1.55 },
  { top: 0.892, bottom: 0.85, w: 2.0 },
  { top: 0.85, bottom: 0.802, w: 2.45 },
  { top: 0.802, bottom: 0.748, w: 3.4 },
  { top: 0.748, bottom: 0.69, w: 4.1 },
  { top: 0.69, bottom: 0.626, w: 5.6 },
  { top: 0.626, bottom: 0.556, w: 7.5 },
  { top: 0.556, bottom: 0.48, w: 8.6 },
  { top: 0.48, bottom: 0.398, w: 11.4 },
  { top: 0.398, bottom: 0.312, w: 13.2 },
  { top: 0.312, bottom: 0.222, w: 16.8 },
  { top: 0.222, bottom: 0.12, w: 18.9 },
  { top: 0.12, bottom: 0.0, w: 22.2 },
] as const;

export const burjRightSections = [
  { top: 1.0, bottom: 0.982, w: 0.7 },
  { top: 0.982, bottom: 0.958, w: 0.98 },
  { top: 0.958, bottom: 0.928, w: 1.34 },
  { top: 0.928, bottom: 0.892, w: 1.8 },
  { top: 0.892, bottom: 0.85, w: 2.35 },
  { top: 0.85, bottom: 0.802, w: 3.1 },
  { top: 0.802, bottom: 0.748, w: 4.05 },
  { top: 0.748, bottom: 0.69, w: 5.3 },
  { top: 0.69, bottom: 0.626, w: 6.5 },
  { top: 0.626, bottom: 0.556, w: 7.2 },
  { top: 0.556, bottom: 0.48, w: 10.2 },
  { top: 0.48, bottom: 0.398, w: 11.2 },
  { top: 0.398, bottom: 0.312, w: 15.6 },
  { top: 0.312, bottom: 0.222, w: 16.5 },
  { top: 0.222, bottom: 0.12, w: 20.7 },
  { top: 0.12, bottom: 0.0, w: 21.8 },
] as const;

export function burjPath(ctx: CanvasRenderingContext2D, burjBaseY: number, burjX = BURJ_X, burjHeight = BURJ_H) {
  const tipY = burjBaseY - burjHeight - 50;
  const upperY = burjBaseY - burjHeight - 18;
  ctx.beginPath();
  ctx.moveTo(burjX, tipY);
  ctx.lineTo(burjX - 0.78, upperY);
  ctx.lineTo(burjX - burjLeftSections[0].w, burjBaseY - burjHeight * burjLeftSections[0].top);
  for (let i = 0; i < burjLeftSections.length; i++) {
    const section = burjLeftSections[i];
    const bottomY = burjBaseY - burjHeight * section.bottom;
    ctx.lineTo(burjX - section.w, bottomY);
    const next = burjLeftSections[i + 1];
    if (next) ctx.lineTo(burjX - next.w, bottomY);
  }
  for (let i = burjRightSections.length - 1; i >= 0; i--) {
    const section = burjRightSections[i];
    const bottomY = burjBaseY - burjHeight * section.bottom;
    const topY = burjBaseY - burjHeight * section.top;
    ctx.lineTo(burjX + section.w, bottomY);
    ctx.lineTo(burjX + section.w, topY);
    const prev = burjRightSections[i - 1];
    if (prev) ctx.lineTo(burjX + prev.w, topY);
  }
  ctx.lineTo(burjX + 0.78, upperY);
  ctx.closePath();
}

export function halfWidthsAt(ht: number) {
  let left = burjLeftSections[burjLeftSections.length - 1].w;
  let right = burjRightSections[burjRightSections.length - 1].w;
  for (const section of burjLeftSections) {
    if (ht <= section.top && ht >= section.bottom) {
      left = section.w;
      break;
    }
  }
  for (const section of burjRightSections) {
    if (ht <= section.top && ht >= section.bottom) {
      right = section.w;
      break;
    }
  }
  return { left, right };
}

function toBurjLocalX(x: number, artScale: number) {
  return BURJ_X + (x - BURJ_X) / artScale;
}

function toBurjLocalY(y: number, burjBaseY: number, artScale: number) {
  return burjBaseY + (y - burjBaseY) / artScale;
}

function getBurjSpriteBounds(groundY: number, artScale: number) {
  const burjBaseY = groundY - 6;
  const minX = Math.floor(Math.min(BURJ_X - 24, toBurjLocalX(BURJ_X - 140, artScale)) - 4);
  const maxX = Math.ceil(Math.max(BURJ_X + 24, toBurjLocalX(BURJ_X + 140, artScale)) + 4);
  const minY = Math.floor(Math.min(burjBaseY - BURJ_H - 54, toBurjLocalY(groundY - 140, burjBaseY, artScale)) - 4);
  const maxY = Math.ceil(Math.max(burjBaseY + 6, toBurjLocalY(groundY + 40, burjBaseY, artScale)) + 4);
  return {
    burjBaseY,
    offset: { x: minX, y: minY },
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getBurjBakeResolution(artScale: number) {
  // Counteract the 2x title/gameplay anchor scaling so the prebaked Burj keeps edge detail.
  return Math.max(1, Math.ceil(artScale));
}

function drawBurjStaticSprite(ctx: CanvasRenderingContext2D, groundY: number, artScale: number) {
  const burjBaseY = groundY - 6;
  const podiumCenterY = toBurjLocalY(groundY - 20, burjBaseY, artScale);
  const podiumRadius = 140 / artScale;
  const podiumGlow = ctx.createRadialGradient(BURJ_X, podiumCenterY, 0, BURJ_X, podiumCenterY, podiumRadius);
  podiumGlow.addColorStop(0, "rgba(196, 242, 255, 0.32)");
  podiumGlow.addColorStop(0.32, "rgba(120, 210, 255, 0.22)");
  podiumGlow.addColorStop(0.62, "rgba(255, 180, 120, 0.12)");
  podiumGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = podiumGlow;
  ctx.fillRect(BURJ_X - podiumRadius, podiumCenterY - podiumRadius, podiumRadius * 2, podiumRadius * 1.3);

  const burjGrad = ctx.createLinearGradient(BURJ_X, burjBaseY - BURJ_H, BURJ_X, burjBaseY);
  burjGrad.addColorStop(0, "#fbfdff");
  burjGrad.addColorStop(0.08, "#dcecff");
  burjGrad.addColorStop(0.2, "#6e88a7");
  burjGrad.addColorStop(0.42, "#243446");
  burjGrad.addColorStop(0.7, "#182330");
  burjGrad.addColorStop(1, "#202a34");
  ctx.fillStyle = burjGrad;
  burjPath(ctx, burjBaseY);
  ctx.fill();

  ctx.strokeStyle = "rgba(236,246,255,0.28)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(BURJ_X, burjBaseY - BURJ_H - 44);
  ctx.lineTo(BURJ_X, burjBaseY - 28);
  ctx.stroke();

  ctx.fillStyle = "rgba(10, 18, 28, 0.56)";
  ctx.fillRect(BURJ_X - 8.2, burjBaseY - BURJ_H + 158, 16.4, 10);
  ctx.fillRect(BURJ_X - 11.4, burjBaseY - BURJ_H + 224, 22.8, 10);
}

function drawBurjAnimFrame(ctx: CanvasRenderingContext2D, groundY: number, time: number) {
  const burjBaseY = groundY - 6;
  const spineFlicker = getLightFlicker(time, 41.7);
  const crownFlicker = getLightFlicker(time, 44.1);
  ctx.fillStyle = `rgba(250, 252, 255, ${0.06 + spineFlicker * 0.68})`;
  ctx.fillRect(BURJ_X - 0.55, burjBaseY - BURJ_H + 18, 1.1, BURJ_H - 18);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + crownFlicker * 0.88})`;
  ctx.fillRect(BURJ_X - 2.4, burjBaseY - BURJ_H + 22, 4.8, 3.6);
  ctx.fillStyle = "rgba(225, 239, 255, 0.16)";
  for (let i = 0; i < 42; i++) {
    const ht = 0.04 + (i / 41) * 0.92;
    const ly = burjBaseY - BURJ_H * ht;
    const { left, right } = halfWidthsAt(ht);
    const lw = left * 0.68;
    const rw = right * 0.68;
    if (lw < 1.2 && rw < 1.2) continue;
    const lit = Math.sin(time * 0.32 + i * 0.48) > -0.12;
    if (!lit) continue;
    const bandFlicker = getLightFlicker(time, 47.5 + i * 0.63);
    ctx.fillStyle =
      i === 13 || i === 23 || i === 33
        ? `rgba(255, 255, 255, ${0.04 + bandFlicker * 0.82})`
        : `rgba(215, 232, 248, ${0.01 + bandFlicker * 0.22})`;
    ctx.fillRect(BURJ_X - lw, ly, lw + rw, 0.72);
  }

  const brightBands = [
    { ht: 0.11, alpha: 0.96, thickness: 3.1 },
    { ht: 0.2, alpha: 0.92, thickness: 2.6 },
    { ht: 0.31, alpha: 0.88, thickness: 2.3 },
    { ht: 0.44, alpha: 0.82, thickness: 2.1 },
    { ht: 0.59, alpha: 0.76, thickness: 1.9 },
    { ht: 0.75, alpha: 0.68, thickness: 1.7 },
    { ht: 0.88, alpha: 0.6, thickness: 1.45 },
  ];
  brightBands.forEach((band, index) => {
    const ly = burjBaseY - BURJ_H * band.ht;
    const { left, right } = halfWidthsAt(band.ht);
    const bandFlicker = getLightFlicker(time, 83.1 + index * 1.9);
    ctx.fillStyle = `rgba(252, 253, 255, ${band.alpha * (0.26 + bandFlicker * 0.94)})`;
    ctx.fillRect(BURJ_X - left * 0.88, ly, left * 0.88 + right * 0.88, band.thickness);
    ctx.fillStyle = `rgba(15, 24, 34, ${0.34 - index * 0.03})`;
    ctx.fillRect(BURJ_X - left * 0.9, ly + band.thickness, left * 0.9 + right * 0.9, 1.15);
    ctx.fillStyle = `rgba(130, 200, 255, ${0.01 + bandFlicker * 0.24})`;
    ctx.fillRect(BURJ_X - left * 0.86, ly - 0.7, left * 0.86 + right * 0.86, 0.55);
  });

  ctx.fillStyle = `rgba(248, 252, 255, ${0.08 + getLightFlicker(time, 97.2) * 0.92})`;
  ctx.fillRect(BURJ_X - 7.1, burjBaseY - BURJ_H + 166, 14.2, 2.6);
  ctx.fillStyle = `rgba(255, 224, 176, ${0.04 + getLightFlicker(time, 101.4) * 0.56})`;
  ctx.fillRect(BURJ_X - 9.4, burjBaseY - BURJ_H + 232, 18.8, 2.1);

  const accentLights = [
    { ht: 0.18, width: 0.54, thickness: 1.4, seed: 106.2, color: "255, 236, 194" },
    { ht: 0.36, width: 0.5, thickness: 1.2, seed: 109.8, color: "214, 236, 255" },
    { ht: 0.52, width: 0.46, thickness: 1.15, seed: 113.3, color: "255, 228, 168" },
    { ht: 0.68, width: 0.38, thickness: 1.05, seed: 117.1, color: "220, 240, 255" },
  ];
  accentLights.forEach((light) => {
    const ly = burjBaseY - BURJ_H * light.ht;
    const { left, right } = halfWidthsAt(light.ht);
    const flicker = getLightFlicker(time, light.seed);
    const span = (left + right) * 0.5 * light.width;
    ctx.fillStyle = `rgba(${light.color}, ${0.02 + flicker * 0.68})`;
    ctx.fillRect(BURJ_X - span * 0.5, ly, span, light.thickness);
  });
}

export function buildBurjAssets(groundY: number, artScale: number): BurjAssets {
  const bounds = getBurjSpriteBounds(groundY, artScale);
  const resolutionScale = getBurjBakeResolution(artScale);
  const staticSprite = createSpriteCanvas(bounds.width, bounds.height, resolutionScale);
  const staticCtx = staticSprite.getContext("2d");
  if (staticCtx) {
    staticCtx.scale(resolutionScale, resolutionScale);
    staticCtx.translate(-bounds.offset.x, -bounds.offset.y);
    drawBurjStaticSprite(staticCtx, groundY, artScale);
  }

  const animFrames = Array.from({ length: BURJ_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(bounds.width, bounds.height, resolutionScale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(resolutionScale, resolutionScale);
      ctx.translate(-bounds.offset.x, -bounds.offset.y);
      drawBurjAnimFrame(ctx, groundY, (frameIndex / BURJ_ANIM_FRAME_COUNT) * BURJ_ANIM_PERIOD_SECONDS);
    }
    return canvas;
  });

  return {
    staticSprite,
    animFrames,
    offset: bounds.offset,
    frameCount: BURJ_ANIM_FRAME_COUNT,
    period: BURJ_ANIM_PERIOD_SECONDS,
    resolutionScale,
  };
}

export function createSpriteCanvas(width: number, height: number, resolutionScale = 1): HTMLCanvasElement {
  const pixelWidth = Math.max(1, Math.round(width * resolutionScale));
  const pixelHeight = Math.max(1, Math.round(height * resolutionScale));
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    return canvas;
  }

  const ctx = createStubCanvasContext(pixelWidth, pixelHeight);
  return {
    width: pixelWidth,
    height: pixelHeight,
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
