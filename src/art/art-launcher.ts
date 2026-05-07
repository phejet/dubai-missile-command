import { createSpriteCanvas, type LauncherAssets, type SharedLauncherOptions } from "./art-core";

const LAUNCHER_ANIM_FRAME_COUNT = 8;
const LAUNCHER_ANIM_PERIOD_SECONDS = 10;

const LAUNCHER_CHASSIS_BOUNDS = { x: -56, y: -30, width: 112, height: 74 } as const;
const LAUNCHER_TURRET_BOUNDS = { x: -12, y: -15, width: 56, height: 30 } as const;
const LAUNCHER_TURRET_PIVOT = { x: 2, y: -16 } as const;

function getLauncherReadyLightAlpha(time: number) {
  return 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(time * 1.35 + 0.8));
}

function getLauncherChargeAlpha(time: number) {
  return 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(time * 1.6 + 0.45));
}

function getLauncherMuzzleBlink(time: number, phase = 0) {
  const blink = Math.max(0, Math.sin(time * 3.1 + phase));
  return Math.pow(blink, 0.4);
}

function getLauncherPalette(damaged: boolean) {
  return {
    base: damaged ? "#6a3028" : "#4e5e38",
    body: damaged ? "#7a3c34" : "#5c7044",
    turret: damaged ? "#8a4c44" : "#6a8050",
    tubeUpper: damaged ? "#6a3830" : "#506440",
    tubeLower: damaged ? "#6a3830" : "#445936",
    collarTop: damaged ? "#7a3c36" : "#526640",
    collarBottom: damaged ? "#562a26" : "#384a2a",
    shadow: "rgba(6, 10, 4, 0.92)",
    edge: damaged ? "rgba(240, 160, 130, 0.34)" : "rgba(190, 230, 120, 0.3)",
    chassisBloomA: damaged ? "rgba(255, 180, 140, 0.1)" : "rgba(200, 255, 180, 0.08)",
    chassisBloomB: damaged ? "rgba(220, 100, 80, 0.08)" : "rgba(120, 210, 100, 0.07)",
    readyCore: damaged ? "255, 142, 118" : "160, 244, 100",
    readyGlow: damaged ? "255, 108, 82" : "120, 220, 88",
    rimLight: damaged ? "rgba(255, 142, 120, 0.12)" : "rgba(160, 230, 100, 0.12)",
    panelFill: damaged ? "rgba(255, 100, 70, 0.12)" : "rgba(200, 240, 120, 0.14)",
    panelLine: damaged ? "rgba(130, 70, 58, 0.46)" : "rgba(90, 130, 58, 0.42)",
    ventFill: damaged ? "rgba(60, 24, 18, 0.9)" : "rgba(28, 40, 16, 0.9)",
    wheelFill: damaged ? "rgba(80, 36, 28, 0.9)" : "rgba(36, 52, 22, 0.9)",
    wheelLine: damaged ? "rgba(100, 52, 40, 0.5)" : "rgba(70, 100, 48, 0.5)",
    support: damaged ? "rgba(100, 52, 42, 0.9)" : "rgba(70, 100, 48, 0.9)",
    supportGlow: damaged ? "rgba(200, 90, 70, 0.16)" : "rgba(160, 220, 80, 0.14)",
    chargeCore: damaged ? "255, 132, 104" : "148, 236, 94",
    chargeGlow: damaged ? "214, 90, 70" : "90, 190, 60",
    muzzleCore: "255, 255, 200",
    muzzleGlow: "255, 52, 28",
  };
}

