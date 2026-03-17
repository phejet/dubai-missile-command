import { parentPort, workerData } from "worker_threads";
import { runGame } from "./sim-runner.js";

const { games, config } = workerData;
const results = [];

for (const { seed, maxTicks } of games) {
  results.push(runGame(config, { seed, maxTicks }));
}

parentPort.postMessage(results);
