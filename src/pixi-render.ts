import { Application, Container } from "pixi.js";
import { CANVAS_H, CANVAS_W } from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameplayRenderRequest } from "./game-renderer";
import { createPixiTextureResources, type PixiTextureResources } from "./pixi-textures";
import type { GameState } from "./types";

type PixiScreen = "title" | "playing" | "gameover";

interface PixiRendererOptions {
  textures?: PixiTextureResources;
}

export class PixiRenderer implements GameRenderer {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly textures: PixiTextureResources;
  private readonly ready: Promise<void>;
  private initialized = false;
  private destroyed = false;
  private initError: Error | null = null;
  private screen: PixiScreen = "title";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    { textures = createPixiTextureResources() }: PixiRendererOptions = {},
  ) {
    this.textures = textures;
    this.app.stage.addChild(this.root);
    this.canvas.dataset.renderer = "pixi";
    this.ready = this.initialize();
  }

  renderTitle(): void {
    this.screen = "title";
    this.renderIfReady();
  }

  renderGameplay(_game: GameState, request: GameplayRenderRequest = {}): void {
    void request;
    this.screen = "playing";
    this.renderIfReady();
  }

  renderGameOver(snapshot: GameOverSnapshot): void {
    void snapshot;
    this.screen = "gameover";
    this.renderIfReady();
  }

  resize(): void {
    if (!this.initialized || this.destroyed) return;
    this.app.renderer.resize(CANVAS_W, CANVAS_H);
    this.renderIfReady();
  }

  destroy(): void {
    this.destroyed = true;
    this.app.destroy(false, { children: true, texture: false, textureSource: false });
  }

  get readyPromise(): Promise<void> {
    return this.ready;
  }

  get textureResources(): PixiTextureResources {
    return this.textures;
  }

  private async initialize(): Promise<void> {
    try {
      await this.app.init({
        canvas: this.canvas,
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundAlpha: 0,
        antialias: false,
        autoStart: false,
        preference: "webgl",
      });
      if (this.destroyed) return;
      this.initialized = true;
      this.renderIfReady();
    } catch (error: unknown) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      console.error("[pixi] renderer initialization failed", this.initError);
    }
  }

  private renderIfReady(): void {
    if (!this.initialized || this.destroyed || this.initError) return;
    this.root.visible = this.screen === "title" || this.screen === "playing" || this.screen === "gameover";
    this.app.render();
  }
}
