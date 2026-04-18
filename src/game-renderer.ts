import type { GameState } from "./types";

export type GameScreen = "title" | "playing" | "gameover";

export interface GameOverSnapshot {
  score: number;
  wave: number;
  stats: { missileKills: number; droneKills: number; shotsFired: number };
}

export interface GameplayRenderRequest {
  showShop?: boolean;
}

export interface GameRenderer {
  renderTitle(): void;
  renderGameplay(game: GameState, request?: GameplayRenderRequest): void;
  renderGameOver(snapshot: GameOverSnapshot): void;
  resize(): void;
  destroy(): void;
}

// Transitional render probe state shared by the controller HUD and the Canvas2D renderer.
export const perfState = {
  frameCount: 0,
  startTime: 0,
  glowEnabled: true,
  probed: false,
};
