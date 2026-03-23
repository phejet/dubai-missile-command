import { setRng, fireInterceptor } from "./game-logic.js";
import {
  initGame,
  update,
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  fireEmp,
  repairSite,
  repairLauncher,
} from "./game-sim.js";
import { mulberry32 } from "./headless/rng.js";

export function createReplayRunner(replayData, onEvent = null) {
  const { seed, actions, draftMode } = replayData;
  let actionIdx = 0;
  let tick = 0;
  let g = null;
  let finished = false;
  let shopPaused = false;
  let pendingShopAction = null;

  function init() {
    const rng = mulberry32(seed);
    setRng(rng);
    g = initGame();
    if (draftMode) g._draftMode = true;
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

    // When game enters shop state, find and apply the next shop action immediately
    if (g.state === "shop") {
      // Discard any stale combat actions that were recorded before the shop opened.
      while (actionIdx < actions.length && actions[actionIdx].type !== "shop" && actions[actionIdx].tick <= tick) {
        actionIdx++;
      }

      let shopAction = null;
      while (actionIdx < actions.length) {
        if (actions[actionIdx].type === "shop") {
          shopAction = actions[actionIdx];
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
        fireInterceptor(g, action.x, action.y);
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
          buyDraftUpgrade(g, key);
        } else {
          buyUpgrade(g, key);
        }
      }
      pendingShopAction = null;
    }
    closeShop(g);
    // Shop time no longer advances replay ticks, so combat resumes on the
    // current tick without injecting an extra simulation step.
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