function drawLauncherChassisLocal(
  ctx: CanvasRenderingContext2D,
  {
    damaged,
    readyLightAlpha = 0,
    drawReadyLight = true,
  }: {
    damaged: boolean;
    readyLightAlpha?: number;
    drawReadyLight?: boolean;
  },
) {
  const palette = getLauncherPalette(damaged);

  const bloom = ctx.createRadialGradient(0, 6, 0, 0, 6, 58);
  bloom.addColorStop(0, palette.chassisBloomA);
  bloom.addColorStop(0.38, palette.chassisBloomB);
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(-56, -30, 112, 74);

  const baseGradient = ctx.createLinearGradient(-28, 0, 28, 0);
  baseGradient.addColorStop(0, "#303e22");
  baseGradient.addColorStop(0.5, palette.base);
  baseGradient.addColorStop(1, "#2c3a1e");
  ctx.fillStyle = baseGradient;
  ctx.beginPath();
  ctx.moveTo(-30, 2);
  ctx.lineTo(-28, -2);
  ctx.lineTo(28, -2);
  ctx.lineTo(30, 2);
  ctx.lineTo(28, 14);
  ctx.lineTo(-28, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-29, 2.5);
  ctx.lineTo(-27, -1.5);
  ctx.lineTo(27, -1.5);
  ctx.lineTo(29, 2.5);
  ctx.stroke();

  ctx.fillStyle = palette.wheelFill;
  for (let i = 0; i < 7; i++) ctx.fillRect(-25 + i * 8, 5, 5, 7);
  ctx.strokeStyle = palette.wheelLine;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-26, 13);
  ctx.lineTo(26, 13);
  ctx.stroke();

  const bodyGradient = ctx.createLinearGradient(-22, -14, 22, -14);
  bodyGradient.addColorStop(0, "#384e26");
  bodyGradient.addColorStop(0.3, palette.body);
  bodyGradient.addColorStop(0.75, "#4a602e");
  bodyGradient.addColorStop(1, "#344824");
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-24, -8);
  ctx.lineTo(-16, -14);
  ctx.lineTo(16, -14);
  ctx.lineTo(22, -8);
  ctx.lineTo(24, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.72;
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-23, -7.5);
  ctx.lineTo(-15.5, -13.5);
  ctx.lineTo(15.5, -13.5);
  ctx.lineTo(21.5, -7.5);
  ctx.stroke();

  ctx.fillStyle = palette.panelFill;
  ctx.beginPath();
  ctx.moveTo(-10, -12);
  ctx.lineTo(-6, -15);
  ctx.lineTo(8, -15);
  ctx.lineTo(12, -12);
  ctx.lineTo(10, -10);
  ctx.lineTo(-8, -10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = palette.panelLine;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.lineTo(20, -4);
  ctx.moveTo(-8, 0);
  ctx.lineTo(-8, -8);
  ctx.moveTo(8, 0);
  ctx.lineTo(8, -8);
  ctx.stroke();

  ctx.fillStyle = palette.ventFill;
  ctx.fillRect(-4, -8, 3, 3);
  ctx.fillRect(1, -8, 3, 3);

  ctx.strokeStyle = palette.support;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-24, 12);
  ctx.stroke();
  ctx.strokeStyle = palette.supportGlow;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-23, 11);
  ctx.stroke();

  const rimDir = 1;
  ctx.fillStyle = palette.rimLight;
  ctx.fillRect(rimDir * 18 - 1.2, -12, 2.4, 18);

  if (!drawReadyLight) return;

  const readyGlow = ctx.createRadialGradient(1, 2, 0, 1, 2, 10);
  readyGlow.addColorStop(0, `rgba(${palette.readyGlow}, ${readyLightAlpha * 0.72})`);
  readyGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = readyGlow;
  ctx.fillRect(-10, -8, 24, 20);
  ctx.fillStyle = `rgba(${palette.readyCore}, ${0.18 + readyLightAlpha * 0.82})`;
  ctx.fillRect(-1.5, -0.5, 4.5, 4.5);
}

