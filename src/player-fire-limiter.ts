export interface BufferedPlayerShot {
  x: number;
  y: number;
}

export interface PlayerFireLimiterState {
  bufferedShot: BufferedPlayerShot | null;
  burstCharges: number;
  burstChargeCap: number;
  nextRechargeTick: number | null;
  // Consecutive recharges since the last spend. Drives catchup acceleration.
  regenStreak: number;
}

// Catchup curve: each consecutive recharge after the first within a quiet streak
// arrives faster. With baseTicks=30 the sequence is 30, 10, 5. Firing resets the
// streak so sustained tap-spam stays at 1 shot per baseTicks.
function getRechargeDelay(streak: number, baseTicks: number): number {
  if (streak <= 0) return baseTicks;
  if (streak === 1) return Math.max(1, Math.floor(baseTicks / 3));
  return Math.max(1, Math.floor(baseTicks / 6));
}

export function createPlayerFireLimiterState(): PlayerFireLimiterState {
  return {
    bufferedShot: null,
    burstCharges: 0,
    burstChargeCap: 0,
    nextRechargeTick: null,
    regenStreak: 0,
  };
}

export function resetPlayerFireLimiter(state: PlayerFireLimiterState): void {
  state.bufferedShot = null;
  state.burstCharges = 0;
  state.burstChargeCap = 0;
  state.nextRechargeTick = null;
  state.regenStreak = 0;
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
    state.regenStreak = 0;
    return;
  }

  if (prevCap === 0 && state.burstCharges === 0 && state.nextRechargeTick === null) {
    state.burstChargeCap = nextCap;
    state.burstCharges = nextCap;
    state.regenStreak = 0;
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
    state.regenStreak++;
    if (state.burstCharges < nextCap) {
      state.nextRechargeTick = state.nextRechargeTick + getRechargeDelay(state.regenStreak, rechargeTicks);
    } else {
      state.nextRechargeTick = null;
    }
  }

  if (state.burstCharges >= nextCap) {
    state.nextRechargeTick = null;
  } else if (state.nextRechargeTick === null) {
    state.nextRechargeTick = tick + getRechargeDelay(state.regenStreak, rechargeTicks);
  }
}

export function spendPlayerBurstCharge(state: PlayerFireLimiterState, tick: number, rechargeTicks: number): boolean {
  if (state.burstCharges <= 0) return false;
  state.burstCharges--;
  state.regenStreak = 0;
  if (state.burstCharges < state.burstChargeCap) {
    // Firing resets the streak; the next recharge arrives at base rate.
    state.nextRechargeTick = tick + rechargeTicks;
  } else {
    state.nextRechargeTick = null;
  }
  return true;
}

export function consumeBufferedPlayerFire(state: PlayerFireLimiterState): BufferedPlayerShot | null {
  if (!state.bufferedShot) return null;
  const shot = state.bufferedShot;
  state.bufferedShot = null;
  return shot;
}
