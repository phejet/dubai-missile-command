import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  COL,
  BURJ_X,
  BURJ_H,
  LAUNCHERS,
  burjHalfW,
  getAmmoCapacity,
  getPhalanxTurrets,
  ov,
} from "./game-logic.js";
import { UPGRADES } from "./game-sim.js";

// FPS probe: measure first 60 frames, disable shadowBlur if avg FPS < 45
export const perfState = { frameCount: 0, startTime: 0, glowEnabled: true, probed: false };

// Sky nebula background — loaded once, drawn every frame
let _skyImg = null;
let _skyLoading = false;
function getSkyImage() {
  if (_skyImg) return _skyImg;
  if (_skyLoading) return null;
  if (typeof Image === "undefined") return null; // headless/test env
  _skyLoading = true;
  const img = new Image();
  img.src = new URL("../public/sky-nebula.png", import.meta.url).href;
  img.onload = () => {
    _skyImg = img;
  };
  img.onerror = () => {
    _skyLoading = false; // allow retry on next call
  };
  return null;
}

const DEFAULT_LAYOUT_PROFILE = {
  showTopHud: true,
  showSystemLabels: true,
  externalTitle: false,
  externalGameOver: false,
  crosshairFillRadius: 18,
  crosshairOuterRadius: 12,
  crosshairInnerRadius: 12,
  crosshairGap: 6,
  crosshairArmLength: 18,
  mirvWarningFontSize: 18,
  mirvWarningY: 56,
  purchaseToastFontSize: 22,
  purchaseToastY: CANVAS_H / 3,
  lowAmmoFontSize: 28,
  lowAmmoY: CANVAS_H / 2 - 40,
  waveClearedY: 312,
  multiKillLabelSize: 22,
  multiKillBonusSize: 16,
  cameraFrame: null,
  renderHeight: CANVAS_H,
  buildingScale: 1,
  burjScale: 1,
  launcherScale: 1,
  enemyScale: 1,
  projectileScale: 1,
  effectScale: 1,
  planeScale: 1,
};

function resolveLayoutProfile(layoutProfile = {}) {
  return { ...DEFAULT_LAYOUT_PROFILE, ...layoutProfile };
}

function withAnchorScale(ctx, anchorX, anchorY, scale, draw) {
  if (scale === 1) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.scale(scale, scale);
  ctx.translate(-anchorX, -anchorY);
  draw();
  ctx.restore();
}

const GLOW_SCALE = 0.45;

export function glow(ctx, color, radius) {
  if (!ov("glow.enabled", perfState.glowEnabled)) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * ov("glow.scale", GLOW_SCALE);
}

export function glowOff(ctx) {
  if (!ov("glow.enabled", perfState.glowEnabled)) return;
  ctx.shadowBlur = 0;
}

export function hash01(a, b = 0, c = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

export function pulse(time, speed, phase = 0, min = 0, max = 1) {
  const t = 0.5 + 0.5 * Math.sin(time * speed + phase);
  return min + (max - min) * t;
}

function drawSky(ctx, game, layout) {
  // Sky — base gradient always drawn, nebula layered on top at low opacity
  const skyGrad = ctx.createLinearGradient(0, 0, 0, layout.renderHeight);
  skyGrad.addColorStop(0, COL.sky1);
  skyGrad.addColorStop(0.4, COL.sky2);
  skyGrad.addColorStop(0.7, COL.sky3);
  skyGrad.addColorStop(1, COL.ground);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, layout.renderHeight);

  // Nebula overlay — subtle texture, not dominant
  const skyImg = getSkyImage();
  if (skyImg) {
    ctx.globalAlpha = ov("sky.nebulaOpacity", 0.4);
    ctx.drawImage(skyImg, 0, 0, CANVAS_W, layout.renderHeight);
    ctx.globalAlpha = 1;
  }

  // Animated twinkling stars
  game.stars.forEach((s) => {
    const twinkle = 0.35 + 0.65 * Math.sin(game.time * ov("sky.starTwinkleSpeed", 0.02) + s.twinkle);
    const drawStar = (y) => {
      if (y < 0 || y > layout.renderHeight) return;
      ctx.globalAlpha = twinkle;
      glow(ctx, "#ffffff", 3 + s.size * 3);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    };
    drawStar(s.y);
  });
  ctx.globalAlpha = 1;

  // Moon — crescent with warm glow
  glow(ctx, "#ffe8b0", 24);
  ctx.fillStyle = "#ffe8b0";
  ctx.beginPath();
  ctx.arc(780, 60, 25, 0, Math.PI * 2);
  ctx.fill();
  glowOff(ctx);
  ctx.fillStyle = skyImg ? "#0a0e1a" : COL.sky1;
  ctx.beginPath();
  ctx.arc(788, 55, 22, 0, Math.PI * 2);
  ctx.fill();

  // Atmospheric bloom over the skyline
  const skylineGlow = ctx.createRadialGradient(BURJ_X, GROUND_Y - 60, 40, BURJ_X, GROUND_Y - 60, 420);
  skylineGlow.addColorStop(0, "rgba(80, 180, 255, 0.16)");
  skylineGlow.addColorStop(0.45, "rgba(50, 120, 220, 0.09)");
  skylineGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = skylineGlow;
  ctx.fillRect(0, 0, CANVAS_W, GROUND_Y + 30);

  const heatBand = ctx.createLinearGradient(0, GROUND_Y - 140, 0, GROUND_Y + 10);
  heatBand.addColorStop(0, "rgba(255, 160, 90, 0)");
  heatBand.addColorStop(0.55, "rgba(255, 120, 70, 0.06)");
  heatBand.addColorStop(1, "rgba(255, 90, 50, 0.12)");
  ctx.fillStyle = heatBand;
  ctx.fillRect(0, GROUND_Y - 140, CANVAS_W, 170);

  // Distant skyline silhouettes and dunes
  ctx.fillStyle = "rgba(20, 26, 46, 0.75)";
  for (let i = 0; i < 12; i++) {
    const x = i * 82 + ((i % 2) * 10 - 6);
    const w = 42 + (i % 3) * 18;
    const h = 28 + ((i * 17) % 4) * 12;
    ctx.fillRect(x, GROUND_Y - 40 - h, w, h);
  }
  ctx.fillStyle = "rgba(38, 30, 58, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= CANVAS_W; x += 30) {
    const y = GROUND_Y - 18 - Math.sin(x * 0.012 + game.time * 0.01) * 7 - Math.cos(x * 0.02) * 4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(CANVAS_W, CANVAS_H);
  ctx.lineTo(0, CANVAS_H);
  ctx.closePath();
  ctx.fill();
}

