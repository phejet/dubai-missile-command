import { setRng, fireInterceptor } from "./game-logic.js";
import { initGame, update, buyUpgrade, closeShop } from "./game-sim.js";
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

    // Process all actions at this tick
    let shopTick = false;
    while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
      const action = actions[actionIdx];
      if (action.type === "fire") {
        fireInterceptor(g, action.x, action.y);
      } else if (action.type === "shop") {
        for (const key of action.bought) {
          buyUpgrade(g, key);
        }
        // Don't closeShop yet — pause so UI can show purchases
        g._replayShopBought = action.bought;
        shopPaused = true;
        shopTick = true;
      }
      actionIdx++;
    }

    // Match sim-runner: shop ticks skip update (continue)
    if (!shopTick) {
      update(g, 1, onEvent);
    }
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
