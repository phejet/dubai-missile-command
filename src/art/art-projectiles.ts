import { createSpriteCanvas } from "./art-core";
import type {
  InterceptorSpriteAssets,
  ProjectileSpriteAsset,
  SpriteBounds,
  ThreatSpriteAssets,
  UpgradeProjectileSpriteAssets,
} from "./art-core";

const PROJECTILE_ANIM_FRAME_COUNT = 8;

const DEFAULT_MISSILE_BOUNDS = { x: -34, y: -14, width: 52, height: 28 } as const;
const MIRV_BOUNDS = { x: -44, y: -20, width: 72, height: 40 } as const;
const MIRV_WARHEAD_BOUNDS = { x: -22, y: -10, width: 34, height: 20 } as const;
const BOMB_BOUNDS = { x: -12, y: -12, width: 24, height: 24 } as const;
const STACK2_BOUNDS = { x: -42, y: -16, width: 72, height: 32 } as const;
const STACK3_BOUNDS = { x: -44, y: -18, width: 76, height: 36 } as const;
const STACK_CHILD_BOUNDS = { x: -22, y: -10, width: 36, height: 20 } as const;
const SHAHED_136_BOUNDS = { x: -18, y: -14, width: 36, height: 28 } as const;
const SHAHED_136_DIVE_BOUNDS = { x: -18, y: -12, width: 38, height: 24 } as const;
const SHAHED_238_BOUNDS = { x: -28, y: -18, width: 52, height: 36 } as const;
const MISSILE_FAST_BOUNDS = { x: -32, y: -10, width: 54, height: 20 } as const;
const PLAYER_INTERCEPTOR_BOUNDS = { x: -40, y: -12, width: 58, height: 24 } as const;
const F15_INTERCEPTOR_BOUNDS = { x: -14, y: -10, width: 24, height: 20 } as const;
const WILD_HORNET_BOUNDS = { x: -8, y: -7, width: 16, height: 13 } as const;
const ROADRUNNER_BOUNDS = { x: -7, y: -12, width: 14, height: 19 } as const;
const PATRIOT_SAM_BOUNDS = { x: -7, y: -15, width: 14, height: 26 } as const;

const UPGRADE_PROJECTILE_COLORS = {
  hornetBody: "#ffcc00",
  hornetBright: "rgba(255,244,160,0.85)",
  hornetWing: "rgba(255,204,0,0.45)",
  roadrunnerBody: "#2c4760",
  roadrunnerFin: "#7fd5ff",
  roadrunnerHighlight: "rgba(255,255,255,0.85)",
  patriotBody: "#2a5a2a",
  patriotNose: "#88ff44",
  patriotFin: "#1a4a1a",
} as const;

function getProjectileBakeResolution(scale: number) {
  return Math.max(1, Math.ceil(scale * 2));
}

function getProjectileFramePhase(frameIndex: number, frameCount: number) {
  return (frameIndex % frameCount) / frameCount;
}

function buildProjectileSpriteAsset(
  scale: number,
  bounds: SpriteBounds,
  period: number,
  drawFrame: (ctx: CanvasRenderingContext2D, framePhase: number) => void,
): ProjectileSpriteAsset {
  const resolutionScale = getProjectileBakeResolution(scale);
  const paint = (canvas: HTMLCanvasElement, framePhase: number) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale * resolutionScale, scale * resolutionScale);
    ctx.translate(-bounds.x, -bounds.y);
    drawFrame(ctx, framePhase);
  };

  const staticSprite = createSpriteCanvas(bounds.width * scale, bounds.height * scale, resolutionScale);
  paint(staticSprite, 0);

  const animFrames = Array.from({ length: PROJECTILE_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(bounds.width * scale, bounds.height * scale, resolutionScale);
    paint(canvas, getProjectileFramePhase(frameIndex, PROJECTILE_ANIM_FRAME_COUNT));
    return canvas;
  });

  return {
    staticSprite,
    animFrames,
    offset: { x: bounds.x * scale, y: bounds.y * scale },
    frameCount: PROJECTILE_ANIM_FRAME_COUNT,
    period,
    resolutionScale,
    scale,
  };
}

function drawDefaultMissileLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(10, 0, -11, 0);
  bodyGrad.addColorStop(0, "#fbfdff");
  bodyGrad.addColorStop(0.18, "#d9e2ec");
  bodyGrad.addColorStop(0.55, "#8798ac");
  bodyGrad.addColorStop(1, "#46576d");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(4.8, -2.3);
  ctx.lineTo(-7.6, -2.15);
  ctx.lineTo(-9.7, -0.9);
  ctx.lineTo(-9.7, 0.9);
  ctx.lineTo(-7.6, 2.15);
  ctx.lineTo(4.8, 2.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 24, 36, 0.72)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = "rgba(242, 248, 255, 0.56)";
  ctx.lineWidth = 0.68;
  ctx.stroke();

  ctx.fillStyle = "#dfe7f1";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(5.1, -1.7);
  ctx.lineTo(5.1, 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(182, 232, 255, 0.5)";
  ctx.fillRect(-0.7, -1.42, 5.9, 0.72);
  ctx.fillStyle = "#41586f";
  ctx.fillRect(-5.1, -0.48, 7.5, 0.96);
  ctx.strokeStyle = "rgba(250,252,255,0.72)";
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-2.7, -2);
  ctx.lineTo(5.8, -1.42);
  ctx.stroke();

  ctx.fillStyle = "#a2b3c4";
  ctx.beginPath();
  ctx.moveTo(-6, -2.05);
  ctx.lineTo(-10.8, -5.9);
  ctx.lineTo(-7.9, -1.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6, 2.05);
  ctx.lineTo(-10.8, 5.9);
  ctx.lineTo(-7.9, 1.3);
  ctx.closePath();
  ctx.fill();

  const exhaustPulse = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const flameLen = 6 + 8 * exhaustPulse;
  const flameGlow = ctx.createRadialGradient(-13, 0, 0, -13, 0, 14);
  flameGlow.addColorStop(0, `rgba(255, 152, 80, ${0.1 + exhaustPulse * 0.16})`);
  flameGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = flameGlow;
  ctx.beginPath();
  ctx.ellipse(-13, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 102, 42, ${0.62 + exhaustPulse * 0.24})`;
  ctx.beginPath();
  ctx.moveTo(-9.3, -1.85);
  ctx.lineTo(-10.6 - flameLen, 0);
  ctx.lineTo(-9.3, 1.85);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 222, 144, ${0.54 + exhaustPulse * 0.22})`;
  ctx.beginPath();
  ctx.moveTo(-9.1, -0.85);
  ctx.lineTo(-10.1 - flameLen * 0.56, 0);
  ctx.lineTo(-9.1, 0.85);
  ctx.closePath();
  ctx.fill();
}

function drawFastMissileLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(13, 0, -11, 0);
  bodyGrad.addColorStop(0, "#fbfdff");
  bodyGrad.addColorStop(0.22, "#dde5ee");
  bodyGrad.addColorStop(0.6, "#8fa0b3");
  bodyGrad.addColorStop(1, "#4a5b70");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(7, -1.3);
  ctx.lineTo(-7.5, -1.55);
  ctx.lineTo(-10.6, -0.8);
  ctx.lineTo(-10.6, 0.8);
  ctx.lineTo(-7.5, 1.55);
  ctx.lineTo(7, 1.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(20, 28, 40, 0.7)";
  ctx.lineWidth = 0.78;
  ctx.stroke();
  ctx.strokeStyle = "rgba(244, 250, 255, 0.55)";
  ctx.lineWidth = 0.52;
  ctx.stroke();

  const noseGrad = ctx.createLinearGradient(13, 0, 7.4, 0);
  noseGrad.addColorStop(0, "#fff4c8");
  noseGrad.addColorStop(0.55, "#f6cf78");
  noseGrad.addColorStop(1, "#c89a44");
  ctx.fillStyle = noseGrad;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(7.4, -1.0);
  ctx.lineTo(7.4, 1.0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(60, 40, 12, 0.55)";
  ctx.lineWidth = 0.45;
  ctx.stroke();

  ctx.fillStyle = "rgba(186, 232, 255, 0.5)";
  ctx.fillRect(-1.4, -0.95, 6.8, 0.45);

  ctx.fillStyle = "#46586c";
  ctx.fillRect(-5.6, -0.32, 7.4, 0.66);

  ctx.fillStyle = "#a8b8cc";
  ctx.beginPath();
  ctx.moveTo(-6.4, -1.5);
  ctx.lineTo(-11, -4.6);
  ctx.lineTo(-8.4, -0.95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6.4, 1.5);
  ctx.lineTo(-11, 4.6);
  ctx.lineTo(-8.4, 0.95);
  ctx.closePath();
  ctx.fill();

  const exhaustPulse = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 4);
  const flameLen = 9 + 10 * exhaustPulse;
  const flameGlow = ctx.createRadialGradient(-14, 0, 0, -14, 0, 16);
  flameGlow.addColorStop(0, `rgba(255, 232, 160, ${0.16 + exhaustPulse * 0.2})`);
  flameGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = flameGlow;
  ctx.beginPath();
  ctx.ellipse(-14, 0, 16, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 184, 80, ${0.66 + exhaustPulse * 0.22})`;
  ctx.beginPath();
  ctx.moveTo(-10.2, -1.4);
  ctx.lineTo(-11.4 - flameLen, 0);
  ctx.lineTo(-10.2, 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 248, 210, ${0.7 + exhaustPulse * 0.22})`;
  ctx.beginPath();
  ctx.moveTo(-10.0, -0.7);
  ctx.lineTo(-10.8 - flameLen * 0.55, 0);
  ctx.lineTo(-10.0, 0.7);
  ctx.closePath();
  ctx.fill();
}

function drawMirvLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const glowAlpha = 0.18 + Math.sin(framePhase * Math.PI * 2) * 0.06;
  const pulseGlow = ctx.createRadialGradient(6, 0, 0, 6, 0, 30);
  pulseGlow.addColorStop(0, `rgba(255, 40, 0, ${0.34 + glowAlpha})`);
  pulseGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pulseGlow;
  ctx.fillRect(-24, -22, 52, 44);

  ctx.fillStyle = "#445060";
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(8, -4.5);
  ctx.lineTo(-14, -4.5);
  ctx.lineTo(-14, 4.5);
  ctx.lineTo(8, 4.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#cc2200";
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(14, -4.5);
  ctx.lineTo(14, 4.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, -4.5);
  ctx.lineTo(2, 4.5);
  ctx.moveTo(-6, -4.5);
  ctx.lineTo(-6, 4.5);
  ctx.stroke();

  ctx.fillStyle = "#556878";
  ctx.beginPath();
  ctx.moveTo(-14, -4.5);
  ctx.lineTo(-18, -11);
  ctx.lineTo(-10, -4.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14, 4.5);
  ctx.lineTo(-18, 11);
  ctx.lineTo(-10, 4.5);
  ctx.closePath();
  ctx.fill();

  const flameLen = 10 + 8 * (0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2));
  ctx.fillStyle = "#ff6633";
  ctx.beginPath();
  ctx.moveTo(-14, -3.5);
  ctx.lineTo(-14 - flameLen, 0);
  ctx.lineTo(-14, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc66";
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-14 - flameLen * 0.5, 0);
  ctx.lineTo(-14, 2);
  ctx.closePath();
  ctx.fill();
}

function drawMirvWarheadLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const glow = ctx.createRadialGradient(2, 0, 0, 2, 0, 16);
  glow.addColorStop(0, `rgba(221, 68, 34, ${0.34 + pulse * 0.18})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-12, -10, 24, 20);

  ctx.fillStyle = "#dd4422";
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(3, -2);
  ctx.lineTo(-5, -2);
  ctx.lineTo(-5, 2);
  ctx.lineTo(3, 2);
  ctx.closePath();
  ctx.fill();

  const flameLen = 5 + 4 * pulse;
  ctx.fillStyle = "#ff8844";
  ctx.beginPath();
  ctx.moveTo(-5, -1.5);
  ctx.lineTo(-5 - flameLen, 0);
  ctx.lineTo(-5, 1.5);
  ctx.closePath();
  ctx.fill();
}

function drawBombLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 8.5);
  glow.addColorStop(0, `rgba(255, 136, 0, ${0.36 + pulse * 0.2})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff8800";
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 238, 196, 0.64)";
  ctx.beginPath();
  ctx.arc(0.8, -0.6, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawStackChildLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const flamePulse = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2));
  ctx.fillStyle = "#d6d9de";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-2, -3);
  ctx.lineTo(-2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8f96a0";
  ctx.beginPath();
  ctx.moveTo(-2, -3);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-4, -3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 3);
  ctx.lineTo(-6, 6);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff884480";
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.lineTo(-12 * flamePulse, 0);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe7b8";
  ctx.beginPath();
  ctx.moveTo(-2, -1);
  ctx.lineTo(-7 * flamePulse, 0);
  ctx.lineTo(-2, 1);
  ctx.closePath();
  ctx.fill();
}