function drawDecoyFlares(ctx, game, layout) {
  // Decoy flares
  game.flares.forEach((f) => {
    if (!f.alive) return;
    const alpha = Math.min(1, f.life / 24);
    const flicker = 0.78 + 0.22 * Math.sin(game.time * 0.25 + f.x * 0.03);
    if (f.trail?.length) {
      f.trail.forEach((t, i) => {
        const tAlpha = alpha * (i / f.trail.length) * 0.32;
        const radius = (1.5 + (i / f.trail.length) * 3.5) * layout.effectScale;
        ctx.fillStyle = `rgba(255,170,90,${tAlpha})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = alpha * flicker;
    withAnchorScale(ctx, f.x, f.y, layout.projectileScale, () => {
      ctx.fillStyle = COL.flare;
      glow(ctx, COL.flare, 16 * layout.effectScale);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 5 + Math.sin(game.time * 0.18 + f.id) * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,230,180,0.65)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 8 + Math.sin(game.time * 0.16 + f.id) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff4d0";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,245,220,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.x - 6, f.y);
      ctx.lineTo(f.x + 6, f.y);
      ctx.moveTo(f.x, f.y - 6);
      ctx.lineTo(f.x, f.y + 6);
      ctx.stroke();
    });
    glowOff(ctx);
    ctx.globalAlpha = 1;
  });
}

function drawGroundAndBuildings(ctx, game, layout) {
  // Ground
  ctx.fillStyle = COL.sand;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 20);
  groundGrad.addColorStop(0, "#3a3060");
  groundGrad.addColorStop(1, COL.sand);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, 20);

  // Buildings
  game.buildings.forEach((b) => {
    withAnchorScale(ctx, b.x + b.w / 2, CITY_Y, layout.buildingScale, () => {
      if (!b.alive) {
        ctx.fillStyle = "#333";
        ctx.fillRect(b.x, CITY_Y - 8, b.w, 8);
        return;
      }
      const bTop = CITY_Y - b.h;
      // Main face — subtle left-right gradient for 3D
      const bGrad = ctx.createLinearGradient(b.x, bTop, b.x + b.w, CITY_Y);
      bGrad.addColorStop(0, "#1e2a48");
      bGrad.addColorStop(0.4, "#151e35");
      bGrad.addColorStop(1, "#0c1320");
      ctx.fillStyle = bGrad;
      ctx.fillRect(b.x, bTop, b.w, b.h);

      // Rooftop cap
      ctx.fillStyle = "#2a3555";
      ctx.fillRect(b.x - 1, bTop, b.w + 2, 3);

      // Left edge highlight
      const edgeGlow = ctx.createLinearGradient(b.x, bTop, b.x + 8, bTop);
      edgeGlow.addColorStop(0, "rgba(180,210,255,0.1)");
      edgeGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = edgeGlow;
      ctx.fillRect(b.x, bTop, 8, b.h);

      // Right edge shadow
      const edgeDark = ctx.createLinearGradient(b.x + b.w - 6, bTop, b.x + b.w, bTop);
      edgeDark.addColorStop(0, "rgba(0,0,0,0)");
      edgeDark.addColorStop(1, "rgba(0,0,0,0.15)");
      ctx.fillStyle = edgeDark;
      ctx.fillRect(b.x + b.w - 6, bTop, 6, b.h);

      // Subtle outline
      ctx.strokeStyle = "rgba(80,120,200,0.1)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(b.x, bTop, b.w, b.h);

      // Windows — warm glow
      const winW = 4,
        winH = 5,
        gap = 8,
        cols = b.windows;
      const startX = b.x + (b.w - cols * (winW + gap) + gap) / 2;
      for (let row = 0; row < Math.floor(b.h / 15); row++) {
        for (let col = 0; col < cols; col++) {
          const seed = hash01(b.x, row, col);
          const lit = Math.sin(game.time * (0.006 + seed * 0.01) + b.x * 0.03 + row * 0.8 + col * 2.4) > -0.35;
          const brightness = 0.55 + 0.45 * Math.sin(game.time * (0.01 + seed * 0.02) + row + col * 2 + seed * 4);
          if (lit) {
            // Warm window with slight glow spill
            const wx = startX + col * (winW + gap);
            const wy = bTop + 10 + row * 15;
            ctx.globalAlpha = 0.08 + brightness * 0.06;
            ctx.fillStyle = "#ffcc66";
            ctx.fillRect(wx - 1, wy - 1, winW + 2, winH + 2);
            ctx.globalAlpha = 0.5 + brightness * 0.35;
            ctx.fillStyle = COL.buildingLit;
            ctx.fillRect(wx, wy, winW, winH);
          } else {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = "#080c18";
            ctx.fillRect(startX + col * (winW + gap), bTop + 10 + row * 15, winW, winH);
          }
        }
      }
      ctx.globalAlpha = 1;
    });
  });
}

function drawBurjKhalifa(ctx, game, layout) {
  // Burj Khalifa
  if (game.burjAlive) {
    const bx = BURJ_X,
      by = CITY_Y,
      bh = BURJ_H;
    withAnchorScale(ctx, bx, by, layout.burjScale, () => {
      ctx.save();

      // Setback tiers — the real Burj has Y-shaped cross section with visible steps
      // Each tier: [heightFraction, halfWidth] — top to bottom
      const tiers = [
        [1.0, 3], // top of tower
        [0.88, 4], // first setback
        [0.73, 6], // second setback
        [0.58, 8.5], // third setback
        [0.42, 10.5], // fourth — observation deck area
        [0.38, 12], // observation deck bulge
        [0.35, 10.5], // below deck, steps back in
        [0.22, 12], // fifth setback
        [0.1, 14], // base widening
        [0.0, 16], // ground level
      ];

      // Build tower silhouette from tiers
      function burjPath() {
        ctx.beginPath();
        ctx.moveTo(bx, by - bh - 30); // spire tip
        ctx.lineTo(bx - 1.5, by - bh - 12);
        // Left side — top to bottom
        for (const [hf, hw] of tiers) {
          ctx.lineTo(bx - hw, by - bh * hf);
        }
        // Right side — bottom to top
        for (let i = tiers.length - 1; i >= 0; i--) {
          ctx.lineTo(bx + tiers[i][1], by - bh * tiers[i][0]);
        }
        ctx.lineTo(bx + 1.5, by - bh - 12);
        ctx.closePath();
      }

      // Helper: get half-width at a given height fraction
      function hwAt(ht) {
        for (let j = 0; j < tiers.length - 1; j++) {
          if (ht >= tiers[j + 1][0] && ht <= tiers[j][0]) {
            const frac = (ht - tiers[j + 1][0]) / (tiers[j][0] - tiers[j + 1][0]);
            return tiers[j + 1][1] + (tiers[j][1] - tiers[j + 1][1]) * frac;
          }
        }
        return 16;
      }

      // === DRAMATIC GLOW AURA — drawn BEFORE the tower body ===
      // Large warm corona radiating from the tower
      const auraGrad = ctx.createRadialGradient(bx, by - bh * 0.3, 10, bx, by - bh * 0.3, 180);
      auraGrad.addColorStop(0, `rgba(255,200,120,${ov("burj.coronaAlpha", 0.1)})`);
      auraGrad.addColorStop(0.3, "rgba(255,170,80,0.05)");
      auraGrad.addColorStop(0.6, "rgba(200,140,60,0.02)");
      auraGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = auraGrad;
      ctx.fillRect(bx - 180, by - bh - 30, 360, bh + 60);

      // Vertical light beam behind tower (uplight effect)
      const beamGrad = ctx.createLinearGradient(bx - 30, by, bx + 30, by);
      beamGrad.addColorStop(0, "rgba(0,0,0,0)");
      beamGrad.addColorStop(0.3, "rgba(255,200,140,0.04)");
      beamGrad.addColorStop(0.5, "rgba(255,220,160,0.06)");
      beamGrad.addColorStop(0.7, "rgba(255,200,140,0.04)");
      beamGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = beamGrad;
      ctx.fillRect(bx - 30, by - bh - 40, 60, bh + 50);

      // === TOWER BODY ===
      // Warm golden gradient — looks lit up at night
      const burjGrad = ctx.createLinearGradient(bx, by, bx, by - bh);
      burjGrad.addColorStop(0, "#a89878"); // warm base, dialed down
      burjGrad.addColorStop(0.2, "#a89888");
      burjGrad.addColorStop(0.4, "#b0a898");
      burjGrad.addColorStop(0.65, "#c0c0c8");
      burjGrad.addColorStop(0.85, "#d0d0d8");
      burjGrad.addColorStop(1, "#dde0e8"); // bright moonlit top
      ctx.fillStyle = burjGrad;
      burjPath();
      ctx.fill();

      // Clip for interior details
      ctx.save();
      burjPath();
      ctx.clip();

      // Strong left highlight — bright moonlight edge
      const moonHL = ctx.createLinearGradient(bx - 16, 0, bx, 0);
      moonHL.addColorStop(0, "rgba(255,255,255,0.3)");
      moonHL.addColorStop(0.4, "rgba(220,230,255,0.12)");
      moonHL.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = moonHL;
      ctx.fillRect(bx - 16, by - bh - 30, 18, bh + 30);

      // Deep right shadow
      const rightShade = ctx.createLinearGradient(bx, 0, bx + 16, 0);
      rightShade.addColorStop(0, "rgba(0,0,0,0)");
      rightShade.addColorStop(0.4, "rgba(0,0,0,0.1)");
      rightShade.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = rightShade;
      ctx.fillRect(bx, by - bh - 30, 18, bh + 30);

      // Warm uplight on lower half
      const uplightGrad = ctx.createLinearGradient(bx, by, bx, by - bh * 0.5);
      uplightGrad.addColorStop(0, `rgba(255,180,80,${ov("burj.uplightAlpha", 0.08)})`);
      uplightGrad.addColorStop(0.5, "rgba(255,160,60,0.03)");
      uplightGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = uplightGrad;
      ctx.fillRect(bx - 16, by - bh * 0.5, 32, bh * 0.5);

      // Setback tier shadows
      for (let i = 1; i < tiers.length; i++) {
        const [hf, hw] = tiers[i];
        const [, prevHw] = tiers[i - 1];
        if (hw > prevHw) {
          const ly = by - bh * hf;
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(bx - hw, ly, hw * 2, 3);
          ctx.fillStyle = "rgba(255,240,200,0.1)";
          ctx.fillRect(bx - hw, ly - 1, hw * 2, 1);
        }
      }

      // Window bands — bright warm strips, more visible
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        const ht = 0.03 + 0.92 * t;
        const ly = by - bh * ht;
        const lw = hwAt(ht) * 0.75;
        if (lw < 2) continue;
        const lit = Math.sin(game.time * 0.05 + i * 0.5) > -0.4;
        if (lit) {
          const warmth = 1 - t;
          const r = Math.floor(200 + warmth * 55);
          const g = Math.floor(160 + warmth * 60);
          const b = Math.floor(80 + (1 - warmth) * 140);
          const a = 0.12 + 0.1 * Math.sin(game.time * 0.05 + i);
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          ctx.fillRect(bx - lw, ly, lw * 2, 2);
        }
      }

      // Observation deck — bright warm glow band
      const deckY = by - bh * 0.4;
      ctx.fillStyle = "rgba(255,220,140,0.25)";
      ctx.fillRect(bx - 12, deckY, 24, 12);
      ctx.fillStyle = "rgba(255,255,220,0.15)";
      ctx.fillRect(bx - 11, deckY + 2, 22, 8);
      for (let w = -9; w <= 8; w += 3) {
        ctx.fillStyle = "rgba(255,240,180,0.3)";
        ctx.fillRect(bx + w, deckY + 3, 2, 5);
      }

      ctx.restore(); // end clip

      // Bright outline glow — the tower glows against the dark sky
      glow(ctx, "#ffcc66", ov("burj.outlineGlowRadius", 25) + Math.sin(game.time * 0.03) * 8);
      ctx.strokeStyle = "rgba(255,200,120,0.25)";
      ctx.lineWidth = 1.2;
      burjPath();
      ctx.stroke();
      glowOff(ctx);

      // Secondary cool blue edge glow
      glow(ctx, COL.burjGlow, 10);
      ctx.strokeStyle = "rgba(100,160,255,0.15)";
      ctx.lineWidth = 0.6;
      burjPath();
      ctx.stroke();
      glowOff(ctx);

      // Central spine — bright bright white
      const spineGlow = ctx.createLinearGradient(bx, by, bx, by - bh - 25);
      spineGlow.addColorStop(0, "rgba(255,220,160,0.2)");
      spineGlow.addColorStop(0.3, "rgba(255,240,200,0.35)");
      spineGlow.addColorStop(0.7, "rgba(255,255,255,0.45)");
      spineGlow.addColorStop(1, "rgba(255,255,255,0.6)");
      ctx.fillStyle = spineGlow;
      ctx.fillRect(bx - 0.5, by - bh - 25, 1, bh + 20);

      // Warm ground pool — light spilling onto ground from tower
      const poolGrad = ctx.createRadialGradient(bx, by + 5, 5, bx, by + 5, ov("burj.basePoolRadius", 150));
      poolGrad.addColorStop(0, `rgba(255,180,100,${ov("burj.basePoolAlpha", 0.08)})`);
      poolGrad.addColorStop(0.3, "rgba(255,160,80,0.04)");
      poolGrad.addColorStop(0.6, "rgba(200,120,50,0.015)");
      poolGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = poolGrad;
      ctx.fillRect(bx - 150, by - 20, 300, 60);

      // Base podium — wide, warmly lit
      ctx.fillStyle = "#5a4a38";
      ctx.fillRect(bx - 24, by - 6, 48, 6);
      const podGrad = ctx.createLinearGradient(bx - 24, by - 6, bx - 24, by);
      podGrad.addColorStop(0, "rgba(255,200,120,0.15)");
      podGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = podGrad;
      ctx.fillRect(bx - 24, by - 6, 48, 6);

      // Aviation warning light — dramatic red pulse
      const redPulse = Math.sin(game.time * 0.1);
      if (redPulse > 0.3) {
        const redAlpha = (redPulse - 0.3) / 0.7;
        ctx.fillStyle = "#ff0000";
        glow(ctx, "#ff0000", 20 + redAlpha * 15);
        ctx.globalAlpha = 0.5 + redAlpha * 0.5;
        ctx.beginPath();
        ctx.arc(bx, by - bh - 30, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        glowOff(ctx);
      }
      if (game.upgrades.ironBeam > 0) {
        const lvl = game.upgrades.ironBeam;
        const chargeTime = [360, 240, 180][lvl - 1];
        const chargeRatio = Math.min(game.ironBeamTimer / chargeTime, 1);
        const ready = chargeRatio >= 1;
        const cx = bx,
          cy = by - bh * 0.6,
          r = 5;
        ctx.strokeStyle = "rgba(255,34,0,0.15)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = ready ? "#ff2200" : `rgba(255,34,0,${0.3 + chargeRatio * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * chargeRatio);
        ctx.stroke();
        if (ready) {
          const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.12);
          ctx.fillStyle = `rgba(255,34,0,${0.6 + pulse * 0.4})`;
          glow(ctx, "#ff2200", 10);
        } else {
          ctx.fillStyle = `rgba(255,34,0,${0.15 + chargeRatio * 0.3})`;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (ready) glowOff(ctx);
      }
      ctx.restore();
      const hpW = 40,
        hpH = 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW, hpH);
      ctx.fillStyle = game.burjHealth > 2 ? "#44ff88" : game.burjHealth > 1 ? "#ffaa00" : "#ff3333";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW * (game.burjHealth / 5), hpH);
    });
  } else {
    withAnchorScale(ctx, BURJ_X, CITY_Y, layout.burjScale, () => {
      ctx.fillStyle = "#444";
      // Use deterministic pseudo-random offsets based on index to avoid per-frame jitter
      for (let i = 0; i < 8; i++) {
        const h1 = ((i * 7 + 3) % 13) / 13;
        const h2 = ((i * 11 + 5) % 13) / 13;
        ctx.fillRect(BURJ_X - 15 + i * 4, CITY_Y - 10 - h1 * 20, 5, 10 + h2 * 15);
      }
    });
  }
}

