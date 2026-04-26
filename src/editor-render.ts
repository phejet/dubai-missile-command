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
}

export function createPixiEditorPreviewRenderer(canvas: HTMLCanvasElement): PixiEditorPreviewRenderer {
  return new PixiEditorPreviewRenderer(canvas);
}
