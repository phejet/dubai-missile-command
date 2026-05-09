import type { GameState, GameStats } from "./types";

export type GameScreen = "title" | "playing" | "gameover";

export interface GameOverSnapshot {
  score: number;
  wave: number;
  stats: GameStats;
}

export interface GameplayRenderRequest {
  showShop?: boolean;
  interpolationAlpha?: number;
}

export interface GameRenderer {
  renderTitle(): void;
  renderGameplay(game: GameState, request?: GameplayRenderRequest): void;
  renderGameOver(snapshot: GameOverSnapshot): void;
  isRenderPaused?(): boolean;
  resize(): void;
  destroy(): void;
}
