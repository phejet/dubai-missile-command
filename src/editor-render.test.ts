// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PixiEditorPreviewRenderer } from "./editor-render";
import { initGame } from "./game-sim";
import type { GameRenderer } from "./game-renderer";

function createBackend() {
  const backend = {
    renderGameplay: vi.fn<GameRenderer["renderGameplay"]>(),
    renderTitle: vi.fn<GameRenderer["renderTitle"]>(),
    renderGameOver: vi.fn<GameRenderer["renderGameOver"]>(),
    resize: vi.fn<GameRenderer["resize"]>(),
    destroy: vi.fn<GameRenderer["destroy"]>(),
    readyPromise: Promise.resolve(),
  };
  return backend;
}

describe("PixiEditorPreviewRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes editor scenes through Pixi gameplay rendering without shop chrome", () => {
    const canvas = document.createElement("canvas");
    const backend = createBackend();
    const preview = new PixiEditorPreviewRenderer(canvas, { renderer: backend });
    const scene = initGame();

    preview.render(scene);

    expect(canvas.dataset.renderer).toBe("pixi");
    expect(backend.renderGameplay).toHaveBeenCalledWith(scene, { showShop: false });
  });

  it("marks the canvas destroyed and tears down the backend once", () => {
    const canvas = document.createElement("canvas");
    const backend = createBackend();
    const preview = new PixiEditorPreviewRenderer(canvas, { renderer: backend });

    preview.destroy();
    preview.destroy();
    preview.render(initGame());

    expect(canvas.dataset.editorPreview).toBe("destroyed");
    expect(backend.destroy).toHaveBeenCalledTimes(1);
    expect(backend.renderGameplay).not.toHaveBeenCalled();
  });

  it("marks the preview failed when Pixi reports an initialization error", async () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    document.body.appendChild(host);
    const backend = createBackend();
    canvas.dataset.pixiTitle = "error";
    const preview = new PixiEditorPreviewRenderer(canvas, { renderer: backend });
    const scene = initGame();

    await backend.readyPromise;
    await Promise.resolve();
    preview.render(scene);

    expect(canvas.dataset.editorPreview).toBe("error");
    expect(canvas.dataset.editorFallbackReason).toBe("pixi-error");
    expect(host.querySelector("canvas.editor-canvas-fallback")).toBeNull();
    expect(backend.renderGameplay).not.toHaveBeenCalled();

    preview.destroy();
    host.remove();
  });
});
