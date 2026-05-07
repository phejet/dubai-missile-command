import { createSpriteCanvas } from "./art-core";
import type {
  EffectSpriteAssets,
  EmpRingAssets,
  ExplosionGlowAssets,
  StaticSpriteAsset,
} from "./art-core";

function buildEffectSpriteAsset(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): StaticSpriteAsset {
  const resolutionScale = 2;
  const sprite = createSpriteCanvas(width, height, resolutionScale);
  const ctx = sprite.getContext("2d");
  if (ctx) {
    ctx.scale(resolutionScale, resolutionScale);
    draw(ctx, width, height);
  }
  return {
    sprite,
    offset: { x: -width / 2, y: -height / 2 },
    width,
    height,
    resolutionScale,
    scale: 1,
  };
}

function drawCenteredRadialGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stops: Array<[number, string]>,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

export function buildExplosionGlowAssets(): ExplosionGlowAssets {
  return {
    light: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0.9)"],
        [0.24, "rgba(255, 255, 255, 0.36)"],
        [0.58, "rgba(255, 255, 255, 0.1)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    splash: buildEffectSpriteAsset(192, 192, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0.55)"],
        [0.18, "rgba(255, 255, 255, 0.34)"],
        [0.42, "rgba(255, 255, 255, 0.14)"],
        [0.74, "rgba(255, 255, 255, 0.04)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    fireball: buildEffectSpriteAsset(128, 128, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 1)"],
        [0.16, "rgba(255, 245, 206, 0.94)"],
        [0.42, "rgba(255, 255, 255, 0.55)"],
        [0.78, "rgba(255, 255, 255, 0.08)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    core: buildEffectSpriteAsset(128, 128, (ctx, width, height) => {
      const cx = width / 2;
      const cy = height / 2;
      const r = width / 2;

      const drawLobe = (x: number, y: number, lR: number, peak: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, lR);
        g.addColorStop(0, `rgba(255,255,255,${peak.toFixed(2)})`);
        g.addColorStop(0.5, `rgba(255,255,255,${(peak * 0.52).toFixed(2)})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      };

      ctx.globalCompositeOperation = "lighter";
      drawLobe(cx, cy, r * 0.52, 0.62);
      drawLobe(cx + r * 0.19, cy - r * 0.14, r * 0.38, 0.36);
      drawLobe(cx - r * 0.17, cy + r * 0.21, r * 0.34, 0.32);
      drawLobe(cx + r * 0.13, cy + r * 0.19, r * 0.3, 0.28);
      drawLobe(cx - r * 0.21, cy - r * 0.17, r * 0.32, 0.3);
      drawLobe(cx + r * 0.05, cy - r * 0.23, r * 0.26, 0.24);
      ctx.globalCompositeOperation = "source-over";

      // Noise pass: break up smooth gradient edges at transition zones
      const pw = ctx.canvas.width;
      const ph = ctx.canvas.height;
      const id = ctx.getImageData(0, 0, pw, ph);
      const d = id.data;
      let s = 12345;
      const rng = () => {
        s = Math.imul(s, 1664525) + 1013904223;
        return (s >>> 0) / 0xffffffff;
      };
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        const t = a / 255;
        const noiseStr = t * (1 - t) * 4; // peaks at mid-alpha transition zones
        d[i + 3] = Math.max(0, Math.min(255, a + (rng() - 0.5) * 140 * noiseStr));
      }
      ctx.putImageData(id, 0, 0);
    }),
    ring: buildEffectSpriteAsset(160, 160, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.72, "rgba(255, 255, 255, 0)"],
        [0.82, "rgba(255, 255, 255, 0.78)"],
        [0.9, "rgba(255, 255, 255, 0.28)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
  };
}

export function buildEmpRingAssets(): EmpRingAssets {
  return {
    wash: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.58, "rgba(255, 255, 255, 0)"],
        [0.88, "rgba(255, 255, 255, 0.22)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    ring: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.66, "rgba(255, 255, 255, 0)"],
        [0.76, "rgba(255, 255, 255, 0.9)"],
        [0.82, "rgba(255, 255, 255, 0.52)"],
        [0.9, "rgba(255, 255, 255, 0.18)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
  };
}

export function buildEffectSpriteAssets(): EffectSpriteAssets {
  return {
    explosion: buildExplosionGlowAssets(),
    emp: buildEmpRingAssets(),
    laserBeam: buildEffectSpriteAsset(128, 24, (ctx, width, height) => {
      const cy = height / 2;
      const glow = ctx.createLinearGradient(0, cy, 0, height);
      glow.addColorStop(0, "rgba(255, 255, 255, 0)");
      glow.addColorStop(0.35, "rgba(255, 255, 255, 0.34)");
      glow.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
      glow.addColorStop(0.65, "rgba(255, 255, 255, 0.34)");
      glow.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }),
    phalanxBullet: buildEffectSpriteAsset(96, 12, (ctx, width, height) => {
      const beam = ctx.createLinearGradient(0, 0, width, 0);
      beam.addColorStop(0, "rgba(255, 255, 255, 0)");
      beam.addColorStop(0.28, "rgba(255, 255, 255, 0.24)");
      beam.addColorStop(0.72, "rgba(255, 255, 255, 0.92)");
      beam.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height);
    }),
  };
}

export function drawBakedStaticSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: StaticSpriteAsset,
  { alpha = 1, angle = 0 }: { alpha?: number; angle?: number } = {},
) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(asset.sprite, asset.offset.x, asset.offset.y, asset.width, asset.height);
  ctx.restore();
}
