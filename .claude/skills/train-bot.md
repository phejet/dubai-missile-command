# Train Bot

Run headless bot training, get Sonnet analysis, and apply tuning to `src/headless/bot-config.json`.

## Steps

1. Run the training benchmark:
   ```bash
   node src/headless/train.js --games=200 --iterations=5
   ```

2. Save the benchmark output — you'll need it for the analysis agent.

3. Spawn a Sonnet agent (model: sonnet) to analyze results and produce recommendations. The agent prompt must include:
   - The full benchmark output from step 1
   - Tell the agent to read these files for context:
     - `src/headless/bot-config.json` (current config)
     - `src/headless/bot-brain.js` (what each parameter does)
     - `src/game-sim.js` (game mechanics: spawning rates, upgrade effects, damage, ammo economy)
   - Ask the agent to return a structured analysis with:
     - **Diagnosis**: what's going wrong (e.g. "dying wave 2 because ammo runs out", "low efficiency from bad lead shots")
     - **Recommended config changes**: exact JSON patch to apply to bot-config.json, with reasoning for each change
     - **Recommended code changes to bot-brain.js** (if any): specific behavioral improvements (e.g. "prioritize missiles over drones when ammo < X")
   - The agent should ONLY research and analyze — it must NOT edit any files

4. Present the Sonnet agent's recommendations to the user clearly:
   - Show the diagnosis summary
   - Show each recommended change with its reasoning
   - Ask: "Accept these recommendations? (all / pick specific ones / reject)"

5. Wait for user response. Apply only the accepted changes.

6. After applying changes, re-run the benchmark to verify improvement:
   ```bash
   node src/headless/train.js --games=200 --iterations=3
   ```

7. Compare before/after metrics and report the delta to the user.

8. Run a determinism check:
   ```bash
   node src/headless/sim-runner.js 42
   ```
