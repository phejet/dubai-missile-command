export interface BufferedPlayerShot {
  x: number;
  y: number;
}

export interface PlayerFireLimiterState {
  cooldownUntilTick: number;
  bufferedShot: BufferedPlayerShot | null;
}

export const PLAYER_FIRE_COOLDOWN_TICKS = 20;

export function createPlayerFireLimiterState(): PlayerFireLimiterState {
  return {
    cooldownUntilTick: -Infinity,
    bufferedShot: null,
  };
}

export function resetPlayerFireLimiter(state: PlayerFireLimiterState): void {
  state.cooldownUntilTick = -Infinity;
  state.bufferedShot = null;
}

export function isPlayerFireReady(state: PlayerFireLimiterState, tick: number): boolean {
  return tick >= state.cooldownUntilTick;
}

export function bufferPlayerFire(state: PlayerFireLimiterState, shot: BufferedPlayerShot): void {
  state.bufferedShot = shot;
}

export function consumeBufferedPlayerFire(state: PlayerFireLimiterState, tick: number): BufferedPlayerShot | null {
  if (!state.bufferedShot || !isPlayerFireReady(state, tick)) return null;
  const shot = state.bufferedShot;
  state.bufferedShot = null;
  return shot;
}

export function markPlayerFireFired(
  state: PlayerFireLimiterState,
  tick: number,
  cooldownTicks = PLAYER_FIRE_COOLDOWN_TICKS,
): void {
  state.cooldownUntilTick = tick + cooldownTicks;
  state.bufferedShot = null;
}
