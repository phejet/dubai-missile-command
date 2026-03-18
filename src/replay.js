import { setRng, fireInterceptor } from "./game-logic.js";
import { initGame, update, buyUpgrade, closeShop } from "./game-sim.js";
import { mulberry32 } from "./headless/rng.js";

export function createReplayRunner(replayData, onEvent = null) {
  const { seed, actions } = replayData;
  let actionIdx = 0;
  let tick = 0;
  let g = null;
  let finished = false;

  function init() {
    const rng = mulberry32(seed);
    setRng(rng);
    g = initGame();
    actionIdx = 0;
    tick = 0;
    finished = false;
    return g;
  }

  function step() {
    if (finished || !g) return;

    if (g.state === "gameover") {
      finished = true;
      return;
    }

    // Process all actions at this tick
    while (actionIdx < actions.length && actions[actionIdx].tick === tick) {
      const action = actions[actionIdx];
      if (action.type === "fire") {
        fireInterceptor(g, action.x, action.y);
      } else if (action.type === "shop") {
        for (const key of action.bought) {
          buyUpgrade(g, key);
        }
        closeShop(g);
      }
      actionIdx++;
    }

    update(g, 1, onEvent);
    tick++;
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

  return { init, step, getState, getTick, isFinished, cleanup };
}
