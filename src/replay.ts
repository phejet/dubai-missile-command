import { setRng, fireInterceptor } from "./game-logic";
import {
  initGame,
  update,
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  fireEmp,
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
  let pendingShopAction: ShopAction | null = null;

  function shouldStopReplay() {
    return !!g && shouldStopReplayAtWaveComplete(g, stopWave);
  }

  function init() {
    const rng = mulberry32(seed);
    setRng(rng);
    g = initGame();
    if (draftMode) g._draftMode = true;
    applyReplayBootstrap(g, replayData, startWave);
    actionIdx = 0;
    tick = 0;
    finished = false;
    shopPaused = false;
    pendingShopAction = null;
    return g;
  }

  function step() {
    if (finished || !g || shopPaused) return;

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
      // Discard any stale combat actions that were recorded before the shop opened.
      while (actionIdx < actions.length && actions[actionIdx].type !== "shop" && actions[actionIdx].tick <= tick) {
        actionIdx++;
      }

      let shopAction: ShopAction | null = null;
      while (actionIdx < actions.length) {
        if (actions[actionIdx].type === "shop") {
          shopAction = actions[actionIdx] as ShopAction;
          actionIdx++;
          break;
        }
        if (actions[actionIdx].tick > tick) break;
        actionIdx++;
      }
      if (shopAction) {
        pendingShopAction = shopAction;
        g._replayShopBought = shopAction.bought;
      }
      shopPaused = true;
      return;
    }

    // Process all actions at this tick
    while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
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
          buyDraftUpgrade(g, key as import("./types").UpgradeKey);
        } else {
          buyUpgrade(g, key as import("./types").UpgradeKey);
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

  return { init, step, getState, getTick, isFinished, isShopPaused, resumeFromShop, cleanup };
}
