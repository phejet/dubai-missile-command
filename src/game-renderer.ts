import type { GameState } from "./types";

export type GameScreen = "title" | "playing" | "gameover";

export interface GameOverSnapshot {
  score: number;
  wave: number;
  stats: { missileKills: number; droneKills: number; shotsFired: number };
}

export interface GameplayRenderRequest {
  showShop?: boolean;
  interpolationAlpha?: number;
}

export interface GameRenderer {
  renderTitle(): void;
  renderGameplay(game: GameState, request?: GameplayRenderRequest): void;
  renderGameOver(snapshot: GameOverSnapshot): void;
  resize(): void;
  destroy(): void;
}
