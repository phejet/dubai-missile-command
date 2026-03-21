#!/usr/bin/env node
/**
 * Run bot training and send results to a local LLM (LM Studio / OpenAI-compatible API)
 *
 * Usage:
 *   node src/headless/analyze-with-llm.js [--games=200] [--api=http://WINDOWS_IP:1234/v1]
 *
 * Environment:
 *   LLM_API_URL  — base URL of OpenAI-compatible API (default: http://localhost:1234/v1)
 *   LLM_MODEL    — model name (default: auto-detect from LM Studio)
 */

import { runGame } from "./sim-runner.js";
import defaultConfig from "./bot-config.json" with { type: "json" };
import { readFileSync } from "fs";

// Parse args
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);

const numGames = parseInt(args.games || "200");
const apiUrl = args.api || process.env.LLM_API_URL || "http://localhost:1234/v1";
const modelOverride = args.model || process.env.LLM_MODEL || null;

// ── Step 1: Run training ──
console.log(`Running ${numGames} games...`);
const results = [];
for (let i = 0; i < numGames; i++) {
  const seed = Date.now() + i;
  const r = runGame(defaultConfig, { seed, record: true });
  const shopActions = r.actions.filter((a) => a.type === "shop");
  const allBought = shopActions.flatMap((a) => a.bought);
  results.push({
    score: r.score,
    wave: r.wave,
    deathCause: r.deathCause,
    stats: r.stats,
    bought: allBought,
  });
}

// ── Step 2: Compute stats ──
const scores = results.map((r) => r.score).sort((a, b) => a - b);
const waves = results.map((r) => r.wave).sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.floor((p / 100) * arr.length)];

const waveDist = {};
results.forEach((r) => {
  waveDist[r.wave] = (waveDist[r.wave] || 0) + 1;
});

const upgradeCounts = {};
results.forEach((r) => {
  r.bought.forEach((key) => {
    upgradeCounts[key] = (upgradeCounts[key] || 0) + 1;
  });
});

const avgStats = {
  missileKills: Math.round(results.reduce((s, r) => s + r.stats.missileKills, 0) / numGames),
  droneKills: Math.round(results.reduce((s, r) => s + r.stats.droneKills, 0) / numGames),
  shotsFired: Math.round(results.reduce((s, r) => s + r.stats.shotsFired, 0) / numGames),
};
const efficiency = (avgStats.missileKills + avgStats.droneKills) / avgStats.shotsFired;

// Read current config
const configStr = JSON.stringify(defaultConfig, null, 2);

// Read current upgrade costs
let upgradeCosts = "";
try {
  const simSrc = readFileSync(new URL("../game-sim.js", import.meta.url), "utf8");
  const upgradeBlock = simSrc.match(/export const UPGRADES[\s\S]*?^}/m);
  if (upgradeBlock) upgradeCosts = upgradeBlock[0].slice(0, 2000);
} catch {}

const summary = `
=== TRAINING RESULTS (${numGames} games) ===

SCORE: mean=${Math.round(scores.reduce((a, b) => a + b) / numGames)} median=${pct(scores, 50)} p10=${pct(scores, 10)} p90=${pct(scores, 90)} min=${scores[0]} max=${scores[scores.length - 1]}
WAVES: mean=${(waves.reduce((a, b) => a + b) / numGames).toFixed(1)} median=${pct(waves, 50)} p10=${pct(waves, 10)} p90=${pct(waves, 90)}
EFFICIENCY: ${efficiency.toFixed(3)} (${avgStats.missileKills + avgStats.droneKills} kills / ${avgStats.shotsFired} shots)

WAVE DISTRIBUTION:
${Object.entries(waveDist)
  .sort(([a], [b]) => a - b)
  .map(([w, n]) => `  Wave ${w}: ${n} games (${((n / numGames) * 100).toFixed(1)}%)`)
  .join("\n")}

UPGRADE PURCHASE FREQUENCY:
${Object.entries(upgradeCounts)
  .sort(([, a], [, b]) => b - a)
  .map(([k, n]) => `  ${k}: ${n} (${((n / numGames) * 100).toFixed(0)}% of games)`)
  .join("\n")}

BOT CONFIG:
${configStr}
`.trim();

console.log(summary);
console.log("\n--- Sending to LLM for analysis ---\n");

// ── Step 3: Query LLM ──
const systemPrompt = `You are a game balance analyst for "Dubai Missile Command", a canvas-based missile defense game inspired by Atari's Missile Command.

The game has:
- 3 launchers that fire player-aimed interceptors
- Waves of missiles, drones (Shahed-136 slow, Shahed-238 fast jets), and MIRVs (wave 5+)
- Auto-defense upgrades: Wild Hornets (FPV drones), Roadrunner (guided interceptors), Decoy Flares, Iron Beam (laser), Phalanx CIWS, Patriot SAM, EMP Shockwave
- Launcher Kit upgrade (+ammo), Burj Repair Kit
- Defense sites that can be destroyed, disabling their upgrade
- F-15 friendly fighters that help but can be shot down by player

Key balance issues we're tracking:
- Bimodal wave distribution (most die wave 3-7, survivors snowball to wave 30+)
- Auto-defenses can make the player irrelevant in late game
- Score distribution has a 100x+ gap between median and p90

Analyze the training data and suggest specific, actionable changes to improve balance. Focus on closing the mid-game gap (waves 8-20) and reducing snowball effect.`;

async function queryLLM(prompt) {
  // Auto-detect model if not specified
  let model = modelOverride;
  if (!model) {
    try {
      const modelsRes = await fetch(`${apiUrl}/models`);
      const models = await modelsRes.json();
      model = models.data?.[0]?.id || "default";
    } catch {
      model = "default";
    }
  }

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here are the results from ${numGames} bot-played games. Analyze the balance and suggest improvements:\n\n${summary}` },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!res.ok) {
    console.error(`LLM API error: ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.error(body);
    process.exit(1);
  }

  // Stream response
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) process.stdout.write(content);
      } catch {}
    }
  }
  console.log();
}

try {
  await queryLLM(summary);
} catch (e) {
  console.error(`\nFailed to connect to LLM at ${apiUrl}`);
  console.error(`Make sure LM Studio is running and the API server is enabled.`);
  console.error(`\nYou can also copy the training output above and paste it into any LLM manually.`);
  console.error(`\nError: ${e.message}`);
}
