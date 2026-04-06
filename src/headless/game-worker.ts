import { parentPort, workerData } from "worker_threads";
import { runGame } from "./sim-runner";

const { games, config, preset, draftMode } = workerData as {
  games: { seed: number; maxTicks: number }[];
  config: Record<string, unknown>;
  preset: string | null;
  draftMode: boolean;
};
const results: ReturnType<typeof runGame>[] = [];

for (const { seed, maxTicks } of games) {
  results.push(runGame(config, { seed, maxTicks, preset, draftMode }));
}

parentPort!.postMessage(results);