function drawStackCarrierLocal(ctx: CanvasRenderingContext2D, payloadCount: 2 | 3, framePhase: number) {
  const renderScale = 0.8;
  const bodyHalfH = payloadCount === 3 ? 5.2 : 4.6;
  const noseX = payloadCount === 3 ? 25 : 22.5;
  const bodyFrontX = payloadCount === 3 ? 15.5 : 14;
  const tailX = payloadCount === 3 ? -20.5 : -18;
  const payloadOffsets = payloadCount === 3 ? [-1.85, 0, 1.85] : [-1.3, 1.3];
  const finSpan = payloadCount === 3 ? 10 : 9;
  const flameLen =
    payloadCount === 3 ? 14 + 4 * Math.sin(framePhase * Math.PI * 2) : 11 + 3 * Math.sin(framePhase * Math.PI * 2);

  ctx.save();
  ctx.scale(renderScale, renderScale);

  const shell = ctx.createLinearGradient(tailX, -bodyHalfH, noseX, bodyHalfH);
  shell.addColorStop(0, "#465363");
  shell.addColorStop(0.35, "#718091");
  shell.addColorStop(0.7, "#d6dde6");
  shell.addColorStop(1, "#f1f5fa");
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(noseX, 0);
  ctx.lineTo(bodyFrontX, -bodyHalfH * 0.78);
  ctx.lineTo(4, -bodyHalfH);
  ctx.lineTo(-9, -bodyHalfH * 0.92);
  ctx.lineTo(tailX, -bodyHalfH * 0.38);
  ctx.lineTo(tailX, bodyHalfH * 0.38);
  ctx.lineTo(-9, bodyHalfH * 0.92);
  ctx.lineTo(4, bodyHalfH);
  ctx.lineTo(bodyFrontX, bodyHalfH * 0.78);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(24, 32, 42, 0.18)";
  ctx.beginPath();
  ctx.moveTo(bodyFrontX - 2, -bodyHalfH * 0.42);
  ctx.lineTo(4.5, -bodyHalfH * 0.63);
  ctx.lineTo(-11.5, -bodyHalfH * 0.34);
  ctx.lineTo(-11.5, bodyHalfH * 0.34);
  ctx.lineTo(4.5, bodyHalfH * 0.63);
  ctx.lineTo(bodyFrontX - 2, bodyHalfH * 0.42);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(250, 252, 255, 0.55)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-9, -bodyHalfH * 0.58);
  ctx.lineTo(12, -bodyHalfH * 0.34);
  ctx.stroke();

  ctx.strokeStyle = "rgba(23, 28, 36, 0.34)";
  ctx.lineWidth = 0.9;
  [-10, -1.5].forEach((bandX) => {
    ctx.beginPath();
    ctx.moveTo(bandX, -bodyHalfH * 0.62);
    ctx.lineTo(bandX, bodyHalfH * 0.62);
    ctx.stroke();
  });

  ctx.fillStyle = payloadCount === 3 ? "#4d5968" : "#55606f";
  ctx.beginPath();
  ctx.moveTo(tailX, -bodyHalfH * 0.42);
  ctx.lineTo(tailX - 5.5, -finSpan * 0.7);
  ctx.lineTo(tailX + 3.2, -bodyHalfH * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tailX, bodyHalfH * 0.42);
  ctx.lineTo(tailX - 5.5, finSpan * 0.7);
  ctx.lineTo(tailX + 3.2, bodyHalfH * 0.14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 186, 96, 0.16)";
  ctx.beginPath();
  ctx.moveTo(bodyFrontX + 0.4, -bodyHalfH * 0.34);
  ctx.lineTo(noseX - 1.5, 0);
  ctx.lineTo(bodyFrontX + 0.4, bodyHalfH * 0.34);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 212, 148, 0.42)";
  ctx.lineWidth = 0.8;
  payloadOffsets.forEach((offset) => {
    ctx.beginPath();
    ctx.moveTo(4.2, offset);
    ctx.lineTo(15.8, offset);
    ctx.stroke();
  });

  payloadOffsets.forEach((offset) => {
    const halo = ctx.createLinearGradient(4, offset, 17, offset);
    halo.addColorStop(0, "rgba(255, 156, 74, 0.08)");
    halo.addColorStop(0.55, "rgba(255, 214, 150, 0.38)");
    halo.addColorStop(1, "rgba(255, 244, 214, 0.14)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(11, offset, 7.1, 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(250, 252, 255, 0.68)";
    ctx.beginPath();
    ctx.ellipse(15.2, offset, 1.1, 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(34, 42, 52, 0.45)";
  ctx.lineWidth = 0.7;
  const seamTop = payloadOffsets[0] - 0.92;
  const seamBottom = payloadOffsets[payloadOffsets.length - 1] + 0.92;
  ctx.beginPath();
  ctx.moveTo(4.1, seamTop);
  ctx.lineTo(4.1, seamBottom);
  ctx.stroke();
  if (payloadCount === 3) {
    ctx.beginPath();
    ctx.moveTo(10.3, seamTop);
    ctx.lineTo(10.3, seamBottom);
    ctx.stroke();
  }

  const exhaustGlow = ctx.createRadialGradient(tailX - 4, 0, 0, tailX - 4, 0, 18);
  exhaustGlow.addColorStop(0, `rgba(255, 194, 122, ${0.18 + framePhase * 0.12})`);
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(tailX - 20, -12, 28, 24);

  ctx.fillStyle = "#ff9a4d";
  ctx.beginPath();
  ctx.moveTo(tailX, -2.8);
  ctx.lineTo(tailX - flameLen, 0);
  ctx.lineTo(tailX, 2.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe4ae";
  ctx.beginPath();
  ctx.moveTo(tailX + 0.4, -1.4);
  ctx.lineTo(tailX - flameLen * 0.52, 0);
  ctx.lineTo(tailX + 0.4, 1.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawShahed136Local(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(13, 0, -11, 0);
  bodyGrad.addColorStop(0, "#b4afbc");
  bodyGrad.addColorStop(0.34, "#706c7e");
  bodyGrad.addColorStop(1, "#353b4b");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(4.4, -1.9);
  ctx.lineTo(-7.8, -2.4);
  ctx.lineTo(-10.8, 0);
  ctx.lineTo(-7.8, 2.4);
  ctx.lineTo(4.4, 1.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(14,18,28,0.82)";
  ctx.lineWidth = 0.85;
  ctx.stroke();
  ctx.strokeStyle = "rgba(236,242,250,0.4)";
  ctx.lineWidth = 0.62;
  ctx.stroke();

  ctx.fillStyle = "#495367";
  ctx.beginPath();
  ctx.moveTo(5.8, -1.25);
  ctx.lineTo(-5.6, -10.2);
  ctx.lineTo(-8.2, -1.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(236,242,250,0.34)";
  ctx.lineWidth = 0.56;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(5.8, 1.25);
  ctx.lineTo(-5.6, 10.2);
  ctx.lineTo(-8.2, 1.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(236,242,250,0.34)";
  ctx.lineWidth = 0.56;
  ctx.stroke();

  ctx.fillStyle = "rgba(222, 236, 255, 0.3)";
  ctx.fillRect(-0.4, -0.95, 6.5, 0.52);

  ctx.fillStyle = "#5b6980";
  ctx.beginPath();
  ctx.moveTo(-6.2, -1.2);
  ctx.lineTo(-9.8, -4.3);
  ctx.lineTo(-8.2, -0.9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6.2, 1.2);
  ctx.lineTo(-9.8, 4.3);
  ctx.lineTo(-8.2, 0.9);
  ctx.closePath();
  ctx.fill();

  const propAngle = Math.cos(framePhase * Math.PI * 2) * 1.1;
  ctx.strokeStyle = "rgba(226,232,242,0.82)";
  ctx.lineWidth = 0.68;
  ctx.beginPath();
  ctx.moveTo(-11 + propAngle, -3.6);
  ctx.lineTo(-11 - propAngle, 3.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-11 - propAngle, -2.9);
  ctx.lineTo(-11 + propAngle, 2.9);
  ctx.stroke();

  const propGlow = ctx.createRadialGradient(-11, 0, 0, -11, 0, 4.8);
  propGlow.addColorStop(0, "rgba(255, 136, 76, 0.2)");
  propGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = propGlow;
  ctx.beginPath();
  ctx.arc(-11, 0, 4.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawShahed136DiveLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(15, 0, -12, 0);
  bodyGrad.addColorStop(0, "#7a8493");
  bodyGrad.addColorStop(0.4, "#43495a");
  bodyGrad.addColorStop(1, "#1f242f");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(7, -1.6);
  ctx.lineTo(-6, -1.95);
  ctx.lineTo(-11.5, -0.85);
  ctx.lineTo(-11.5, 0.85);
  ctx.lineTo(-6, 1.95);
  ctx.lineTo(7, 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(6, 9, 14, 0.85)";
  ctx.lineWidth = 0.78;
  ctx.stroke();
  ctx.strokeStyle = "rgba(210, 224, 240, 0.32)";
  ctx.lineWidth = 0.55;
  ctx.stroke();

  ctx.fillStyle = "#2c3140";
  ctx.beginPath();
  ctx.moveTo(4, -1.2);
  ctx.lineTo(-9.5, -8.8);
  ctx.lineTo(-9, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 224, 240, 0.34)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.fillStyle = "#2c3140";
  ctx.beginPath();
  ctx.moveTo(4, 1.2);
  ctx.lineTo(-9.5, 8.8);
  ctx.lineTo(-9, 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 224, 240, 0.34)";
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(170, 210, 235, 0.32)";
  ctx.fillRect(2, -0.85, 6, 0.5);

  ctx.fillStyle = "#3a4254";
  ctx.beginPath();
  ctx.moveTo(-7, -1.05);
  ctx.lineTo(-10.4, -3.2);
  ctx.lineTo(-9, -0.8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-7, 1.05);
  ctx.lineTo(-10.4, 3.2);
  ctx.lineTo(-9, 0.8);
  ctx.closePath();
  ctx.fill();

  const propAngle = Math.cos(framePhase * Math.PI * 2) * 0.85;
  ctx.strokeStyle = "rgba(200, 212, 226, 0.7)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(-11.6 + propAngle, -2.6);
  ctx.lineTo(-11.6 - propAngle, 2.6);
  ctx.stroke();

  const propGlow = ctx.createRadialGradient(-11.6, 0, 0, -11.6, 0, 3.4);
  propGlow.addColorStop(0, "rgba(170, 210, 235, 0.18)");
  propGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = propGlow;
  ctx.beginPath();
  ctx.arc(-11.6, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawShahed238Local(ctx: CanvasRenderingContext2D, framePhase: number) {
  ctx.fillStyle = "#4a4a5a";
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -3);
  ctx.lineTo(-14, 0);
  ctx.lineTo(-10, 3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3a3a4a";
  ctx.beginPath();
  ctx.moveTo(4, -2);
  ctx.lineTo(-8, -14);
  ctx.lineTo(-12, -2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, 2);
  ctx.lineTo(-8, 14);
  ctx.lineTo(-12, 2);
  ctx.closePath();
  ctx.fill();

  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const exhaustGlow = ctx.createRadialGradient(-15, 0, 0, -15, 0, 16);
  exhaustGlow.addColorStop(0, `rgba(255, 68, 0, ${0.26 + pulse * 0.26})`);
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(-32, -14, 24, 28);

  const exLen = 7 + 5 * pulse;
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-14 - exLen, 0);
  ctx.lineTo(-14, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc44";
  ctx.beginPath();
  ctx.moveTo(-14, -1);
  ctx.lineTo(-14 - exLen * 0.5, 0);
  ctx.lineTo(-14, 1);
  ctx.closePath();
  ctx.fill();
}

function drawPlayerInterceptorLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const exhaustFlicker = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const exhaustLen = 18 + 18 * exhaustFlicker;
  const exhaustAlpha = 0.78 + 0.22 * exhaustFlicker;
  const exhaustGlow = ctx.createRadialGradient(-18, 0, 0, -18, 0, 22);
  exhaustGlow.addColorStop(0, "rgba(140, 232, 255, 0.28)");
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(-42, -16, 34, 32);

  ctx.fillStyle = `rgba(90, 220, 255, ${exhaustAlpha * 0.28})`;
  ctx.beginPath();
  ctx.moveTo(-8.4, -3.8);
  ctx.lineTo(-22 - exhaustLen * 0.78, 0);
  ctx.lineTo(-8.4, 3.8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#c7f6ff";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(2.4, -2.2);
  ctx.lineTo(-9.6, -2);
  ctx.lineTo(-11.3, -0.72);
  ctx.lineTo(-11.3, 0.72);
  ctx.lineTo(-9.6, 2);
  ctx.lineTo(2.4, 2.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#8ce8ff";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(3.8, -1.2);
  ctx.lineTo(3.8, 1.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2b4e6b";
  ctx.fillRect(-6.2, -0.55, 12.2, 1.1);
  ctx.fillStyle = "rgba(220, 250, 255, 0.58)";
  ctx.fillRect(-0.4, -1.45, 5.4, 0.55);

  ctx.fillStyle = "#88cfff";
  ctx.beginPath();
  ctx.moveTo(-2.8, -2.2);
  ctx.lineTo(-8.8, -4.9);
  ctx.lineTo(-5.6, -1.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2.8, 2.2);
  ctx.lineTo(-8.8, 4.9);
  ctx.lineTo(-5.6, 1.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = `rgba(255, 112, 48, ${exhaustAlpha})`;
  ctx.beginPath();
  ctx.moveTo(-9.8, -2.4);
  ctx.lineTo(-13.5 - exhaustLen, 0);
  ctx.lineTo(-9.8, 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 220, 128, ${exhaustAlpha * 0.78})`;
  ctx.beginPath();
  ctx.moveTo(-9.6, -1.2);
  ctx.lineTo(-11.8 - exhaustLen * 0.72, 0);
  ctx.lineTo(-9.6, 1.2);
  ctx.closePath();
  ctx.fill();
}

function drawF15InterceptorLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
  halo.addColorStop(0, `rgba(102, 153, 255, ${0.3 + pulse * 0.22})`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d7ebff";
  ctx.beginPath();
  ctx.moveTo(5.2, 0);
  ctx.lineTo(0.8, -1.4);
  ctx.lineTo(-3.6, -1.1);
  ctx.lineTo(-4.9, 0);
  ctx.lineTo(-3.6, 1.1);
  ctx.lineTo(0.8, 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#7fb4ff";
  ctx.beginPath();
  ctx.moveTo(-0.8, -1.4);
  ctx.lineTo(-4.3, -3.2);
  ctx.lineTo(-2.8, -0.55);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.8, 1.4);
  ctx.lineTo(-4.3, 3.2);
  ctx.lineTo(-2.8, 0.55);
  ctx.closePath();
  ctx.fill();
}

function drawWildHornetLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetBody;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3.5, 4);
  ctx.lineTo(0, 2);
  ctx.lineTo(-3.5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetBright;
  ctx.fillRect(-0.8, -4, 1.6, 5);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetWing;
  ctx.fillRect(-6, 0, 4, 1.6);
  ctx.fillRect(2, 0, 4, 1.6);
}

function drawRoadrunnerLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerBody;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerFin;
  ctx.fillRect(-1.5, -8, 3, 5);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerHighlight;
  ctx.fillRect(-0.7, -5, 1.4, 2);
}

function drawPatriotSamLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotBody;
  ctx.fillRect(-3, -8, 6, 16);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotNose;
  ctx.beginPath();
  ctx.moveTo(-3, -8);
  ctx.lineTo(0, -13);
  ctx.lineTo(3, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotFin;
  ctx.fillRect(-5, 5, 2, 4);
  ctx.fillRect(3, 5, 2, 4);
}

export function buildUpgradeProjectileSpriteAssets(scale: number): UpgradeProjectileSpriteAssets {
  return {
    wildHornet: buildProjectileSpriteAsset(scale, WILD_HORNET_BOUNDS, 0.8, drawWildHornetLocal),
    roadrunner: buildProjectileSpriteAsset(scale, ROADRUNNER_BOUNDS, 0.8, drawRoadrunnerLocal),
    patriotSam: buildProjectileSpriteAsset(scale, PATRIOT_SAM_BOUNDS, 0.8, drawPatriotSamLocal),
  };
}

export function buildThreatSpriteAssets(scale: number): ThreatSpriteAssets {
  return {
    missile: buildProjectileSpriteAsset(scale, DEFAULT_MISSILE_BOUNDS, 0.8, drawDefaultMissileLocal),
    missile_fast: buildProjectileSpriteAsset(scale, MISSILE_FAST_BOUNDS, 0.5, drawFastMissileLocal),
    mirv: buildProjectileSpriteAsset(scale, MIRV_BOUNDS, 1, drawMirvLocal),
    mirv_warhead: buildProjectileSpriteAsset(scale, MIRV_WARHEAD_BOUNDS, 0.9, drawMirvWarheadLocal),
    bomb: buildProjectileSpriteAsset(scale, BOMB_BOUNDS, 0.9, drawBombLocal),
    stack_carrier_2: buildProjectileSpriteAsset(scale, STACK2_BOUNDS, 0.9, (ctx, framePhase) =>
      drawStackCarrierLocal(ctx, 2, framePhase),
    ),
    stack_carrier_3: buildProjectileSpriteAsset(scale, STACK3_BOUNDS, 0.9, (ctx, framePhase) =>
      drawStackCarrierLocal(ctx, 3, framePhase),
    ),
    stack_child: buildProjectileSpriteAsset(scale, STACK_CHILD_BOUNDS, 0.8, drawStackChildLocal),
    shahed136: buildProjectileSpriteAsset(scale, SHAHED_136_BOUNDS, 0.6, drawShahed136Local),
    shahed136_dive: buildProjectileSpriteAsset(scale, SHAHED_136_DIVE_BOUNDS, 0.55, drawShahed136DiveLocal),
    shahed238: buildProjectileSpriteAsset(scale, SHAHED_238_BOUNDS, 0.8, drawShahed238Local),
  };
}

export function buildInterceptorSpriteAssets(scale: number): InterceptorSpriteAssets {
  return {
    playerInterceptor: buildProjectileSpriteAsset(scale, PLAYER_INTERCEPTOR_BOUNDS, 0.8, drawPlayerInterceptorLocal),
    f15Interceptor: buildProjectileSpriteAsset(scale, F15_INTERCEPTOR_BOUNDS, 0.8, drawF15InterceptorLocal),
  };
}

export function drawBakedProjectileSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  asset: ProjectileSpriteAsset,
  { t, alpha = 1, sharpFrames = false }: { t: number; alpha?: number; sharpFrames?: boolean },
) {
  const spriteW = asset.staticSprite.width / asset.resolutionScale;
  const spriteH = asset.staticSprite.height / asset.resolutionScale;
  const frameCount = Math.max(1, asset.frameCount);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;

  if (asset.animFrames.length === 0 || frameCount <= 1) {
    ctx.drawImage(asset.staticSprite, asset.offset.x, asset.offset.y, spriteW, spriteH);
    ctx.restore();
    return;
  }

  const phase = (((t % asset.period) + asset.period) % asset.period) / asset.period;
  const frameProgress = phase * frameCount;
  const frameIndex = Math.floor(frameProgress) % frameCount;
  const blend = frameProgress % 1;

  ctx.globalAlpha = alpha * (sharpFrames ? 1 : 1 - blend);
  ctx.drawImage(asset.animFrames[frameIndex], asset.offset.x, asset.offset.y, spriteW, spriteH);
  if (!sharpFrames) {
    ctx.globalAlpha = alpha * blend;
    ctx.drawImage(asset.animFrames[(frameIndex + 1) % frameCount], asset.offset.x, asset.offset.y, spriteW, spriteH);
  }
  ctx.restore();
}
