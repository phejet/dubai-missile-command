import { setRng, fireInterceptor } from "./game-logic.js";
import { initGame, update, buyUpgrade, closeShop, fireEmp, repairSite, repairLauncher } from "./game-sim.js";
import { mulberry32 } from "./headless/rng.js";

export function createReplayRunner(replayData, onEvent = null) {
  const { seed, actions } = replayData;
  let actionIdx = 0;
  let tick = 0;
  let g = null;
  let finished = false;
  let shopPaused = false;

  function init() {
    const rng = mulberry32(seed);
    setRng(rng);
    g = initGame();
    actionIdx = 0;
    tick = 0;
    finished = false;
    shopPaused = false;
    return g;
  }

  function step() {
    if (finished || !g || shopPaused) return;

    if (g.state === "gameover") {
      finished = true;
      return;
    }

    // When game enters shop state, wait for the shop action at this tick
    if (g.state === "shop") {
      // Check if there's a shop action at current tick
      if (actionIdx < actions.length && actions[actionIdx].tick === tick && actions[actionIdx].type === "shop") {
        const action = actions[actionIdx];
        for (const key of action.bought) {
          if (key.startsWith("repair_launcher_")) {
            repairLauncher(g, parseInt(key.split("_")[2]));
          } else if (key.startsWith("repair_")) {
            repairSite(g, key.replace("repair_", ""));
          } else {
            buyUpgrade(g, key);
          }
        }
        g._replayShopBought = action.bought;
        shopPaused = true;
        actionIdx++;
      }
      // Don't increment tick or call update while in shop
      return;
    }

    // Process all actions at this tick
    while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
      const action = actions[actionIdx];
      if (action.type === "fire") {
        fireInterceptor(g, action.x, action.y);
      } else if (action.type === "emp") {
        fireEmp(g, onEvent);
      }
      actionIdx++;
    }

    update(g, 1, onEvent);
    tick++;
  }

  function resumeFromShop() {
    if (!shopPaused || !g) return;
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