function drawLauncherTurretLocal(ctx: CanvasRenderingContext2D, damaged: boolean) {
  const palette = getLauncherPalette(damaged);
  const turretGradient = ctx.createLinearGradient(-10, 0, 22, 0);
  turretGradient.addColorStop(0, "#3c5228");
  turretGradient.addColorStop(0.35, palette.turret);
  turretGradient.addColorStop(1, "#445e30");
  ctx.fillStyle = turretGradient;
  ctx.beginPath();
  ctx.moveTo(-10, -6);
  ctx.lineTo(20, -5);
  ctx.lineTo(24, -2.5);
  ctx.lineTo(24, 2.5);
  ctx.lineTo(20, 5);
  ctx.lineTo(-10, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-9, -5.5);
  ctx.lineTo(20, -4.5);
  ctx.lineTo(23, -2);
  ctx.stroke();

  ctx.fillStyle = palette.tubeUpper;
  ctx.beginPath();
  ctx.moveTo(20, -6.5);
  ctx.lineTo(38, -5);
  ctx.lineTo(38.5, -2.5);
  ctx.lineTo(20, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(20, -6);
  ctx.lineTo(37, -4.5);
  ctx.stroke();

  ctx.fillStyle = palette.tubeLower;
  ctx.beginPath();
  ctx.moveTo(20, 2);
  ctx.lineTo(38.5, 2.5);
  ctx.lineTo(38, 5);
  ctx.lineTo(20, 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(20, 2.5);
  ctx.lineTo(37, 3.8);
  ctx.stroke();

  ctx.fillStyle = damaged ? "#3a1e18" : "#2a3418";
  ctx.fillRect(22, -2, 16.5, 4);

  const collarGradient = ctx.createLinearGradient(-10, -7, -10, 7);
  collarGradient.addColorStop(0, palette.collarTop);
  collarGradient.addColorStop(1, palette.collarBottom);
  ctx.fillStyle = collarGradient;
  ctx.fillRect(-10, -7, 12, 14);
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1;
  ctx.strokeRect(-10, -7, 12, 14);
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-9, -6.5);
  ctx.lineTo(1, -6.5);
  ctx.stroke();
}

function drawLauncherTurretEffectsLocal(
  ctx: CanvasRenderingContext2D,
  time: number,
  phase: number,
  damaged: boolean,
  muzzleFlash: number,
) {
  const palette = getLauncherPalette(damaged);
  const chargeAlpha = getLauncherChargeAlpha(time);
  const chargeGlow = ctx.createRadialGradient(4, 0, 0, 4, 0, 12);
  chargeGlow.addColorStop(0, `rgba(${palette.chargeCore}, ${chargeAlpha * 0.9})`);
  chargeGlow.addColorStop(0.62, `rgba(${palette.chargeGlow}, ${chargeAlpha * 0.3})`);
  chargeGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = chargeGlow;
  ctx.fillRect(-7, -12, 24, 24);
  ctx.fillStyle = `rgba(${palette.chargeCore}, ${0.18 + chargeAlpha * 0.42})`;
  ctx.fillRect(2, -1, 9, 2);

  const blinkIntensity = getLauncherMuzzleBlink(time, phase);
  const flashStrength = Math.max(blinkIntensity, muzzleFlash);
  const muzzleRadius = 7 + muzzleFlash * 6;
  const muzzleGlow = ctx.createRadialGradient(40, 0, 0, 40, 0, muzzleRadius + 4);
  muzzleGlow.addColorStop(0, `rgba(${palette.muzzleGlow}, ${flashStrength * 0.62})`);
  muzzleGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = muzzleGlow;
  ctx.fillRect(29, -(muzzleRadius + 4), (muzzleRadius + 4) * 2, (muzzleRadius + 4) * 2);
  ctx.fillStyle = `rgba(${palette.muzzleCore}, ${0.46 + blinkIntensity * 0.4})`;
  ctx.fillRect(38.5, -1, 2, 2);
  ctx.fillStyle = `rgba(${palette.muzzleGlow}, ${0.48 + blinkIntensity * 0.34})`;
  ctx.fillRect(38, -1.5, 3, 3);
}

function getLauncherBakeResolution(scale: number) {
  return Math.max(1, Math.ceil(scale * 2));
}

export function buildLauncherAssets(scale: number, damaged: boolean): LauncherAssets {
  const resolutionScale = getLauncherBakeResolution(scale);

  const chassisStaticSprite = createSpriteCanvas(
    LAUNCHER_CHASSIS_BOUNDS.width * scale,
    LAUNCHER_CHASSIS_BOUNDS.height * scale,
    resolutionScale,
  );
  const chassisStaticCtx = chassisStaticSprite.getContext("2d");
  if (chassisStaticCtx) {
    chassisStaticCtx.scale(scale * resolutionScale, scale * resolutionScale);
    chassisStaticCtx.translate(-LAUNCHER_CHASSIS_BOUNDS.x, -LAUNCHER_CHASSIS_BOUNDS.y);
    drawLauncherChassisLocal(chassisStaticCtx, { damaged, drawReadyLight: false });
  }

  const chassisAnimFrames = Array.from({ length: LAUNCHER_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(
      LAUNCHER_CHASSIS_BOUNDS.width * scale,
      LAUNCHER_CHASSIS_BOUNDS.height * scale,
      resolutionScale,
    );
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale * resolutionScale, scale * resolutionScale);
      ctx.translate(-LAUNCHER_CHASSIS_BOUNDS.x, -LAUNCHER_CHASSIS_BOUNDS.y);
      drawLauncherChassisLocal(ctx, {
        damaged,
        readyLightAlpha: getLauncherReadyLightAlpha(
          (frameIndex / LAUNCHER_ANIM_FRAME_COUNT) * LAUNCHER_ANIM_PERIOD_SECONDS,
        ),
      });
    }
    return canvas;
  });

  const turretSprite = createSpriteCanvas(
    LAUNCHER_TURRET_BOUNDS.width * scale,
    LAUNCHER_TURRET_BOUNDS.height * scale,
    resolutionScale,
  );
  const turretCtx = turretSprite.getContext("2d");
  if (turretCtx) {
    turretCtx.scale(scale * resolutionScale, scale * resolutionScale);
    turretCtx.translate(-LAUNCHER_TURRET_BOUNDS.x, -LAUNCHER_TURRET_BOUNDS.y);
    drawLauncherTurretLocal(turretCtx, damaged);
  }

  return {
    chassisStaticSprite,
    chassisAnimFrames,
    chassisOffset: {
      x: LAUNCHER_CHASSIS_BOUNDS.x * scale,
      y: LAUNCHER_CHASSIS_BOUNDS.y * scale,
    },
    turretSprite,
    turretOffset: {
      x: LAUNCHER_TURRET_BOUNDS.x * scale,
      y: LAUNCHER_TURRET_BOUNDS.y * scale,
    },
    turretPivot: {
      x: LAUNCHER_TURRET_PIVOT.x * scale,
      y: LAUNCHER_TURRET_PIVOT.y * scale,
    },
    frameCount: LAUNCHER_ANIM_FRAME_COUNT,
    period: LAUNCHER_ANIM_PERIOD_SECONDS,
    resolutionScale,
    scale,
    damaged,
  };
}

