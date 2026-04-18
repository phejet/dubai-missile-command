import { CANVAS_H } from "./game-logic";
import { preloadCanvasRenderResources } from "./canvas-render-resources";
import { Game } from "./game";
import { CanvasGameRenderer } from "./game-render";
import type { GameScreen } from "./game-renderer";

export type RendererMode = "canvas2d";

interface BootGameOptions {
  mode?: RendererMode;
}

const PHONE_PORTRAIT_LAYOUT_PROFILE = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: false,
  externalGameOver: true,
  crosshairFillRadius: 22,
  crosshairOuterRadius: 16,
  crosshairInnerRadius: 18,
  crosshairGap: 9,
  crosshairArmLength: 24,
  mirvWarningFontSize: 24,
  mirvWarningY: 86,
  purchaseToastFontSize: 28,
  purchaseToastY: CANVAS_H * 0.38,
  lowAmmoFontSize: 34,
  lowAmmoY: CANVAS_H * 0.42,
  waveClearedY: CANVAS_H * 0.5,
  multiKillLabelSize: 28,
  multiKillBonusSize: 20,
  buildingScale: 2,
  burjScale: 2,
  launcherScale: 3,
  enemyScale: 3,
  projectileScale: 2,
  effectScale: 2,
  planeScale: 3,
};

export function bootGame({ mode = "canvas2d" }: BootGameOptions = {}): Game {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
  const titleRenderModeButton = document.getElementById("title-render-mode-button") as HTMLButtonElement | null;
  const gameplayRenderModeButton = document.getElementById("option-render") as HTMLButtonElement | null;
  const gameplayRenderModeMeta = document.getElementById("option-render-meta") as HTMLElement | null;

  if (!canvas || !titleRenderModeButton || !gameplayRenderModeButton || !gameplayRenderModeMeta) {
    throw new Error("Missing runtime DOM nodes required to boot the game");
  }

  preloadCanvasRenderResources();

  const renderer = (() => {
    switch (mode) {
      case "canvas2d":
      default:
        return new CanvasGameRenderer({ canvas, layoutProfile: PHONE_PORTRAIT_LAYOUT_PROFILE });
    }
  })();

  let screen: GameScreen = "title";

  const syncRenderModeUi = () => {
    const titleLive = renderer.isTitleRenderLive();
    const gameplayLive = renderer.isGameplayRenderLive();

    titleRenderModeButton.hidden = screen !== "title";
    titleRenderModeButton.textContent = `Render: ${titleLive ? "Live" : "Baked"}`;
    titleRenderModeButton.ariaPressed = titleLive ? "true" : "false";
    titleRenderModeButton.title = titleLive
      ? "Switch title rendering back to baked mode"
      : "Switch title rendering to live mode";

    gameplayRenderModeButton.hidden = screen !== "playing";
    gameplayRenderModeButton.classList.toggle("battlefield-option--active", gameplayLive);
    gameplayRenderModeButton.setAttribute("aria-pressed", gameplayLive ? "true" : "false");
    gameplayRenderModeButton.title = gameplayLive
      ? "Switch gameplay rendering back to baked sharp mode"
      : "Switch gameplay rendering to live mode";
    gameplayRenderModeMeta.textContent = gameplayLive ? "Live" : "Baked Sharp";
  };

  titleRenderModeButton.addEventListener("click", () => {
    renderer.toggleTitleRenderMode();
    syncRenderModeUi();
  });
  gameplayRenderModeButton.addEventListener("click", () => {
    renderer.toggleGameplayRenderMode();
    syncRenderModeUi();
  });

  const game = new Game({
    canvas,
    renderer,
    onScreenChange(nextScreen) {
      screen = nextScreen;
      syncRenderModeUi();
    },
  });

  syncRenderModeUi();
  return game;
}
