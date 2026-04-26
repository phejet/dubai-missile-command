import { PixiRenderer } from "./pixi-render";
import { CANVAS_H, CANVAS_W } from "./game-logic";
import { drawGame } from "./game-render";
import type { GameRenderer } from "./game-renderer";
import type { GameState } from "./types";

type EditorPreviewBackend = Pick<GameRenderer, "renderGameplay" | "resize" | "destroy"> & {
  readyPromise?: Promise<void>;
};

interface PixiEditorPreviewRendererOptions {
  renderer?: EditorPreviewBackend;
}

const EDITOR_LAYOUT = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: true,
  externalGameOver: true,
  buildingScale: 2,
  burjScale: 2,
  launcherScale: 3,
  enemyScale: 3,
  projectileScale: 2,
  effectScale: 2,
  planeScale: 3,
};

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
    drawGame(ctx, scene, {
      showShop: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layoutProfile: EDITOR_LAYOUT as any,
    });
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
