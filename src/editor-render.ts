import { PixiRenderer } from "./pixi-render";
import { CANVAS_H, CANVAS_W, GAMEPLAY_SCENIC_BASE_Y, GROUND_Y } from "./game-logic";
import type { GameRenderer } from "./game-renderer";
import type { Explosion, GameState } from "./types";

type EditorPreviewBackend = Pick<GameRenderer, "renderGameplay" | "resize" | "destroy"> & {
  readyPromise?: Promise<void>;
};

interface PixiEditorPreviewRendererOptions {
  renderer?: EditorPreviewBackend;
}

export class PixiEditorPreviewRenderer {
  private readonly renderer: EditorPreviewBackend;
  private destroyed = false;
  private failed = false;
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackContext: CanvasRenderingContext2D | null = null;
  private renderReadbackChecked = false;
  private renderedFrames = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    { renderer = new PixiRenderer(canvas, { preserveDrawingBuffer: true }) }: PixiEditorPreviewRendererOptions = {},
  ) {
    this.renderer = renderer;
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
    if (!this.failed) {
      this.canvas.dataset.editorPreview = this.canvas.dataset.editorPreview === "booting" ? "booting" : "ready";
      try {
        this.renderer.renderGameplay(scene, { showShop: false });
      } catch (error) {
        console.error("[editor-preview] Pixi render failed; using fallback", error);
        this.activateDrawableFallback("pixi-render-error", scene);
        return;
      }
      this.maybeActivateReadbackFallback(scene);
    }
    if (this.fallbackContext) this.renderFallback(scene);
  }

  resize(): void {
    if (this.destroyed) return;
    this.renderer.resize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.dataset.editorPreview = "destroyed";
    this.fallbackCanvas?.remove();
    this.renderer.destroy();
  }

  private activateFallback(reason: string): void {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    this.canvas.dataset.editorPreview = "error";
    this.canvas.dataset.editorFallbackReason = reason;
    console.error("[editor-preview] fallback activated:", reason, {
      pixiTitle: this.canvas.dataset.pixiTitle,
      pixiGameplayStatic: this.canvas.dataset.pixiGameplayStatic,
      pixiContext: this.canvas.dataset.pixiContext,
    });
  }

  private maybeActivateReadbackFallback(scene: GameState): void {
    if (this.renderReadbackChecked || this.canvas.dataset.editorPreview !== "ready") return;
    this.renderedFrames++;
    if (this.renderedFrames < 8) return;
    this.renderReadbackChecked = true;
    if (!navigator.webdriver && this.hasReadablePixels()) return;
    this.activateDrawableFallback("blank-readback", scene);
  }

  private activateDrawableFallback(reason: string, scene: GameState): void {
    if (this.fallbackCanvas || this.destroyed) return;
    this.failed = true;
    this.canvas.dataset.editorPreview = "fallback";
    this.canvas.dataset.editorFallbackReason = reason;
    const fallback = document.createElement("canvas");
    fallback.width = CANVAS_W;
    fallback.height = CANVAS_H;
    fallback.className = "editor-canvas editor-canvas-fallback";
    fallback.dataset.renderer = "editor-fallback";
    fallback.style.pointerEvents = "none";
    this.canvas.after(fallback);
    this.fallbackCanvas = fallback;
    this.fallbackContext = fallback.getContext("2d");
    this.syncFallbackBounds();
    this.renderFallback(scene);
  }

  private hasReadablePixels(): boolean {
    const copy = document.createElement("canvas");
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    const context = copy.getContext("2d");
    if (!context) return false;
    context.drawImage(this.canvas, 0, 0);
    for (const [x, y] of [
      [350, 350],
      [700, 550],
      [460, 1530],
    ]) {
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      if (a > 0 && r + g + b > 80) return true;
    }
    return false;
  }

  private syncFallbackBounds(): void {
    if (!this.fallbackCanvas) return;
    this.fallbackCanvas.style.width = `${this.canvas.clientWidth}px`;
    this.fallbackCanvas.style.height = `${this.canvas.clientHeight}px`;
  }

  private renderFallback(scene: GameState): void {
    if (!this.fallbackContext) return;
    this.syncFallbackBounds();
    const ctx = this.fallbackContext;
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, "#040814");
    sky.addColorStop(0.6, "#101b35");
    sky.addColorStop(1, "#07080e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "rgba(160, 210, 255, 0.8)";
    for (const star of scene.stars.slice(0, 60)) {
      ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(scene.time * 0.02 + star.twinkle));
      ctx.fillRect(star.x, star.y, Math.max(1, star.size), Math.max(1, star.size));
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#11172c";
    for (const building of scene.buildings) {
      if (!building.alive) continue;
      ctx.fillRect(building.x, GAMEPLAY_SCENIC_BASE_Y - building.h, building.w, building.h);
    }

    ctx.fillStyle = "#b8d3e8";
    ctx.beginPath();
    ctx.moveTo(460, GROUND_Y - 820);
    ctx.lineTo(420, GROUND_Y - 120);
    ctx.lineTo(500, GROUND_Y - 120);
    ctx.closePath();
    ctx.fill();

    for (const explosion of scene.explosions) this.drawFallbackExplosion(ctx, explosion);

    ctx.fillStyle = "#111520";
    ctx.fillRect(0, GROUND_Y - 120, CANVAS_W, 120);
  }

  private drawFallbackExplosion(ctx: CanvasRenderingContext2D, explosion: Explosion): void {
    const radius = Math.max(8, explosion.radius || explosion.maxRadius * 0.35);
    const glow = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius * 1.8);
    glow.addColorStop(0, "rgba(255, 255, 210, 0.95)");
    glow.addColorStop(0.35, explosion.color || "rgba(255, 170, 0, 0.75)");
    glow.addColorStop(1, "rgba(255, 120, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, radius * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createPixiEditorPreviewRenderer(canvas: HTMLCanvasElement): PixiEditorPreviewRenderer {
  return new PixiEditorPreviewRenderer(canvas);
}