export function drawBakedLauncher(
  ctx: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  barrelAngle: number,
  assets: LauncherAssets,
  {
    t,
    alpha = 1,
    muzzleFlash = 0,
    sharpFrames = false,
  }: Pick<SharedLauncherOptions, "t" | "alpha" | "muzzleFlash"> & { sharpFrames?: boolean },
) {
  const phase = (((t % assets.period) + assets.period) % assets.period) / assets.period;
  const frameProgress = phase * assets.frameCount;
  const frameIndex = Math.floor(frameProgress) % assets.frameCount;
  const blend = frameProgress % 1;
  const chassisW = assets.chassisStaticSprite.width / assets.resolutionScale;
  const chassisH = assets.chassisStaticSprite.height / assets.resolutionScale;
  const turretW = assets.turretSprite.width / assets.resolutionScale;
  const turretH = assets.turretSprite.height / assets.resolutionScale;

  ctx.save();
  ctx.translate(lx, ly);
  ctx.globalAlpha = alpha;
  ctx.drawImage(assets.chassisStaticSprite, assets.chassisOffset.x, assets.chassisOffset.y, chassisW, chassisH);
  ctx.globalAlpha = alpha * (sharpFrames ? 1 : 1 - blend);
  ctx.drawImage(
    assets.chassisAnimFrames[frameIndex],
    assets.chassisOffset.x,
    assets.chassisOffset.y,
    chassisW,
    chassisH,
  );
  if (!sharpFrames) {
    ctx.globalAlpha = alpha * blend;
    ctx.drawImage(
      assets.chassisAnimFrames[(frameIndex + 1) % assets.frameCount],
      assets.chassisOffset.x,
      assets.chassisOffset.y,
      chassisW,
      chassisH,
    );
  }
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(assets.turretPivot.x, assets.turretPivot.y);
  ctx.rotate(barrelAngle);
  ctx.drawImage(assets.turretSprite, assets.turretOffset.x, assets.turretOffset.y, turretW, turretH);
  ctx.scale(assets.scale, assets.scale);
  drawLauncherTurretEffectsLocal(ctx, t, lx * 0.0068, assets.damaged, muzzleFlash);
  ctx.restore();
  ctx.restore();
}
