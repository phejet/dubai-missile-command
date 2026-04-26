import { PixiRenderer } from "./pixi-render";
import { BURJ_H, BURJ_X, CANVAS_H, CANVAS_W, GROUND_Y, LAUNCHERS } from "./game-logic";
import type { GameRenderer } from "./game-renderer";
import type { GameState } from "./types";

type EditorPreviewBackend = Pick<GameRenderer, "renderGameplay" | "resize" | "destroy"> & {
  readyPromise?: Promise<void>;
};

interface PixiEditorPreviewRendererOptions {
  renderer?: EditorPreviewBackend;
}

export class PixiEditorPreviewRenderer {
  private readonly renderer: EditorPreviewBackend;
  private readonly fallback: CanvasEditorFallbackRenderer;
  private destroyed = false;
  private fallbackActive = false;
  private pendingPixelCheck = false;
  private frameCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    { renderer = new PixiRenderer(canvas) }: PixiEditorPreviewRendererOptions = {},
  ) {
    this.renderer = renderer;
    this.fallback = new CanvasEditorFallbackRenderer(canvas);
    this.canvas.dataset.renderer = "pixi";
    this.canvas.dataset.editorPreview = "booting";
    this.renderer.readyPromise?.then(
      () => {
        if (this.destroyed) return;
        if (this.canvas.dataset.pixiTitle === "error" || this.canvas.dataset.pixiGameplayStatic === "error") {
          this.activateFallback("pixi-error");
          return;
        }
        this.canvas.dataset.editorPreview = "ready";
      },
      () => {
        if (!this.destroyed) this.activateFallback("pixi-error");
      },
    );
  }

  render(scene: GameState): void {
    if (this.destroyed) return;
    if (this.fallbackActive) {
      this.fallback.render(scene);
      return;
    }
    this.canvas.dataset.editorPreview = this.canvas.dataset.editorPreview === "booting" ? "booting" : "ready";
    this.renderer.renderGameplay(scene, { showShop: false });
    this.schedulePixelCheck(scene);
  }

  resize(): void {
    if (this.destroyed) return;
    this.renderer.resize();
    this.fallback.resize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.dataset.editorPreview = "destroyed";
    this.fallback.destroy();
    this.renderer.destroy();
  }

  private schedulePixelCheck(scene: GameState): void {
    this.frameCount += 1;
    if (this.pendingPixelCheck || this.frameCount < 12 || this.frameCount % 30 !== 12) return;

    this.pendingPixelCheck = true;
    requestAnimationFrame(() => {
      this.pendingPixelCheck = false;
      if (this.destroyed || this.fallbackActive) return;
      if (this.canvas.dataset.pixiTitle === "error" || this.canvas.dataset.pixiGameplayStatic === "error") {
        this.activateFallback("pixi-error", scene);
        return;
      }
      if (isCanvasMostlyWhiteOrBlank(this.canvas)) {
        this.activateFallback("blank-pixi-canvas", scene);
      }
    });
  }

  private activateFallback(reason: string, scene?: GameState): void {
    if (this.fallbackActive || this.destroyed) return;
    this.fallbackActive = true;
    this.canvas.dataset.editorPreview = "fallback";
    this.canvas.dataset.editorFallbackReason = reason;
    this.fallback.show();
    if (scene) this.fallback.render(scene);
  }
}

export function createPixiEditorPreviewRenderer(canvas: HTMLCanvasElement): PixiEditorPreviewRenderer {
  return new PixiEditorPreviewRenderer(canvas);
}

class CanvasEditorFallbackRenderer {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private visible = false;

  constructor(private readonly sourceCanvas: HTMLCanvasElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = "editor-canvas editor-canvas-fallback";
    this.canvas.dataset.renderer = "editor-fallback";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.display = "none";
    this.canvas.style.pointerEvents = "none";
  }

  show(): void {
    if (!this.canvas.parentElement) {
      this.sourceCanvas.parentElement?.appendChild(this.canvas);
    }
    this.ctx = this.ctx ?? this.canvas.getContext("2d");
    this.visible = true;
    this.canvas.style.display = "block";
    this.resize();
  }

  resize(): void {
    if (!this.visible) return;
    const parentRect = this.sourceCanvas.parentElement?.getBoundingClientRect();
    const rect = this.sourceCanvas.getBoundingClientRect();
    if (!parentRect) return;
    this.canvas.style.left = `${rect.left - parentRect.left}px`;
    this.canvas.style.top = `${rect.top - parentRect.top}px`;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }

  render(scene: GameState): void {
    if (!this.visible) this.show();
    this.resize();
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, "#070b1a");
    sky.addColorStop(0.62, "#0b1630");
    sky.addColorStop(1, "#09101a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "rgba(200,230,255,0.72)";
    for (const star of scene.stars) {
      if (star.y < 0 || star.y > GROUND_Y) continue;
      ctx.globalAlpha = 0.28 + 0.28 * Math.sin(scene.time * 0.035 + star.twinkle);
      ctx.fillRect(star.x, star.y, Math.max(1, star.size), Math.max(1, star.size));
    }
    ctx.globalAlpha = 1;

    drawFallbackCity(ctx, scene);
    drawFallbackProjectiles(ctx, scene);
    drawFallbackExplosions(ctx, scene);
    drawFallbackParticles(ctx, scene);
    drawFallbackOverlays(ctx, scene);
  }

  destroy(): void {
    this.canvas.remove();
  }
}