function drawPlanes(ctx, game, layout) {
  // F-15 Eagle fighter jets
  game.planes.forEach((p) => {
    if (!p.alive) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.vx < 0) ctx.scale(-1, 1);
    // Bank when evading
    if (p.evadeTimer > 0) {
      const bankAngle = p.vy > 0 ? 0.3 : -0.3;
      ctx.rotate(bankAngle);
    }
    ctx.scale(layout.planeScale, layout.planeScale);
    // Fuselage — sleek fighter body
    ctx.fillStyle = "#7888a0";
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(10, -3);
    ctx.lineTo(-18, -3.5);
    ctx.lineTo(-22, -2);
    ctx.lineTo(-22, 2);
    ctx.lineTo(-18, 3.5);
    ctx.lineTo(10, 3);
    ctx.closePath();
    ctx.fill();
    // Nose cone — pointed
    ctx.fillStyle = "#5a6a80";
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(30, 0);
    ctx.lineTo(22, -1.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(30, 0);
    ctx.lineTo(22, 1.5);
    ctx.closePath();
    ctx.fill();
    // Swept wings
    ctx.fillStyle = "#687890";
    ctx.beginPath();
    ctx.moveTo(2, -3);
    ctx.lineTo(-8, -16);
    ctx.lineTo(-14, -14);
    ctx.lineTo(-6, -3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2, 3);
    ctx.lineTo(-8, 16);
    ctx.lineTo(-14, 14);
    ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fill();
    // Twin vertical stabilizers
    ctx.fillStyle = "#5a6878";
    ctx.beginPath();
    ctx.moveTo(-16, -3.5);
    ctx.lineTo(-20, -10);
    ctx.lineTo(-22, -9);
    ctx.lineTo(-20, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-16, 3.5);
    ctx.lineTo(-20, 10);
    ctx.lineTo(-22, 9);
    ctx.lineTo(-20, 3.5);
    ctx.closePath();
    ctx.fill();
    // Engine nozzles (twin)
    ctx.fillStyle = "#4a5060";
    ctx.beginPath();
    ctx.ellipse(-22, -2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-22, 2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Afterburner glow
    const abLen = 5 + 4 * pulse(game.time, 0.35, p.x * 0.04 + p.y * 0.02);
    ctx.fillStyle = "#ff8844";
    glow(ctx, "#ff6600", 8);
    ctx.beginPath();
    ctx.moveTo(-22, -3);
    ctx.lineTo(-22 - abLen, -2);
    ctx.lineTo(-22, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-22, 1);
    ctx.lineTo(-22 - abLen, 2);
    ctx.lineTo(-22, 3);
    ctx.closePath();
    ctx.fill();
    glowOff(ctx);
    // Cockpit
    ctx.fillStyle = "rgba(100,200,255,0.4)";
    ctx.beginPath();
    ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nav lights
    if (Math.sin(p.blinkTimer * 0.15) > 0) {
      ctx.fillStyle = "#f00";
      glow(ctx, "#f00", 6);
      ctx.beginPath();
      ctx.arc(-10, -14, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f0";
      glow(ctx, "#0f0", 6);
      ctx.beginPath();
      ctx.arc(-10, 14, 1.5, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    }
    ctx.restore();
  });
}

function drawLasersAndBullets(ctx, game, layout) {
  // Iron Beam lasers
  game.laserBeams.forEach((b) => {
    const alpha = b.life / b.maxLife;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.laser;
    glow(ctx, COL.laser, 15 * layout.effectScale);
    ctx.lineWidth = 3 * layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    glowOff(ctx);
    ctx.globalAlpha = 1;
  });

  // Phalanx bullets
  game.phalanxBullets.forEach((b) => {
    if (b.cx === undefined) return;
    ctx.fillStyle = COL.phalanx;
    ctx.globalAlpha = 0.8;
    const bulletSize = 2 * layout.projectileScale;
    ctx.fillRect(b.cx - bulletSize / 2, b.cy - bulletSize / 2, bulletSize, bulletSize);
    ctx.strokeStyle = "rgba(255,136,68,0.4)";
    ctx.lineWidth = layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function drawMissiles(ctx, game, layout) {
  // Missiles
  game.missiles.forEach((m) => {
    const angle = Math.atan2(m.vy, m.vx);

    if (m.type === "mirv") {
      // MIRV — large imposing ballistic missile
      ctx.save();
      // Thick smoke trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.5;
        const r = (3 + (1 - i / m.trail.length) * 5) * layout.effectScale;
        ctx.fillStyle = `rgba(200,160,120,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      // Hot inner trail
      for (let i = Math.max(0, m.trail.length - 8); i < m.trail.length; i++) {
        const a = ((i - (m.trail.length - 8)) / 8) * 0.7;
        ctx.fillStyle = `rgba(255,180,60,${a})`;
        ctx.beginPath();
        ctx.arc(m.trail[i].x, m.trail[i].y, 2.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);

      // Pulsing red glow
      glow(ctx, "#ff2200", (15 + Math.sin(game.time * 0.2) * 5) * layout.effectScale);

      // Body — large gunmetal
      ctx.fillStyle = "#445060";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(8, -4.5);
      ctx.lineTo(-14, -4.5);
      ctx.lineTo(-14, 4.5);
      ctx.lineTo(8, 4.5);
      ctx.closePath();
      ctx.fill();

      // Red nosecone
      ctx.fillStyle = "#cc2200";
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(14, -4.5);
      ctx.lineTo(14, 4.5);
      ctx.closePath();
      ctx.fill();

      // Stage separation bands (white rings)
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(2, -4.5);
      ctx.lineTo(2, 4.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, -4.5);
      ctx.lineTo(-6, 4.5);
      ctx.stroke();

      // Large fins
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

      // Oversized exhaust
      const mFlameLen = 10 + 8 * pulse(game.time, 0.3, m.x * 0.015 + m.y * 0.02);
      ctx.fillStyle = "#ff6633";
      ctx.beginPath();
      ctx.moveTo(-14, -3.5);
      ctx.lineTo(-14 - mFlameLen, 0);
      ctx.lineTo(-14, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcc66";
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-14 - mFlameLen * 0.5, 0);
      ctx.lineTo(-14, 2);
      ctx.closePath();
      ctx.fill();

      glowOff(ctx);

      // Health bar (only when damaged)
      if (m.health < m.maxHealth) {
        ctx.rotate(-angle); // un-rotate for horizontal health bar
        const barW = 24;
        const barH = 3;
        const ratio = m.health / m.maxHealth;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(-barW / 2, -16, barW, barH);
        ctx.fillStyle = ratio > 0.5 ? "#44ff44" : ratio > 0.25 ? "#ffaa00" : "#ff2222";
        ctx.fillRect(-barW / 2, -16, barW * ratio, barH);
      }

      ctx.restore();
    } else if (m.type === "mirv_warhead") {
      // MIRV warhead — smaller, red-orange, glowing
      ctx.save();
      // Trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.4;
        ctx.fillStyle = `rgba(220,100,50,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);
      // Pulsing glow
      glow(ctx, "#dd4422", (8 + Math.sin(game.time * 0.4) * 3) * layout.effectScale);
      // Body
      ctx.fillStyle = "#dd4422";
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(3, -2);
      ctx.lineTo(-5, -2);
      ctx.lineTo(-5, 2);
      ctx.lineTo(3, 2);
      ctx.closePath();
      ctx.fill();
      // Bright flame
      const wFlameLen = 5 + 4 * pulse(game.time, 0.4, m.x * 0.02 + m.y * 0.025);
      ctx.fillStyle = "#ff8844";
      ctx.beginPath();
      ctx.moveTo(-5, -1.5);
      ctx.lineTo(-5 - wFlameLen, 0);
      ctx.lineTo(-5, 1.5);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
      ctx.restore();
    } else if (m.type === "bomb") {
      // Bomb trail
      ctx.beginPath();
      m.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(255,100,0,${(i / m.trail.length) * 0.6})`;
        ctx.lineWidth = 1.5 * layout.effectScale;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (m.trail.length > 1) ctx.stroke();
      withAnchorScale(ctx, m.x, m.y, layout.enemyScale, () => {
        ctx.fillStyle = "#ff8800";
        glow(ctx, "#ff6600", 8 * layout.effectScale);
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      glowOff(ctx);
    } else {
      // Ballistic missile — pointed warhead with body and exhaust
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(angle);

      // Exhaust smoke trail (drawn in world space via trail points)
      ctx.restore();
      ctx.save();
      // Smoke trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.35;
        const r = (2 + (1 - i / m.trail.length) * 3) * layout.effectScale;
        ctx.fillStyle = `rgba(180,140,100,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      // Hot inner trail
      for (let i = Math.max(0, m.trail.length - 6); i < m.trail.length; i++) {
        const a = ((i - (m.trail.length - 6)) / 6) * 0.6;
        ctx.fillStyle = `rgba(255,200,80,${a})`;
        ctx.beginPath();
        ctx.arc(m.trail[i].x, m.trail[i].y, 1.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);

      // Missile body
      ctx.fillStyle = "#889098";
      ctx.beginPath();
      ctx.moveTo(8, 0); // nose tip
      ctx.lineTo(4, -2.5);
      ctx.lineTo(-6, -2.5);
      ctx.lineTo(-6, 2.5);
      ctx.lineTo(4, 2.5);
      ctx.closePath();
      ctx.fill();

      // Warhead (darker nose cone)
      ctx.fillStyle = "#556070";
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(4, -2.5);
      ctx.lineTo(4, 2.5);
      ctx.closePath();
      ctx.fill();

      // Fins
      ctx.fillStyle = "#667078";
      ctx.beginPath();
      ctx.moveTo(-6, -2.5);
      ctx.lineTo(-9, -6);
      ctx.lineTo(-4, -2.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, 2.5);
      ctx.lineTo(-9, 6);
      ctx.lineTo(-4, 2.5);
      ctx.closePath();
      ctx.fill();

      // Rocket flame
      const flameLen = 5 + 4 * pulse(game.time, 0.45, m.x * 0.018 + m.y * 0.02);
      ctx.fillStyle = "#ff6633";
      glow(ctx, "#ff4400", 10 * layout.effectScale);
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.lineTo(-6 - flameLen, 0);
      ctx.lineTo(-6, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcc66";
      glowOff(ctx);
      ctx.beginPath();
      ctx.moveTo(-6, -1);
      ctx.lineTo(-6 - flameLen * 0.5, 0);
      ctx.lineTo(-6, 1);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);

      ctx.restore();
    }

    if (m.luredByFlare) {
      ctx.strokeStyle = "rgba(255,180,90,0.8)";
      ctx.lineWidth = 1.5 * layout.effectScale;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(m.x, m.y, (8 + Math.sin(game.time * 0.22 + m.x * 0.01) * 1.5) * layout.effectScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
}

function drawDrones(ctx, game, layout) {
  // Drones (Shaheds)
  game.drones.forEach((d) => {
    ctx.save();
    ctx.translate(d.x, d.y);
    const facing = d.vx > 0 ? 1 : -1;
    if (d.subtype === "shahed238" || d.diving) {
      const angle = Math.atan2(d.vy, d.vx);
      ctx.rotate(angle);
    } else {
      ctx.scale(facing, 1);
    }
    ctx.scale(layout.enemyScale, layout.enemyScale);

    if (d.subtype === "shahed238") {
      // Jet Shahed-238 — sleek delta wing, larger
      ctx.fillStyle = "#4a4a5a";
      // Fuselage
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -3);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-10, 3);
      ctx.closePath();
      ctx.fill();
      // Delta wings
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
      // Jet exhaust
      const exLen = 7 + 5 * pulse(game.time, 0.55, d.x * 0.02 + d.y * 0.03);
      ctx.fillStyle = "#ff6600";
      glow(ctx, "#ff4400", 12 * layout.effectScale);
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-14 - exLen, 0);
      ctx.lineTo(-14, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcc44";
      glowOff(ctx);
      ctx.beginPath();
      ctx.moveTo(-14, -1);
      ctx.lineTo(-14 - exLen * 0.5, 0);
      ctx.lineTo(-14, 1);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
      // Dive warning indicator
      if (d.diving) {
        ctx.strokeStyle = "#ff2200";
        ctx.globalAlpha = 0.5 + Math.sin(game.time * 0.3) * 0.3;
        ctx.lineWidth = layout.effectScale;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      // Prop Shahed-136 — stubby delta with pusher prop
      ctx.fillStyle = "#555566";
      // Fuselage
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -2.5);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-8, 2.5);
      ctx.closePath();
      ctx.fill();
      // Short delta wings
      ctx.fillStyle = "#444455";
      ctx.beginPath();
      ctx.moveTo(2, -2);
      ctx.lineTo(-6, -10);
      ctx.lineTo(-8, -2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 2);
      ctx.lineTo(-6, 10);
      ctx.lineTo(-8, 2);
      ctx.closePath();
      ctx.fill();
      // Pusher propeller (rear, side-view — vertical disc with foreshortened wobble)
      const pa = game.time * 0.8;
      const wobble = Math.cos(pa) * 0.8;
      ctx.strokeStyle = "#aaa";
      ctx.lineWidth = layout.effectScale * 0.7;
      ctx.beginPath();
      ctx.moveTo(-10 + wobble, -3);
      ctx.lineTo(-10 - wobble, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10 - wobble, -2.5);
      ctx.lineTo(-10 + wobble, 2.5);
      ctx.stroke();
    }

    // Blinking nav light
    if (Math.sin(game.time * 0.15) > 0) {
      ctx.fillStyle = d.subtype === "shahed238" ? "#ff2200" : "#ff4400";
      glow(ctx, ctx.fillStyle, 2 * layout.effectScale);
      ctx.beginPath();
      ctx.arc(0, 0, 0.75 * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    }
    ctx.restore();
  });
}

function drawInterceptors(ctx, game, layout) {
  // Interceptors (player green, F-15 blue-white)
  game.interceptors.forEach((ic) => {
    const isF15 = ic.fromF15;
    if (isF15) {
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(150,200,255,${(i / ic.trail.length) * 0.6})`;
        ctx.lineWidth = 1.5 * layout.effectScale;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (ic.trail.length > 1) ctx.stroke();
      withAnchorScale(ctx, ic.x, ic.y, layout.projectileScale, () => {
        ctx.fillStyle = "#aaccff";
        glow(ctx, "#6699ff", 6 * layout.effectScale);
        ctx.beginPath();
        ctx.arc(ic.x, ic.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
      glowOff(ctx);
      return;
    }

    ic.trail.forEach((t, i) => {
      const alpha = (i / Math.max(1, ic.trail.length)) * 0.42;
      const radius = (1.3 + (i / Math.max(1, ic.trail.length)) * 2.6) * layout.effectScale;
      ctx.fillStyle = `rgba(120,255,210,${alpha})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const heading =
      typeof ic.heading === "number"
        ? ic.heading
        : ic.trail.length >= 1
          ? Math.atan2(ic.y - ic.trail[ic.trail.length - 1].y, ic.x - ic.trail[ic.trail.length - 1].x)
          : -Math.PI / 2;

    ctx.save();
    ctx.translate(ic.x, ic.y);
    ctx.rotate(heading + Math.PI / 2);
    ctx.scale(layout.projectileScale, layout.projectileScale);

    const plume = 5.5 + 2.5 * pulse(game.time, 0.55, ic.x * 0.025 + ic.y * 0.02);
    ctx.fillStyle = "rgba(68,255,170,0.32)";
    ctx.beginPath();
    ctx.moveTo(-2.6, 8);
    ctx.lineTo(0, 8 + plume + 2);
    ctx.lineTo(2.6, 8);
    ctx.closePath();
    ctx.fill();

    glow(ctx, COL.interceptor, 10 * layout.effectScale);
    ctx.fillStyle = COL.interceptor;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(4.2, 4.5);
    ctx.lineTo(1.5, 3);
    ctx.lineTo(1.5, 8);
    ctx.lineTo(-1.5, 8);
    ctx.lineTo(-1.5, 3);
    ctx.lineTo(-4.2, 4.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#dffff8";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(1.8, -5);
    ctx.lineTo(-1.8, -5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#144a42";
    ctx.fillRect(-0.9, -3, 1.8, 5.5);

    ctx.fillStyle = "#ffde7a";
    ctx.beginPath();
    ctx.moveTo(-1.6, 8);
    ctx.lineTo(0, 8 + plume);
    ctx.lineTo(1.6, 8);
    ctx.closePath();
    ctx.fill();
    glowOff(ctx);
    ctx.restore();
  });
}

function drawUpgradeProjectiles(ctx, game, layout) {
  // Wild Hornets
  game.hornets.forEach((h) => {
    const heading =
      h.trail.length >= 1 ? Math.atan2(h.y - h.trail[h.trail.length - 1].y, h.x - h.trail[h.trail.length - 1].x) : 0;
    ctx.beginPath();
    h.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(255,204,0,${(i / h.trail.length) * 0.6})`;
      ctx.lineWidth = 1.5 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (h.trail.length > 1) ctx.stroke();
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(heading + Math.PI / 2);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    ctx.fillStyle = COL.hornet;
    glow(ctx, COL.hornet, 8 * layout.effectScale);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,244,160,0.85)";
    ctx.fillRect(-0.8, -4, 1.6, 5);
    ctx.fillStyle = "rgba(255,204,0,0.45)";
    ctx.fillRect(-6, 0, 4, 1.6);
    ctx.fillRect(2, 0, 4, 1.6);
    ctx.restore();
    glowOff(ctx);
  });

  // Roadrunners
  game.roadrunners.forEach((r) => {
    ctx.beginPath();
    r.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(68,170,255,${(i / r.trail.length) * 0.7})`;
      ctx.lineWidth = 2 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (r.trail.length > 1) ctx.stroke();
    ctx.fillStyle = COL.roadrunner;
    glow(ctx, COL.roadrunner, 10 * layout.effectScale);
    ctx.save();
    ctx.translate(r.x, r.y);
    // Rotate to face direction of travel
    let angle = -Math.PI / 2; // default: pointing up (launch phase)
    if (r.trail.length >= 2) {
      const prev = r.trail[r.trail.length - 1];
      angle = Math.atan2(r.y - prev.y, r.x - prev.x) + Math.PI / 2;
    }
    ctx.rotate(angle);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    ctx.fillStyle = "#2c4760";
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#7fd5ff";
    ctx.fillRect(-1.5, -8, 3, 5);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-0.7, -5, 1.4, 2);
    ctx.restore();
    glowOff(ctx);
  });

  // Patriot missiles
  game.patriotMissiles.forEach((p) => {
    ctx.beginPath();
    p.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(136,255,68,${(i / p.trail.length) * 0.7})`;
      ctx.lineWidth = 2.5 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (p.trail.length > 1) ctx.stroke();
    // Rotate to face direction of travel
    let pAngle = -Math.PI / 2;
    if (p.trail.length >= 2) {
      const prev = p.trail[p.trail.length - 1];
      pAngle = Math.atan2(p.y - prev.y, p.x - prev.x) + Math.PI / 2;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pAngle);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    glow(ctx, COL.patriot, 12 * layout.effectScale);
    // Missile body
    ctx.fillStyle = "#2a5a2a";
    ctx.fillRect(-3, -8, 6, 16);
    // Nosecone
    ctx.fillStyle = COL.patriot;
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(0, -13);
    ctx.lineTo(3, -8);
    ctx.fill();
    // Fins
    ctx.fillStyle = "#1a4a1a";
    ctx.fillRect(-5, 5, 2, 4);
    ctx.fillRect(3, 5, 2, 4);
    // Exhaust flame
    ctx.fillStyle = "#ffaa22";
    const flameLen = 5 + 4 * pulse(game.time, 0.5, p.x * 0.02 + p.y * 0.015);
    ctx.beginPath();
    ctx.moveTo(-2, 8);
    ctx.lineTo(0, 8 + flameLen);
    ctx.lineTo(2, 8);
    ctx.fill();
    ctx.restore();
    glowOff(ctx);
  });
}

function drawExplosionsAndParticles(ctx, game, layout) {
  // Explosions
  game.explosions.forEach((ex) => {
    const r = ex.radius * layout.effectScale;
    if (r < 1) return;

    const isInterceptorBlast = ex.playerCaused && !ex.chain;
    if (isInterceptorBlast) {
      // Interceptor detonation — punchy flash + particles, no blob
      const popR = r * 0.35;
      if (ex.alpha > ov("explosion.flashThreshold", 0.85)) {
        const flashT = (ex.alpha - 0.85) / 0.15;
        ctx.globalAlpha = flashT;
        ctx.fillStyle = ex.color;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, popR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = flashT;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, popR * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ex.alpha > 0.2 && ex.alpha <= 0.85) {
        const t = 1 - (ex.alpha - 0.2) / 0.65;
        const emberR = r * 0.15 * (1 - t);
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.fillStyle = ex.color;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, emberR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // All other explosions — gradient fireball
      ctx.globalAlpha = ex.alpha;
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, r);
      const warmStop = ov("explosion.fireballWarmStop", 0.15);
      const colorStop = Math.max(warmStop, ov("explosion.fireballColorStop", 0.4));
      const fadeStop = Math.max(colorStop, ov("explosion.fireballFadeStop", 0.75));
      grad.addColorStop(0, "#fff");
      grad.addColorStop(warmStop, "#ffeeaa");
      grad.addColorStop(colorStop, ex.color);
      grad.addColorStop(fadeStop, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shockwave ring
    if (ex.ringAlpha > 0) {
      const ringR = ex.ringRadius * layout.effectScale;
      ctx.globalAlpha = ex.ringAlpha * ex.alpha;
      ctx.strokeStyle = ex.color;
      ctx.lineWidth = Math.max(1, ov("explosion.ringWidth", 3) * layout.layout.effectScale * ex.ringAlpha);
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // Particles
  game.particles.forEach((p) => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    if (p.type === "debris") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      const w = p.w * layout.layout.effectScale * 1.5;
      const h = p.h * layout.layout.effectScale * 1.5;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.type === "spark") {
      // Bright streak with longer velocity trail
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * layout.layout.effectScale * 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 5, p.y - p.vy * 5);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.7 * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;

  // Explosion light casting — warm glow illuminates surroundings
  if (game.explosions.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    game.explosions.forEach((ex) => {
      if (ex.alpha < 0.15) return;
      const r = ex.radius * layout.effectScale;
      if (r < 5) return;
      const intensity = ex.alpha * ov("explosion.lightIntensity", 0.12);
      const lightR = r * ov("explosion.lightRadiusMul", 4);
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, lightR);
      // Parse explosion color for tinting, fallback to warm orange
      grad.addColorStop(0, `rgba(255, 180, 100, ${intensity})`);
      grad.addColorStop(0.3, `rgba(255, 140, 60, ${intensity * 0.5})`);
      grad.addColorStop(0.7, `rgba(200, 80, 30, ${intensity * 0.15})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(ex.x - lightR, ex.y - lightR, lightR * 2, lightR * 2);
    });
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
}

function drawGroundStructures(ctx, game, layout) {
  // Launchers
  LAUNCHERS.forEach((l, i) => {
    withAnchorScale(ctx, l.x, l.y, layout.launcherScale, () => {
      if (game.launcherHP[i] <= 0) {
        // Destroyed — broken rubble
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.moveTo(l.x - 10, l.y + 3);
        ctx.lineTo(l.x - 8, l.y - 2);
        ctx.lineTo(l.x - 2, l.y - 3);
        ctx.lineTo(l.x + 3, l.y - 1);
        ctx.lineTo(l.x + 9, l.y - 2);
        ctx.lineTo(l.x + 10, l.y + 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#2a2a2a";
        ctx.beginPath();
        ctx.arc(l.x - 3, l.y - 1, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(l.x + 4, l.y, 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const launcherMaxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
      const damaged = launcherMaxHP === 2 && game.launcherHP[i] === 1;

      // Base platform — rounded trapezoid
      ctx.fillStyle = damaged ? "#3a2020" : "#2a3a50";
      ctx.beginPath();
      ctx.moveTo(l.x - 14, l.y + 4);
      ctx.lineTo(l.x - 10, l.y - 6);
      ctx.quadraticCurveTo(l.x, l.y - 9, l.x + 10, l.y - 6);
      ctx.lineTo(l.x + 14, l.y + 4);
      ctx.quadraticCurveTo(l.x, l.y + 6, l.x - 14, l.y + 4);
      ctx.fill();

      // Upper turret housing — rounded dome
      ctx.fillStyle = damaged ? "#4a3030" : "#3a4a60";
      ctx.beginPath();
      ctx.arc(l.x, l.y - 6, 9, Math.PI, 0);
      ctx.lineTo(l.x + 7, l.y - 4);
      ctx.lineTo(l.x - 7, l.y - 4);
      ctx.closePath();
      ctx.fill();

      // Highlight edge
      ctx.strokeStyle = damaged ? "#5a4040" : "#5a6a80";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(l.x, l.y - 6, 9, Math.PI + 0.2, -0.2);
      ctx.stroke();

      // Ammo bar — rounded
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.arc(l.x - 12, l.y + 10.5, 2.5, 0, Math.PI * 2);
      ctx.arc(l.x + 12, l.y + 10.5, 2.5, 0, Math.PI * 2);
      ctx.fillRect(l.x - 12, l.y + 8, 24, 5);
      ctx.fill();
      const ammoMax = getAmmoCapacity(game.wave, game.upgrades.launcherKit);
      const ammoRatio = game.ammo[i] / ammoMax;
      ctx.fillStyle = ammoRatio > 0.3 ? COL.hud : COL.warning;
      const barW = 24 * ammoRatio;
      ctx.beginPath();
      ctx.fillRect(l.x - 12, l.y + 8, barW, 5);
      ctx.fill();

      // Ammo count
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = ammoRatio > 0.3 ? COL.hud : COL.warning;
      ctx.fillText(game.ammo[i], l.x, l.y + 25);

      // HP pips
      const maxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
      for (let h = 0; h < maxHP; h++) {
        ctx.fillStyle = h < game.launcherHP[i] ? "#44ff88" : "#333";
        ctx.beginPath();
        ctx.arc(l.x - 3 + h * 6, l.y + 16.5, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Barrel — tapered with rounded tip
      const angle = Math.atan2(game.crosshairY - l.y, game.crosshairX - l.x);
      ctx.save();
      ctx.translate(l.x, l.y - 8);
      const barrelAngle = Math.min(-0.2, Math.max(angle, -Math.PI + 0.2));
      ctx.rotate(barrelAngle);
      ctx.fillStyle = damaged ? "#5a3a3a" : "#4a5a70";
      ctx.beginPath();
      ctx.moveTo(0, -2.5);
      ctx.lineTo(16, -1.5);
      ctx.quadraticCurveTo(19, 0, 16, 1.5);
      ctx.lineTo(0, 2.5);
      ctx.closePath();
      ctx.fill();
      // Barrel highlight
      ctx.strokeStyle = damaged ? "#6a4a4a" : "#6a7a90";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(1, -2.2);
      ctx.lineTo(15, -1.3);
      ctx.stroke();

      // Muzzle flash
      const fireTick = game.launcherFireTick ? game.launcherFireTick[i] : 0;
      const tickNow = game._replayTick || 0;
      const fireAge = tickNow - fireTick;
      if (fireAge < 6) {
        const flash = 1 - fireAge / 6;
        ctx.globalAlpha = flash * 0.9;
        ctx.fillStyle = "#ffdd44";
        ctx.beginPath();
        ctx.arc(20, 0, 5 + flash * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(20, 0, 2 + flash * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    });
  });

  // Phalanx turrets
  if (game.upgrades.phalanx > 0) {
    const turrets = getPhalanxTurrets(game.upgrades.phalanx);
    turrets.forEach((t) => {
      ctx.fillStyle = "#556677";
      ctx.fillRect(t.x - 6, t.y, 12, 10);
      ctx.fillStyle = "#778899";
      ctx.fillRect(t.x - 4, t.y - 6, 8, 8);
      ctx.save();
      ctx.translate(t.x, t.y - 4);
      ctx.rotate(game.time * 0.3);
      ctx.fillStyle = "#99aabb";
      ctx.fillRect(-1, -8, 2, 8);
      ctx.restore();
      if (layout.showSystemLabels) {
        ctx.fillStyle = "rgba(255,136,68,0.6)";
        ctx.font = "7px monospace";
        ctx.fillText("CIWS", t.x - 10, t.y + 18);
      }
    });
  }

  // Patriot launcher — TEL vehicle with SAM arm
  if (game.upgrades.patriot > 0) {
    const patX = 334;
    ctx.save();
    ctx.translate(patX, GROUND_Y);
    ctx.scale(2, 2);
    // Truck body
    ctx.fillStyle = "#3a4a30";
    ctx.fillRect(-16, -5, 32, 7);
    // Cab
    ctx.fillStyle = "#4a5a40";
    ctx.fillRect(-16, -9, 8, 5);
    ctx.fillStyle = "#6a8a60";
    ctx.fillRect(-15, -8, 4, 2);
    // Angled launcher arm
    ctx.save();
    ctx.translate(4, -5);
    ctx.rotate(-0.45);
    ctx.fillStyle = "#4a5a3a";
    ctx.fillRect(-3, -16, 6, 14);
    // Missile tubes
    ctx.fillStyle = "#3a4830";
    ctx.fillRect(-2, -16, 2, 6);
    ctx.fillRect(0.5, -16, 2, 6);
    // Missile tips
    ctx.fillStyle = "#88ff44";
    glow(ctx, "#88ff44", 2);
    ctx.fillRect(-1.5, -17, 1.5, 1.5);
    ctx.fillRect(1, -17, 1.5, 1.5);
    glowOff(ctx);
    ctx.restore();
    // Wheels
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(-12, 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-6, 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(8, 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(14, 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(136,255,68,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("PAC-3", patX - 20, GROUND_Y + 10);
    }
  }

  // Wild Hornets — hex hive launcher
  if (game.upgrades.wildHornets > 0) {
    const hx = 206,
      hy = GROUND_Y;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(2, 2);
    const cellR = 5;
    const cells = [
      { x: 0, y: -8 },
      { x: -6, y: -4.5 },
      { x: 6, y: -4.5 },
      { x: -3, y: -1 },
      { x: 3, y: -1 },
    ];
    // Base platform
    ctx.fillStyle = "#2a2a20";
    ctx.fillRect(-14, -1, 28, 4);
    const lvl = game.upgrades.wildHornets;
    const filledCells = [2, 3, 5][lvl - 1];
    cells.forEach((c, i) => {
      ctx.strokeStyle = "#6a6a40";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const angle = (Math.PI / 3) * a - Math.PI / 6;
        const px = c.x + cellR * Math.cos(angle);
        const py = c.y + cellR * Math.sin(angle);
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = i < filledCells ? "#1a1a10" : "#222218";
      ctx.fill();
      ctx.stroke();
      // Drone inside filled cells
      if (i < filledCells) {
        ctx.fillStyle = COL.hornet;
        glow(ctx, COL.hornet, 3);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 2.5);
        ctx.lineTo(c.x + 2, c.y + 1.5);
        ctx.lineTo(c.x, c.y + 0.5);
        ctx.lineTo(c.x - 2, c.y + 1.5);
        ctx.closePath();
        ctx.fill();
        glowOff(ctx);
      }
    });
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(255,204,0,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("HORNETS", hx - 18, hy + 12);
    }
  }

  // Roadrunner launcher — open container with missiles
  if (game.upgrades.roadrunner > 0) {
    const rrX = 678;
    ctx.save();
    ctx.translate(rrX, GROUND_Y);
    ctx.scale(2, 2);
    // Container walls (3 walls, no top)
    ctx.fillStyle = "#1e2e3e";
    ctx.fillRect(-14, -10, 2, 12); // left wall
    ctx.fillRect(12, -10, 2, 12); // right wall
    ctx.fillRect(-14, 0, 28, 2); // bottom
    // Back wall
    ctx.fillStyle = "#162636";
    ctx.fillRect(-12, -10, 24, 2);
    // Missiles inside (count by level)
    const rrCount = Math.min(game.upgrades.roadrunner, 3);
    for (let i = 0; i < rrCount; i++) {
      ctx.fillStyle = "#2c4760";
      ctx.fillRect(-9 + i * 8, -9, 4, 9);
      // Nose cone
      ctx.fillStyle = "#44aaff";
      glow(ctx, "#44aaff", 2);
      ctx.beginPath();
      ctx.moveTo(-7 + i * 8, -12);
      ctx.lineTo(-9 + i * 8, -9);
      ctx.lineTo(-5 + i * 8, -9);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
    }
    // Blue accent stripe
    ctx.fillStyle = "#44aaff";
    ctx.globalAlpha = 0.3;
    ctx.fillRect(-14, -1, 28, 1.5);
    ctx.globalAlpha = 1;
    // Base legs
    ctx.fillStyle = "#2a3a4a";
    ctx.fillRect(-12, 1, 4, 2);
    ctx.fillRect(8, 1, 4, 2);
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(68,170,255,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("ROADRUNNER", rrX - 25, GROUND_Y + 12);
    }
  }

  // Flare launcher — integrated dispensers near top of Burj
  if (game.upgrades.flare > 0) {
    const flareY = GROUND_Y - BURJ_H * 0.97;
    const lvl = game.upgrades.flare;
    const towerHW = 3.5; // approximate half-width at this height

    // Flush-mounted dispenser panels on both sides of the tower
    // Left dispenser
    ctx.fillStyle = "#8a7a68";
    ctx.fillRect(BURJ_X - towerHW - 4, flareY - 4, 4, 8);
    // Dispenser tubes (count by level)
    ctx.fillStyle = "#ff9944";
    const leftTubes = Math.min(lvl, 2);
    for (let i = 0; i < leftTubes; i++) {
      ctx.fillRect(BURJ_X - towerHW - 3.5, flareY - 3 + i * 4, 3, 2);
    }

    // Right dispenser
    ctx.fillStyle = "#8a7a68";
    ctx.fillRect(BURJ_X + towerHW, flareY - 4, 4, 8);
    ctx.fillStyle = "#ff9944";
    const rightTubes = lvl >= 2 ? lvl - 1 : 0;
    for (let i = 0; i < rightTubes; i++) {
      ctx.fillRect(BURJ_X + towerHW + 0.5, flareY - 3 + i * 4, 3, 2);
    }

    // Warm glow when flares are launching
    if (game.flares.some((f) => f.alive && f.life > f.maxLife - 10)) {
      ctx.fillStyle = "rgba(255,160,60,0.35)";
      ctx.beginPath();
      ctx.arc(BURJ_X, flareY, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(255,136,51,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("FLARE", BURJ_X - 15, flareY + 16);
    }
  }

  // EMP emitter — mounted at center of Burj
  if (game.upgrades.emp > 0) {
    const empY = GROUND_Y - BURJ_H * 0.67;
    const lvl = game.upgrades.emp;
    // Mounting ring on Burj
    ctx.strokeStyle = "#7a5a9a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(BURJ_X, empY, 7, 0, Math.PI * 2);
    ctx.stroke();
    // Coil nodes (more at higher levels)
    const nodeCount = lvl + 1;
    ctx.fillStyle = "#8866aa";
    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
      const nx = BURJ_X + Math.cos(angle) * 7;
      const ny = empY + Math.sin(angle) * 7;
      ctx.beginPath();
      ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center core
    ctx.fillStyle = "#6644aa";
    ctx.beginPath();
    ctx.arc(BURJ_X, empY, 3, 0, Math.PI * 2);
    ctx.fill();
    // Charging arcs between nodes
    if (game.empCharge > 0 && game.empChargeMax > 0) {
      const chargeRatio = game.empCharge / game.empChargeMax;
      ctx.strokeStyle = COL.emp;
      ctx.globalAlpha = chargeRatio * 0.7;
      glow(ctx, COL.emp, 6 * chargeRatio);
      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodeCount; i++) {
        const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
        const nx = BURJ_X + Math.cos(angle) * 7;
        const ny = empY + Math.sin(angle) * 7;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        const wobble = Math.sin(game.time * 0.4 + i * 2) * 3 * chargeRatio;
        ctx.quadraticCurveTo(BURJ_X + wobble, empY - wobble, BURJ_X, empY);
        ctx.stroke();
      }
      glowOff(ctx);
      ctx.globalAlpha = 1;
    }
    // Ready pulse
    if (game.empReady) {
      const pulse = 0.3 + 0.5 * Math.sin(game.time * 0.2);
      ctx.fillStyle = COL.emp;
      glow(ctx, COL.emp, 18);
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(BURJ_X, empY, 12, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
      ctx.globalAlpha = 1;
    }
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(204,68,255,0.6)";
      ctx.font = "7px monospace";
      ctx.fillText("EMP", BURJ_X - 8, empY + 20);
    }
  }

  // EMP shockwave rings
  game.empRings.forEach((ring) => {
    if (!ring.alive) return;
    const progress = ring.radius / ring.maxRadius;
    ctx.save();

    // Screen-wide flash at the start
    if (progress < 0.15) {
      const flashAlpha = (1 - progress / 0.15) * 0.25;
      ctx.fillStyle = COL.emp;
      ctx.globalAlpha = flashAlpha;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.globalAlpha = 1;
    }

    // Filled shockwave area — faint violet wash behind the ring
    const washAlpha = ring.alpha * 0.08;
    if (washAlpha > 0.005) {
      const wash = ctx.createRadialGradient(ring.x, ring.y, 0, ring.x, ring.y, ring.radius);
      wash.addColorStop(0, "rgba(204,68,255,0)");
      wash.addColorStop(0.7, "rgba(204,68,255,0)");
      wash.addColorStop(1, `rgba(204,68,255,${washAlpha})`);
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Main thick outer ring with heavy glow
    ctx.globalAlpha = ring.alpha;
    ctx.strokeStyle = COL.emp;
    glow(ctx, COL.emp, 40 + ring.radius * 0.08);
    ctx.lineWidth = 6 + (1 - progress) * 4;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Second ring slightly inside — creates thickness
    ctx.strokeStyle = "#dd88ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, Math.max(0, ring.radius - 8), 0, Math.PI * 2);
    ctx.stroke();

    // White-hot core ring
    ctx.strokeStyle = "#fff";
    glow(ctx, "#fff", 8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
    glowOff(ctx);

    // Electric lightning arcs — more of them, longer, forked
    ctx.globalAlpha = ring.alpha * 0.9;
    const arcCount = 10 + Math.floor(ring.radius * 0.04);
    for (let i = 0; i < arcCount; i++) {
      const angle = (i / arcCount) * Math.PI * 2 + game.time * 0.15 + Math.random() * 0.3;
      const ax = ring.x + Math.cos(angle) * ring.radius;
      const ay = ring.y + Math.sin(angle) * ring.radius;
      const len = 12 + ring.radius * 0.06;
      // Main bolt
      ctx.strokeStyle = Math.random() > 0.3 ? "#dd88ff" : "#fff";
      glow(ctx, "#cc44ff", 6);
      ctx.lineWidth = Math.random() > 0.5 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      const mx = ax + (Math.random() - 0.5) * len;
      const my = ay + (Math.random() - 0.5) * len;
      ctx.lineTo(mx, my);
      // Fork
      const fx = mx + (Math.random() - 0.5) * len * 0.6;
      const fy = my + (Math.random() - 0.5) * len * 0.6;
      ctx.lineTo(fx, fy);
      ctx.stroke();
      // Second fork from midpoint
      if (Math.random() > 0.5) {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + (Math.random() - 0.5) * len * 0.5, my + (Math.random() - 0.5) * len * 0.5);
        ctx.stroke();
      }
      glowOff(ctx);
    }

    // Trailing sparks inside the ring area
    ctx.globalAlpha = ring.alpha * 0.4;
    for (let i = 0; i < 12; i++) {
      const sa = Math.random() * Math.PI * 2;
      const sr = ring.radius * (0.6 + Math.random() * 0.35);
      const sx = ring.x + Math.cos(sa) * sr;
      const sy = ring.y + Math.sin(sa) * sr;
      ctx.fillStyle = Math.random() > 0.5 ? "#cc44ff" : "#aa66ff";
      ctx.fillRect(sx, sy, 2, 2);
    }

    ctx.restore();
  });

  // Defense sites — destroyed rubble or alive glow
  game.defenseSites.forEach((site) => {
    if (!site.alive) {
      // Rubble
      ctx.fillStyle = "#333";
      ctx.fillRect(site.x - site.hw * 0.6, site.y - 3, site.hw * 1.2, 6);
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(site.x - site.hw * 0.3, site.y - 5, site.hw * 0.4, 4);
      ctx.fillRect(site.x + 2, site.y - 4, site.hw * 0.3, 3);
      ctx.fillStyle = "rgba(255,60,0,0.15)";
      ctx.fillRect(site.x - site.hw * 0.6, site.y - 5, site.hw * 1.2, 8);
    } else {
      // Subtle targeting indicator glow
      const def = UPGRADES[site.key];
      const pulse = 0.2 + 0.15 * Math.sin(game.time * 0.06);
      ctx.strokeStyle = def ? def.color : "#44ffaa";
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1;
      ctx.strokeRect(site.x - site.hw, site.y - site.hh, site.hw * 2, site.hh * 2);
      ctx.globalAlpha = 1;
    }
  });
}

function drawHUD(ctx, game, layout) {
  // Vignette and CRT-style glass finish
  const vignette = ctx.createRadialGradient(
    CANVAS_W / 2,
    layout.renderHeight * 0.45,
    180,
    CANVAS_W / 2,
    layout.renderHeight * 0.45,
    620,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.08)");
  vignette.addColorStop(1, `rgba(2,4,12,${ov("sky.vignetteAlpha", 0.42)})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_W, layout.renderHeight);
  ctx.fillStyle = "rgba(140, 220, 255, 0.035)";
  ctx.fillRect(0, 0, CANVAS_W, 1);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < layout.renderHeight; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);

  // HUD
  if (layout.showTopHud) {
    ctx.fillStyle = "rgba(0,10,20,0.7)";
    ctx.fillRect(0, 0, CANVAS_W, 36);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 36);
    ctx.lineTo(CANVAS_W, 36);
    ctx.stroke();
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.fillStyle = COL.gold;
    ctx.fillText(`$ ${game.score}`, 15, 23);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`WAVE ${game.wave}`, 130, 23);
    ctx.fillStyle = game.burjAlive ? "#44ff88" : "#ff4444";
    ctx.fillText(`BURJ:${game.burjAlive ? "OK" : "XX"}`, 240, 23);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`AMMO ${game.ammo[0]}|${game.ammo[1]}|${game.ammo[2]}`, 360, 23);
    if (game.empChargeMax > 0) {
      const empCx = 530;
      const empCy = 18;
      const empR = 8;
      const chargeRatio = game.empChargeMax > 0 ? game.empCharge / game.empChargeMax : 0;
      ctx.strokeStyle = "rgba(204,68,255,0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(empCx, empCy, empR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COL.emp;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(empCx, empCy, empR, -Math.PI / 2, -Math.PI / 2 + chargeRatio * Math.PI * 2);
      ctx.stroke();
      if (game.empReady) {
        const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.2);
        glow(ctx, COL.emp, 10);
        ctx.fillStyle = COL.emp;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(empCx, empCy, empR, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 7px 'Courier New', monospace";
        ctx.fillText("SPC", empCx - 8, empCy + 3);
        ctx.font = "bold 12px 'Courier New', monospace";
      } else {
        ctx.fillStyle = COL.emp;
        ctx.font = "7px 'Courier New', monospace";
        ctx.fillText("\uD83C\uDF00", empCx - 5, empCy + 4);
        ctx.font = "bold 12px 'Courier New', monospace";
      }
    }
    if (game._replay) {
      ctx.fillStyle = "#ff8844";
      ctx.fillText("REPLAY", 520, 23);
    }
    if (game._fpsDisplay) {
      ctx.fillStyle = game._fpsDisplay >= 50 ? "#556677" : game._fpsDisplay >= 30 ? "#ffaa44" : "#ff4444";
      ctx.font = "10px 'Courier New', monospace";
      ctx.fillText(`${game._fpsDisplay} FPS`, CANVAS_W - 60, 23);
      ctx.font = "bold 12px 'Courier New', monospace";
    }
  }

  // MIRV INCOMING warning
  const activeMirvs = game.missiles.filter((m) => m.alive && m.type === "mirv");
  if (activeMirvs.length > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.15);
    ctx.save();
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.font = `bold ${layout.mirvWarningFontSize}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff2200";
    glow(ctx, "#ff2200", 8 + pulse * 6);
    ctx.fillText("\u26A0 MIRV INCOMING \u26A0", CANVAS_W / 2, layout.mirvWarningY);
    glow(ctx, "transparent", 0);
    ctx.restore();
  }

  // Purchase toast (replay mode)
  if (game._purchaseToast && game._purchaseToast.timer > 0) {
    const toast = game._purchaseToast;
    const alpha = Math.min(1, toast.timer / 30); // fade out last ~0.5s (30 ticks)
    const items = toast.items.map((key) => UPGRADES[key]?.name || key);
    // Deduplicate and count
    const counts = {};
    items.forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
    const label = Object.entries(counts)
      .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
      .join(", ");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${layout.purchaseToastFontSize}px 'Courier New', monospace`;
    ctx.fillStyle = "#44ffaa";
    ctx.textAlign = "center";
    const who = game._replayIsHuman ? "PLAYER" : "BOT";
    ctx.fillText(`${who} BOUGHT: ${label}`, CANVAS_W / 2, layout.purchaseToastY);
    ctx.restore();
    ctx.textAlign = "left";
    toast.timer -= 1; // 1 tick per render frame (matched to fixed timestep)
  }

  // Wave progress bar
  if (layout.showTopHud) {
    const wpX = 650,
      wpW = 120,
      wpH = 8,
      wpY = 14;
    const scheduleLen = game.schedule ? game.schedule.length : 1;
    const waveProgress = Math.min(game.scheduleIdx / scheduleLen, 1);
    const threatsLeft = game.missiles.length + game.drones.length;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = waveProgress >= 1 ? "#44ff88" : COL.hud;
    ctx.fillRect(wpX, wpY, wpW * waveProgress, wpH);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.strokeRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = "#aabbcc";
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(
      waveProgress >= 1 ? `CLEAR ${threatsLeft}` : `${game.scheduleIdx}/${scheduleLen}`,
      wpX + wpW + 6,
      wpY + 7,
    );
    ctx.font = "bold 12px 'Courier New', monospace";

    const activeUpgrades = Object.entries(game.upgrades).filter(([, value]) => value > 0);
    if (activeUpgrades.length > 0) {
      let ux = 640;
      activeUpgrades.forEach(([key, level]) => {
        const def = UPGRADES[key];
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.9;
        ctx.font = "11px monospace";
        ctx.fillText(`${def.icon}${level}`, ux, 23);
        ux += 38;
      });
      ctx.globalAlpha = 1;
    }
  }

  // Low ammo warning — flash for 3 seconds then disappear
  const totalAmmo = game.ammo.reduce((s, a) => s + a, 0);
  const maxTotalAmmo = game.ammo.reduce(
    (s, _, i) => s + (game.launcherHP[i] > 0 ? getAmmoCapacity(game.wave, game.upgrades.launcherKit) : 0),
    0,
  );
  const isLowAmmo = maxTotalAmmo > 0 && totalAmmo / maxTotalAmmo < 0.25 && !game.waveComplete;
  if (isLowAmmo && !game._lowAmmoTimer) {
    game._lowAmmoTimer = 180; // ~3 seconds at 60fps
  }
  if (!isLowAmmo) {
    game._lowAmmoTimer = 0;
  }
  if (game._lowAmmoTimer > 0) {
    game._lowAmmoTimer -= 1;
    const flash = 0.5 + 0.5 * Math.sin(game.time * 0.2);
    const fadeOut = Math.min(1, game._lowAmmoTimer / 30);
    ctx.save();
    ctx.globalAlpha = flash * 0.9 * fadeOut;
    ctx.textAlign = "center";
    ctx.font = `bold ${layout.lowAmmoFontSize}px 'Courier New', monospace`;
    ctx.fillStyle = COL.warning;
    glow(ctx, COL.warning, 20);
    ctx.fillText("\u26A0 LOW AMMO \u26A0", CANVAS_W / 2, layout.lowAmmoY);
    glowOff(ctx);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // Multi-kill toast
  if (game.multiKillToast && game.multiKillToast.timer > 0) {
    const mk = game.multiKillToast;
    const fadeOut = Math.min(1, mk.timer / 20);
    const rise = (90 - mk.timer) * 0.5;
    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.textAlign = "center";
    ctx.font = `bold ${layout.multiKillLabelSize}px 'Courier New', monospace`;
    const labelColor = mk.label === "MEGA KILL" ? "#ff4444" : mk.label === "TRIPLE KILL" ? "#ffaa00" : "#ffdd00";
    ctx.fillStyle = labelColor;
    glow(ctx, labelColor, 15);
    ctx.fillText(mk.label, mk.x, mk.y - 30 - rise);
    ctx.font = `bold ${layout.multiKillBonusSize}px 'Courier New', monospace`;
    ctx.fillStyle = "#00ffcc";
    ctx.fillText(`+${mk.bonus}`, mk.x, mk.y - 10 - rise);
    glowOff(ctx);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // Wave cleared banner
  if (game.waveComplete && game.waveClearedTimer > 0) {
    const alpha = Math.min(1, game.waveClearedTimer / 20);
    const bannerCX = CANVAS_W / 2;
    const bannerCY = layout.waveClearedY - 14;
    const bannerW = 420;
    const bannerH = 70;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,20,10,0.65)";
    ctx.fillRect(bannerCX - bannerW / 2, bannerCY - bannerH / 2, bannerW, bannerH);
    ctx.strokeStyle = COL.hud;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bannerCX - bannerW / 2, bannerCY - bannerH / 2, bannerW, bannerH);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 32px 'Courier New', monospace";
    ctx.fillStyle = COL.hud;
    ctx.fillText(`WAVE ${game.wave} CLEARED`, bannerCX, bannerCY);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
}

export function drawGame(ctx, game, { showShop = false, layoutProfile = {} } = {}) {
  const layout = resolveLayoutProfile(layoutProfile);
  let sx = 0,
    sy = 0;
  if (game.shakeTimer > 0 && !game._debugMode) {
    sx = (Math.random() - 0.5) * game.shakeIntensity * 2;
    sy = (Math.random() - 0.5) * game.shakeIntensity * 2;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.save();
  if (layout.cameraFrame?.scale > 1) {
    ctx.scale(layout.cameraFrame.scale, layout.cameraFrame.scale);
    ctx.translate(-layout.cameraFrame.left, -layout.cameraFrame.top);
  }

  drawSky(ctx, game, layout);
  drawDecoyFlares(ctx, game, layout);
  drawGroundAndBuildings(ctx, game, layout);
  drawBurjKhalifa(ctx, game, layout);
  drawPlanes(ctx, game, layout);
  drawLasersAndBullets(ctx, game, layout);
  drawMissiles(ctx, game, layout);
  drawDrones(ctx, game, layout);
  drawInterceptors(ctx, game, layout);
  drawUpgradeProjectiles(ctx, game, layout);
  drawExplosionsAndParticles(ctx, game, layout);
  drawGroundStructures(ctx, game, layout);

  // Crosshair
  if (!showShop) {
    const cx = game.crosshairX,
      cy = game.crosshairY;
    ctx.fillStyle = "rgba(0,255,200,0.08)";
    ctx.beginPath();
    ctx.arc(cx, cy, layout.crosshairFillRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,200,0.7)";
    ctx.lineWidth = 1;
    glow(ctx, COL.hud, 10);
    ctx.beginPath();
    ctx.arc(cx, cy, layout.crosshairInnerRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - layout.crosshairArmLength, cy);
    ctx.lineTo(cx - layout.crosshairGap, cy);
    ctx.moveTo(cx + layout.crosshairGap, cy);
    ctx.lineTo(cx + layout.crosshairArmLength, cy);
    ctx.moveTo(cx, cy - layout.crosshairArmLength);
    ctx.lineTo(cx, cy - layout.crosshairGap);
    ctx.moveTo(cx, cy + layout.crosshairGap);
    ctx.lineTo(cx, cy + layout.crosshairArmLength);
    ctx.stroke();
    glowOff(ctx);
  }

  // Debug collision overlay — drawn inside camera transform
  if (game._showColliders) {
    drawCollisionOverlay(ctx, game);
  }

  // Upgrade range overlay — editor mode
  if (game._showUpgradeRanges) {
    drawUpgradeRangeOverlay(ctx, game);
  }

  ctx.restore();
  ctx.restore();

  drawHUD(ctx, game, layout);
}

function drawUpgradeRangeOverlay(ctx) {
  ctx.save();

  const phalanxRange = ov("upgrade.phalanxRange", 160);
  const systems = [
    {
      key: "upgrade.ironBeam",
      name: "IRON BEAM",
      x: ov("upgrade.ironBeam.x", BURJ_X),
      y: ov("upgrade.ironBeam.y", 959),
      color: "#ff2200",
      range: ov("upgrade.ironBeamRange", 294),
    },
    {
      key: "upgrade.phalanx1",
      name: "PHALANX",
      x: ov("upgrade.phalanx1.x", 553),
      y: ov("upgrade.phalanx1.y", 1498),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.phalanx2",
      name: "PHALANX",
      x: ov("upgrade.phalanx2.x", 860),
      y: ov("upgrade.phalanx2.y", 1504),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.phalanx3",
      name: "PHALANX",
      x: ov("upgrade.phalanx3.x", 59),
      y: ov("upgrade.phalanx3.y", GROUND_Y - 30),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.patriot",
      name: "PATRIOT",
      x: ov("upgrade.patriot.x", 334),
      y: ov("upgrade.patriot.y", 1511),
      color: "#88ff44",
    },
    {
      key: "upgrade.emp",
      name: "EMP",
      x: ov("upgrade.emp.x", 462),
      y: ov("upgrade.emp.y", 1047),
      color: "#cc44ff",
      range: ov("upgrade.empRange", 550),
    },
    {
      key: "upgrade.flares",
      name: "FLARES",
      x: ov("upgrade.flares.x", BURJ_X),
      y: ov("upgrade.flares.y", 837),
      color: "#ff8833",
      range: ov("upgrade.flareDetectRange", 320),
      rangeY: GROUND_Y - BURJ_H * 0.35,
    },
    {
      key: "upgrade.hornets",
      name: "HORNETS",
      x: ov("upgrade.hornets.x", 206),
      y: ov("upgrade.hornets.y", 1511),
      color: "#ffcc00",
    },
    {
      key: "upgrade.roadrunner",
      name: "ROADRUNNER",
      x: ov("upgrade.roadrunner.x", 678),
      y: ov("upgrade.roadrunner.y", GROUND_Y - 15),
      color: "#44aaff",
    },
    {
      key: "upgrade.launcherKit",
      name: "LAUNCHER KIT",
      x: ov("upgrade.launcherKit.x", 772),
      y: ov("upgrade.launcherKit.y", 1513),
      color: "#66aaff",
    },
  ];

  for (const sys of systems) {
    // Range area
    if (sys.range) {
      const ry = sys.rangeY ?? sys.y;
      ctx.fillStyle = sys.color;
      ctx.globalAlpha = 0.06;
      ctx.beginPath();
      ctx.arc(sys.x, ry, sys.range, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = sys.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(sys.x, ry, sys.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Position marker
    ctx.strokeStyle = sys.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sys.x, sys.y, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = sys.color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(sys.x, sys.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.globalAlpha = 1;
    ctx.font = "bold 16px monospace";
    const tx = sys.x + 26;
    const ty = sys.y + 6;
    const tw = ctx.measureText(sys.name).width;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(tx - 3, ty - 15, tw + 6, 20);
    ctx.fillStyle = sys.color;
    ctx.fillText(sys.name, tx, ty);
  }

  // Launchers
  const launchers = [
    { x: 60, y: GROUND_Y - 5 },
    { x: 550, y: GROUND_Y - 5 },
    { x: 860, y: GROUND_Y - 5 },
  ];
  launchers.forEach((l, i) => {
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(l.x + 22, l.y - 11, 32, 20);
    ctx.fillStyle = "#00ffcc";
    ctx.fillText(`L${i + 1}`, l.x + 25, l.y + 6);
  });

  ctx.restore();
}

function drawCollisionOverlay(ctx, game) {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;

  // Burj — tapered polygon matching hitbox: max(25, burjHalfW(y) * 3)
  if (game.burjAlive) {
    ctx.strokeStyle = "cyan";
    ctx.beginPath();
    const yTop = GROUND_Y - BURJ_H - 30;
    const yBot = GROUND_Y;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const y = yTop + (i / steps) * (yBot - yTop);
      const hw = Math.max(25, burjHalfW(y) * 3);
      if (i === 0) ctx.moveTo(BURJ_X + hw, y);
      else ctx.lineTo(BURJ_X + hw, y);
    }
    for (let i = steps; i >= 0; i--) {
      const y = yTop + (i / steps) * (yBot - yTop);
      const hw = Math.max(25, burjHalfW(y) * 3);
      ctx.lineTo(BURJ_X - hw, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Launchers
  ctx.strokeStyle = "lime";
  LAUNCHERS.forEach((l, i) => {
    if (game.launcherHP[i] > 0) {
      ctx.strokeRect(l.x - 15, l.y - 12, 30, 12);
    }
  });

  // Buildings
  ctx.strokeStyle = "yellow";
  game.buildings.forEach((b) => {
    if (b.alive) {
      ctx.strokeRect(b.x, GROUND_Y - b.h, b.w, b.h);
    }
  });

  // Defense sites
  ctx.strokeStyle = "magenta";
  game.defenseSites.forEach((site) => {
    if (site.alive) {
      ctx.strokeRect(site.x - site.hw, site.y - site.hh, site.hw * 2, site.hh * 2);
    }
  });

  // Missiles & bombs
  ctx.strokeStyle = "red";
  game.missiles.forEach((m) => {
    if (!m.alive) return;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Drones
  ctx.strokeStyle = "orange";
  game.drones.forEach((d) => {
    if (!d.alive) return;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Interceptors — proximity fuse radius
  ctx.strokeStyle = "#44ffaa";
  game.interceptors.forEach((ic) => {
    if (!ic.alive) return;
    ctx.beginPath();
    ctx.arc(ic.x, ic.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Explosions — current radius
  ctx.strokeStyle = "white";
  game.explosions.forEach((ex) => {
    if (ex.alpha < 0.05) return;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.restore();
}

export function drawTitle(ctx, { layoutProfile = {} } = {}) {
  const layout = resolveLayoutProfile(layoutProfile);
  const t = performance.now() / 1000;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  skyGrad.addColorStop(0, "#050810");
  skyGrad.addColorStop(0.5, "#0a1030");
  skyGrad.addColorStop(1, "#151030");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "rgba(0,255,200,0.02)";
  for (let y = 0; y < CANVAS_H; y += 3) ctx.fillRect(0, y + ((t * 20) % 3), CANVAS_W, 1);
  ctx.textAlign = "center";
  // Burj silhouette
  ctx.fillStyle = "rgba(0,255,200,0.08)";
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2, 280);
  ctx.lineTo(CANVAS_W / 2 - 3, 320);
  ctx.lineTo(CANVAS_W / 2 - 8, 380);
  ctx.lineTo(CANVAS_W / 2 - 12, 480);
  ctx.lineTo(CANVAS_W / 2 + 12, 480);
  ctx.lineTo(CANVAS_W / 2 + 8, 380);
  ctx.lineTo(CANVAS_W / 2 + 3, 320);
  ctx.closePath();
  ctx.fill();

  if (!layout.externalTitle) {
    ctx.fillStyle = COL.hud;
    glow(ctx, COL.hud, 20);
    ctx.font = "bold 48px 'Courier New', monospace";
    ctx.fillText("DUBAI", CANVAS_W / 2, 160);
    ctx.font = "bold 36px 'Courier New', monospace";
    ctx.fillText("MISSILE COMMAND", CANVAS_W / 2, 210);
    glowOff(ctx);
    ctx.fillStyle = "#ff6644";
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillText("DEFEND THE CITY  ★  PROTECT THE SKIES", CANVAS_W / 2, 250);
    ctx.fillStyle = "#8899aa";
    ctx.font = "13px 'Courier New', monospace";
    ctx.fillText("CLICK TO LAUNCH INTERCEPTORS", CANVAS_W / 2, 360);
    ctx.fillText("DESTROY MISSILES & DRONES", CANVAS_W / 2, 380);
    ctx.fillText("EARN SCORE TO BUY AUTOMATED DEFENSES", CANVAS_W / 2, 400);
    ctx.fillText("PROTECT BURJ KHALIFA", CANVAS_W / 2, 420);
    ctx.fillStyle = "#556677";
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillText(
      "🐝 Hornets 🦅 Roadrunner 🎆 Flares ⚡ Beam 🔫 Phalanx 🚀 Patriot 🛡️ Launcher 🔧 Repair 🌀 EMP",
      CANVAS_W / 2,
      460,
    );
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText("[ CLICK TO START ]", CANVAS_W / 2, 520);
  } else {
    const pulse = 0.3 + 0.2 * Math.sin(t * 2.4);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.beginPath();
    ctx.arc(CANVAS_W / 2, 500, 72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText("TACTICAL FEED", CANVAS_W / 2, 560);
  }
  ctx.textAlign = "left";
}

export function drawTitleModeToggle(ctx, draftMode, hoverMode) {
  const y = 490;
  const normalX = CANVAS_W / 2 - 90;
  const draftX = CANVAS_W / 2 + 90;

  ctx.textAlign = "center";
  ctx.font = "bold 11px 'Courier New', monospace";

  // NORMAL button
  const normalActive = !draftMode;
  ctx.fillStyle = normalActive ? COL.hud : hoverMode === "normal" ? "rgba(0,255,200,0.5)" : "#556677";
  ctx.fillText("[ NORMAL ]", normalX, y);
  if (normalActive) {
    ctx.fillStyle = "rgba(0,255,200,0.15)";
    ctx.fillRect(normalX - 45, y - 12, 90, 16);
  }

  // DRAFT button
  const draftActive = draftMode;
  ctx.fillStyle = draftActive ? "#ff8844" : hoverMode === "draft" ? "rgba(255,136,68,0.5)" : "#556677";
  ctx.fillText("[ DRAFT ]", draftX, y);
  if (draftActive) {
    ctx.fillStyle = "rgba(255,136,68,0.15)";
    ctx.fillRect(draftX - 45, y - 12, 90, 16);
  }

  // Description
  ctx.font = "10px 'Courier New', monospace";
  ctx.fillStyle = "#445566";
  if (draftMode) {
    ctx.fillText("3 random upgrades offered — pick 1 free each wave", CANVAS_W / 2, y + 16);
  } else {
    ctx.fillText("Buy any upgrade with earned score", CANVAS_W / 2, y + 16);
  }

  ctx.textAlign = "left";
}

export function drawGameOver(ctx, finalScore, finalWave, finalStats, { layoutProfile = {} } = {}) {
  const layout = resolveLayoutProfile(layoutProfile);
  const t = performance.now() / 1000;
  ctx.fillStyle = "#080008";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Animated embers / ash
  for (let i = 0; i < 300; i++) {
    const px = (Math.sin(i * 73.1 + t * 0.3) * 0.5 + 0.5) * CANVAS_W;
    const py = (i * 37.7 + t * 20) % CANVAS_H;
    ctx.fillStyle = `rgba(255,${50 + (i % 60)},0,${0.03 + Math.sin(i + t) * 0.02})`;
    ctx.fillRect(px, py, 2, 2);
  }
  // Ruined Burj silhouette
  ctx.fillStyle = "rgba(60,20,10,0.4)";
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 12, 500);
  ctx.lineTo(CANVAS_W / 2 - 8, 400);
  ctx.lineTo(CANVAS_W / 2 - 5, 360);
  ctx.lineTo(CANVAS_W / 2 - 3, 340);
  ctx.lineTo(CANVAS_W / 2 + 2, 350);
  ctx.lineTo(CANVAS_W / 2 + 6, 380);
  ctx.lineTo(CANVAS_W / 2 + 10, 420);
  ctx.lineTo(CANVAS_W / 2 + 12, 500);
  ctx.closePath();
  ctx.fill();
  // Smoke wisps
  for (let i = 0; i < 5; i++) {
    const sx = CANVAS_W / 2 + Math.sin(t + i * 1.3) * 15;
    const sy = 330 - i * 20 - ((t * 8) % 40);
    ctx.globalAlpha = 0.1 - i * 0.015;
    ctx.fillStyle = "#442222";
    ctx.beginPath();
    ctx.arc(sx, sy, 8 + i * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Title
  ctx.textAlign = "center";
  ctx.fillStyle = COL.warning;
  glow(ctx, "#ff0000", 30);
  ctx.font = "bold 48px 'Courier New', monospace";
  ctx.fillText("CITY FALLEN", CANVAS_W / 2, 140);
  glowOff(ctx);
  if (layout.externalGameOver) {
    ctx.strokeStyle = "rgba(255,60,60,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 190, 170);
    ctx.lineTo(CANVAS_W / 2 + 190, 170);
    ctx.stroke();
    ctx.fillStyle = "#7d6670";
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillText("THE DEFENSE NET HAS COLLAPSED", CANVAS_W / 2, 214);
    ctx.textAlign = "left";
    return;
  }
  // Divider line
  ctx.strokeStyle = "rgba(255,60,60,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 150, 160);
  ctx.lineTo(CANVAS_W / 2 + 150, 160);
  ctx.stroke();
  // Stats
  ctx.fillStyle = "#887766";
  ctx.font = "13px 'Courier New', monospace";
  ctx.fillText("AFTER ACTION REPORT", CANVAS_W / 2, 195);
  ctx.fillStyle = "#ccbbaa";
  ctx.font = "20px 'Courier New', monospace";
  ctx.fillText(`SCORE: ${finalScore}`, CANVAS_W / 2, 240);
  ctx.fillStyle = "#aa9988";
  ctx.font = "16px 'Courier New', monospace";
  ctx.fillText(`WAVES SURVIVED: ${finalWave}`, CANVAS_W / 2, 275);
  // Rating
  let rating, ratingColor;
  if (finalWave >= 10) {
    rating = "LEGENDARY COMMANDER";
    ratingColor = COL.gold;
  } else if (finalWave >= 7) {
    rating = "VETERAN DEFENDER";
    ratingColor = "#44ffaa";
  } else if (finalWave >= 4) {
    rating = "CAPABLE OFFICER";
    ratingColor = "#88aacc";
  } else {
    rating = "CADET";
    ratingColor = "#886655";
  }
  ctx.fillStyle = ratingColor;
  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.fillText(rating, CANVAS_W / 2, 310);
  // Combat stats
  ctx.strokeStyle = "rgba(255,60,60,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 120, 330);
  ctx.lineTo(CANVAS_W / 2 + 120, 330);
  ctx.stroke();
  ctx.fillStyle = "#887766";
  ctx.font = "11px 'Courier New', monospace";
  ctx.fillText("COMBAT RECORD", CANVAS_W / 2, 352);
  ctx.fillStyle = "#aa9988";
  ctx.font = "14px 'Courier New', monospace";
  ctx.fillText(`MISSILES DESTROYED: ${finalStats.missileKills}`, CANVAS_W / 2, 378);
  ctx.fillText(`DRONES KILLED: ${finalStats.droneKills}`, CANVAS_W / 2, 400);
  ctx.fillText(`SHOTS FIRED: ${finalStats.shotsFired}`, CANVAS_W / 2, 422);
  const totalKills = finalStats.missileKills + finalStats.droneKills;
  const hitRatio = finalStats.shotsFired > 0 ? Math.round((totalKills / finalStats.shotsFired) * 100) : 0;
  ctx.fillStyle = hitRatio >= 50 ? "#44ff88" : hitRatio >= 25 ? "#ffaa44" : "#ff4444";
  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.fillText(`HIT RATIO: ${hitRatio}%`, CANVAS_W / 2, 448);
  ctx.textAlign = "left";
}
