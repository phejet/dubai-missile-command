import { setRng, fireInterceptor } from "./game-logic";
import {
  initGame,
  update,
  buyUpgrade,
  grantReplayUpgrade,
  closeShop,
  fireFlareSalvo,
  fireEmp,
  fireF15Pair,
  repairSite,
  repairLauncher,
} from "./game-sim";
import { mulberry32 } from "./headless/rng";
import {
  applyReplayBootstrap,
  resolveReplayStartWave,
  resolveReplayStopWave,
  shouldStopReplayAtWaveComplete,
} from "./replay-bootstrap";
import type { GameState, ReplayData, ShopAction } from "./types";

type EventCallback = ((type: string, data?: unknown) => void) | null;

export function createReplayRunner(replayData: ReplayData, onEvent: EventCallback = null) {
  const { seed, actions } = replayData;
  const draftMode =
    replayData.draftMode !== undefined
      ? replayData.draftMode
      : !actions?.some((action) => action.type === "shop" && ((action as ShopAction).bought?.length ?? 0) > 1);
  const startWave = resolveReplayStartWave(replayData);
  const stopWave = resolveReplayStopWave(replayData, startWave);
  let actionIdx = 0;
  let tick = 0;
  let g: GameState | null = null;
  let finished = false;
  let shopPaused = false;
  let bonusPaused = false;
  let pendingShopAction: ShopAction | null = null;

  function shouldStopReplay() {
    return !!g && shouldStopReplayAtWaveComplete(g, stopWave);
  }

  function init() {
    if ((replayData.version ?? 1) < 4) {
      onEvent?.("replay_version_warning", {
        version: replayData.version ?? 1,
        message: "Replay was recorded before the shared fire-pool model; checkpoint hashes may diverge.",
      });
    }
    const rng = mulberry32(seed);
    setRng(rng);
    g = initGame();
    g._gameSeed = seed;
    g._replay = true;
    g._replayIsHuman = !!replayData.isHuman;
    if (draftMode) g._draftMode = true;
    applyReplayBootstrap(g, replayData, startWave);
    actionIdx = 0;
    tick = 0;
    finished = false;
    shopPaused = false;
    bonusPaused = false;
    pendingShopAction = null;
    return g;
  }

  function step() {
    if (finished || !g || shopPaused || bonusPaused) return;

    if (g.state === "gameover") {
      finished = true;
      return;
    }
    if (shouldStopReplay()) {
      finished = true;
      return;
    }

    // When game enters shop state, find and apply the next shop action immediately
    if (g.state === "shop") {
      // Discard non-shop input recorded during the wave-summary/shop UI gap.
      while (actionIdx < actions.length && actions[actionIdx].type !== "shop") {
        actionIdx++;
      }

      let shopAction: ShopAction | null = null;
      if (actionIdx < actions.length && actions[actionIdx].type === "shop") {
        shopAction = actions[actionIdx] as ShopAction;
        actionIdx++;
      }
      if (shopAction) {
        pendingShopAction = shopAction;
        g._replayShopBought = shopAction.bought;
        tick = Math.max(tick, shopAction.tick);
        g._replayTick = tick;
      }
      shopPaused = true;
      return;
    }

    // Process all actions due by this tick. Browser-only UI pauses can resume one
    // tick after same-tick markers such as wave_plan, so stale non-shop actions
    // must drain instead of wedging the queue.
    while (actionIdx < actions.length && actions[actionIdx].tick <= tick) {
      const action = actions[actionIdx];
      if (action.type === "shop") break;
      if (action.type === "wave_plan") {
        actionIdx++;
        continue;
      }
      if (action.type === "cursor") {
        g.crosshairX = action.x;
        g.crosshairY = action.y;
        actionIdx++;
        continue;
      }
      if (action.type === "fire") {
        g.crosshairX = action.x;
        g.crosshairY = action.y;
        fireInterceptor(g, action.x, action.y, tick);
      } else if (action.type === "emp") {
        fireEmp(g, onEvent);
      } else if (action.type === "f15") {
        fireF15Pair(g, onEvent);
      } else if (action.type === "flare") {
        fireFlareSalvo(g, onEvent);
      }
      actionIdx++;
    }

    // Interpolate cursor toward next cursor/fire action for smooth crosshair movement
    for (let i = actionIdx; i < actions.length; i++) {
      const next = actions[i];
      if (next.type === "cursor" || next.type === "fire") {
        const gap = next.tick - tick;
        if (gap > 0 && gap <= 6) {
          const t = 1 / gap;
          g.crosshairX += (next.x - g.crosshairX) * t;
          g.crosshairY += (next.y - g.crosshairY) * t;
        }
        break;
      }
      if (next.type === "shop") break;
    }

    update(g, 1, onEvent);
    tick++;
    g._replayTick = tick;
    if (g._bonusScreenStarted && !g._bonusScreenDone) {
      bonusPaused = true;
      return;
    }
    if (shouldStopReplay()) {
      finished = true;
    }
  }

  function resumeFromShop() {
    if (!shopPaused || !g) return;
    if (pendingShopAction) {
      for (const key of pendingShopAction.bought) {
        if (key.startsWith("repair_launcher_")) {
          repairLauncher(g, parseInt(key.split("_")[2]));
        } else if (key.startsWith("repair_")) {
          repairSite(g, key.replace("repair_", ""));
        } else if (draftMode) {
          grantReplayUpgrade(g, key);
        } else {
          if (!grantReplayUpgrade(g, key)) {
            buyUpgrade(g, key as import("./types").UpgradeKey);
          }
        }
      }
      pendingShopAction = null;
    }
    closeShop(g);
    shopPaused = false;
  }

  function isShopPaused() {
    return shopPaused;
  }

  function resumeFromBonusScreen() {
    if (!bonusPaused || !g || !g._bonusScreenDone) return;
    bonusPaused = false;
    if (g.waveComplete && !g.shopOpened) {
      update(g, 0, onEvent);
    }
  }

  function isBonusPaused() {
    return bonusPaused;
  }

  function getState() {
    return g;
  }

  function getTick() {
    return tick;
  }

  function isFinished() {
    return finished;
  }

  function cleanup() {
    setRng(Math.random);
  }

  return {
    init,
    step,
    getState,
    getTick,
    isFinished,
    isShopPaused,
    resumeFromShop,
    isBonusPaused,
    resumeFromBonusScreen,
    cleanup,
  };
}