function isCanvasMostlyWhiteOrBlank(canvas: HTMLCanvasElement): boolean {
  try {
    const sample = document.createElement("canvas");
    sample.width = canvas.width;
    sample.height = canvas.height;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0);

    let bright = 0;
    let darkOrColored = 0;
    let alpha = 0;
    const xs = [0.12, 0.28, 0.44, 0.6, 0.76, 0.9];
    const ys = [0.08, 0.22, 0.38, 0.54, 0.7, 0.86, 0.96];
    for (const xRatio of xs) {
      for (const yRatio of ys) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.round(canvas.width * xRatio)));
        const y = Math.max(0, Math.min(canvas.height - 1, Math.round(canvas.height * yRatio)));
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        alpha += a;
        if (a > 8 && r > 235 && g > 235 && b > 235) bright += 1;
        if (a > 8 && (r + g + b < 520 || Math.max(r, g, b) - Math.min(r, g, b) > 24)) darkOrColored += 1;
      }
    }
    const total = xs.length * ys.length;
    return alpha < total * 8 || (bright / total > 0.8 && darkOrColored < 3);
  } catch {
    return false;
  }
}

function drawFallbackCity(ctx: CanvasRenderingContext2D, scene: GameState): void {
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  ctx.fillStyle = "#122033";
  ctx.fillRect(0, GROUND_Y - 4, CANVAS_W, 4);
  ctx.fillStyle = "rgba(100,220,255,0.34)";
  ctx.fillRect(0, GROUND_Y + 18, CANVAS_W, 2);

  for (const building of scene.buildings) {
    if (building.alive === false) continue;
    ctx.fillStyle = "#080c14";
    ctx.fillRect(building.x, GROUND_Y - building.h, building.w, building.h);
    ctx.fillStyle = "rgba(255,230,150,0.68)";
    for (let y = GROUND_Y - building.h + 16; y < GROUND_Y - 8; y += 18) {
      for (let x = building.x + 6; x < building.x + building.w - 6; x += 14) {
        if ((x + y + scene.time) % 4 < 2) ctx.fillRect(x, y, 4, 7);
      }
    }
  }

  const burjTop = GROUND_Y - BURJ_H;
  ctx.fillStyle = scene.burjAlive ? "#b8d8e8" : "#523434";
  ctx.beginPath();
  ctx.moveTo(BURJ_X, burjTop - 70);
  ctx.lineTo(BURJ_X - 38, GROUND_Y);
  ctx.lineTo(BURJ_X + 38, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(BURJ_X - 3, burjTop - 28, 6, 230);
  ctx.fillStyle = "rgba(110,240,255,0.6)";
  ctx.fillRect(BURJ_X - 18, GROUND_Y - 110, 36, 4);
  ctx.fillRect(BURJ_X - 26, GROUND_Y - 72, 52, 4);

  for (const launcher of LAUNCHERS) {
    ctx.fillStyle = "#5a863b";
    ctx.fillRect(launcher.x - 24, launcher.y - 18, 48, 20);
    ctx.fillStyle = "#87b856";
    ctx.fillRect(launcher.x - 8, launcher.y - 38, 16, 22);
  }
}

function drawFallbackProjectiles(ctx: CanvasRenderingContext2D, scene: GameState): void {
  for (const missile of scene.missiles) {
    drawTrail(ctx, missile.trail, "rgba(255,112,48,0.42)");
    drawFallbackNeedle(ctx, missile.x, missile.y, Math.atan2(missile.vy, missile.vx), "#ff6638");
  }
  for (const drone of scene.drones) {
    drawTrail(ctx, drone.trail, "rgba(255,150,60,0.28)");
    drawFallbackNeedle(ctx, drone.x, drone.y, Math.atan2(drone.vy, drone.vx), "#dce8ef");
  }
  for (const interceptor of scene.interceptors) {
    drawTrail(ctx, interceptor.trail, "rgba(120,240,255,0.5)");
    drawFallbackNeedle(
      ctx,
      interceptor.x,
      interceptor.y,
      interceptor.heading ?? Math.atan2(interceptor.vy, interceptor.vx),
      "#9ff6ff",
    );
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: Array<{ x: number; y: number }> | undefined,
  color: string,
): void {
  if (!trail || trail.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (const point of trail.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawFallbackNeedle(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(6, 10);
  ctx.lineTo(0, 5);
  ctx.lineTo(-6, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFallbackExplosions(ctx: CanvasRenderingContext2D, scene: GameState): void {
  for (const explosion of scene.explosions) {
    const gradient = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, explosion.radius);
    gradient.addColorStop(0, `rgba(255,255,240,${Math.min(1, explosion.alpha)})`);
    gradient.addColorStop(0.32, explosion.playerCaused ? "rgba(90,255,210,0.72)" : "rgba(255,132,42,0.72)");
    gradient.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, explosion.radius, 0, Math.PI * 2);
    ctx.fill();
    if (explosion.ringAlpha > 0) {
      ctx.strokeStyle = `rgba(255,230,160,${explosion.ringAlpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(explosion.x, explosion.y, explosion.ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawFallbackParticles(ctx: CanvasRenderingContext2D, scene: GameState): void {
  for (const particle of scene.particles) {
    const alpha = Math.max(0, Math.min(1, particle.life / Math.max(1, particle.maxLife ?? particle.life)));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function drawFallbackOverlays(ctx: CanvasRenderingContext2D, scene: GameState): void {
  if (scene._showUpgradeRanges) {
    ctx.strokeStyle = "rgba(100,255,200,0.22)";
    ctx.lineWidth = 2;
    for (const site of scene.defenseSites) {
      if (!site.alive) continue;
      ctx.beginPath();
      ctx.arc(site.x, site.y, 120, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (scene._showColliders) {
    ctx.strokeStyle = "rgba(255,200,60,0.6)";
    ctx.lineWidth = 2;
    for (const drone of scene.drones) {
      ctx.beginPath();
      ctx.arc(drone.x, drone.y, drone.collisionRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
