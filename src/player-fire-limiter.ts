export interface BufferedPlayerShot {
  x: number;
  y: number;
}

export interface PlayerFireLimiterState {
  bufferedShot: BufferedPlayerShot | null;
  burstCharges: number;
  burstChargeCap: number;
  nextRechargeTick: number | null;
}

export function createPlayerFireLimiterState(): PlayerFireLimiterState {
  return {
    bufferedShot: null,
    burstCharges: 0,
    burstChargeCap: 0,
    nextRechargeTick: null,
  };
}

export function resetPlayerFireLimiter(state: PlayerFireLimiterState): void {
  state.bufferedShot = null;
  state.burstCharges = 0;
  state.burstChargeCap = 0;
  state.nextRechargeTick = null;
}

export function bufferPlayerFire(state: PlayerFireLimiterState, shot: BufferedPlayerShot): void {
  state.bufferedShot = shot;
}

export function getBufferedPlayerFire(state: PlayerFireLimiterState): BufferedPlayerShot | null {
  return state.bufferedShot;
}

export function getPlayerBurstChargeCount(state: PlayerFireLimiterState): number {
  return state.burstCharges;
}

export function syncPlayerFireLimiter(
  state: PlayerFireLimiterState,
  tick: number,
  burstChargeCap: number,
  rechargeTicks: number,
): void {
  const nextCap = Math.max(0, burstChargeCap);
  const prevCap = state.burstChargeCap;

  if (nextCap === 0) {
    state.burstCharges = 0;
    state.burstChargeCap = 0;
    state.nextRechargeTick = null;
    return;
  }

  if (prevCap === 0 && state.burstCharges === 0 && state.nextRechargeTick === null) {
    state.burstChargeCap = nextCap;
    state.burstCharges = nextCap;
    return;
  }

  state.burstChargeCap = nextCap;

  if (prevCap < nextCap) {
    state.burstCharges = Math.min(nextCap, state.burstCharges + (nextCap - prevCap));
  } else if (state.burstCharges > nextCap) {
    state.burstCharges = nextCap;
  }

  while (state.burstCharges < nextCap && state.nextRechargeTick !== null && tick >= state.nextRechargeTick) {
    state.burstCharges++;
    state.nextRechargeTick = state.burstCharges < nextCap ? state.nextRechargeTick + rechargeTicks : null;
  }

  if (state.burstCharges >= nextCap) {
    state.nextRechargeTick = null;
  } else if (state.nextRechargeTick === null) {
    state.nextRechargeTick = tick + rechargeTicks;
  }
}

export function spendPlayerBurstCharge(state: PlayerFireLimiterState, tick: number, rechargeTicks: number): boolean {
  if (state.burstCharges <= 0) return false;
  state.burstCharges--;
  if (state.burstCharges < state.burstChargeCap && state.nextRechargeTick === null) {
    state.nextRechargeTick = tick + rechargeTicks;
  }
  return true;
}

export function consumeBufferedPlayerFire(state: PlayerFireLimiterState): BufferedPlayerShot | null {
  if (!state.bufferedShot) return null;
  const shot = state.bufferedShot;
  state.bufferedShot = null;
  return shot;
}
