import { PixiRenderer } from "./pixi-render";
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
  private destroyed = false;
  private failed = false;
  private pendingPixelCheck = false;
  private frameCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    { renderer = new PixiRenderer(canvas) }: PixiEditorPreviewRendererOptions = {},
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
    if (this.failed) return;
    this.canvas.dataset.editorPreview = this.canvas.dataset.editorPreview === "booting" ? "booting" : "ready";
    this.renderer.renderGameplay(scene, { showShop: false });
    this.schedulePixelCheck();
  }

  resize(): void {
    if (this.destroyed) return;
    this.renderer.resize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.dataset.editorPreview = "destroyed";
    this.renderer.destroy();
  }

  private schedulePixelCheck(): void {
    this.frameCount += 1;
    if (this.pendingPixelCheck || this.frameCount < 12 || this.frameCount % 30 !== 12) return;

    this.pendingPixelCheck = true;
    requestAnimationFrame(() => {
      this.pendingPixelCheck = false;
      if (this.destroyed || this.failed) return;
      if (this.canvas.dataset.pixiTitle === "error" || this.canvas.dataset.pixiGameplayStatic === "error") {
        this.activateFallback("pixi-error");
        return;
      }
      if (isCanvasMostlyWhiteOrBlank(this.canvas)) {
        this.activateFallback("blank-pixi-canvas");
      }
    });
  }

  private activateFallback(reason: string): void {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    this.canvas.dataset.editorPreview = "error";
    this.canvas.dataset.editorFallbackReason = reason;
  }
}

export function createPixiEditorPreviewRenderer(canvas: HTMLCanvasElement): PixiEditorPreviewRenderer {
  return new PixiEditorPreviewRenderer(canvas);
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
