# Execution Spec: Fast Replay-Convergence Guard (pre-commit / pre-push)

> **Audience:** the implementer model. This is a handoff spec, not a suggestion.
> Follow it precisely; deviations must be justified in the PR description.
> **Branch:** `claude/replay-divergence-validation-8ca7s2`.
> The planner (author of this doc) will review the resulting PR against the
> **Acceptance Criteria** at the bottom.

---

## 1. Problem statement

Replays in this repo are **action-log + seed re-simulation**, not state playback
(`src/replay.ts`, `docs/replay-system.md`). The authoritative recorder is
`runGame()` (`src/headless/sim-runner.ts`); the browser and tests re-simulate via
`createReplayRunner()` (`src/replay.ts`).

These two paths handle the **wave-end / shop boundary differently**:

- `runGame` processes the shop **inline** at tick `T` (`buyUpgrade`/`buyDraftUpgrade`
  + `closeShop`), then **falls through to `update()` on the same tick `T`**
  (see the `// Fall through to update() below` comment in `sim-runner.ts`).
- `createReplayRunner` **pauses** (`shopPaused` / `bonusPaused`), then
  `resumeFromShop()` → `closeShop()`, and the **next** `step()` runs `update()`.

That asymmetry is the #1 source of the user's reported divergence
("skipped frames in the wave end of shop interaction"). The user also reports
"sometimes other reasons" — those are general determinism breaks (RNG misuse,
non-deterministic iteration order, etc.).

**Goal:** a fast, deterministic guard that records a game with `runGame`, replays
it with the real `createReplayRunner`, and asserts they stay **bit-identical
per tick** — reporting the **exact divergence tick** when they don't. Bounded so
it fits a **pre-commit (<2s)** and **pre-push (<5s)** hook.

### Scope boundary (state this in the PR)

This guard protects the **record↔replay invariant on current code** — i.e. that
the recorder and the runner agree, including across shop/bonus boundaries. It
**cannot** guarantee that *historical* replay JSON files survive arbitrary
gameplay-code changes; action-log replay is inherently code-drift sensitive.
That is the correct thing to guard automatically and matches the user's ask.

---

## 2. What already exists (reuse, do not reinvent)

- `buildReplayCheckpoint(g, tick)` in `src/replay-debug.ts` — returns a compact
  deterministic `{ hash, ... }` over score/wave/health/ammo/`fireChargeState`/
  upgrades/`defenseSites`/alive-entity lists. **Use its `.hash` as the per-tick
  fingerprint.**
- `runGame(botConfig, options)` in `src/headless/sim-runner.ts` — supports
  `record`, `draftMode`, `bootstrap`, and **`stopCondition`**.
- `createReplayRunner(replayData)` in `src/replay.ts` — the real runner the
  browser uses; reads `stopCondition` from the replay object via
  `resolveReplayStopWave`.
- `shouldStopReplayAtWaveComplete` / `resolveReplayStopWave` in
  `src/replay-bootstrap.ts` — `stopCondition: { type: "waveComplete", wave: N }`
  stops **both** `runGame` and the runner at the same deterministic boundary.
- Existing round-trip tests in `src/headless/sim-runner.test.ts` (final-state
  and interval-checkpoint equality). This spec **adds precision** (exact tick)
  and **speed** (hook-suitable), it does not replace those tests.

---

## 3. Validated design decisions (do not re-derive — these were measured)

The planner empirically verified the following on the current branch. **Trust
them; if you change them, re-measure and report.**

### 3.1 Bound work with `stopCondition`, never raw `maxTicks`

Capping with `maxTicks` alone produces **false mismatches**: `runGame` stops
mid-wave (timeout) but the runner keeps playing past the recorded actions and
diverges. Using `stopCondition: { type: "waveComplete", wave: N }` stops both at
the same boundary. A wave-`N` stop exercises `N-1` full shop transitions — which
is exactly the boundary we need to cover.

Measured: recording+replaying to `waveComplete` reproduces score/wave/stats and
**every per-tick hash** exactly (see 3.3).

### 3.2 Per-tick alignment has two gotchas — both handled by tick-keyed maps

Do **NOT** compare the two hash streams by array index. Two pitfalls:

1. **Shop-boundary duplicate:** at each shop boundary the runner emits a hash at
   the **same tick** as the following frame (observed: 1 duplicate tick per shop
   boundary). Index alignment therefore drifts by +1 per shop and every
   post-shop frame looks "different" even when states are identical.
2. **Off-by-one tick numbering:** the runner increments its internal tick
   **after** `update()`, so `runner.getTick()` **after** `step()` is already
   `+1` relative to the `tick` that `runGame` emits its hash under.

**Correct comparison (validated to be perfectly clean, `firstDiffTick = -1`,
no orphan ticks, across seeds 42/77/256/7/13/99):**

- Ground truth: `runGame` emits `hash` keyed by its loop `tick`, **after**
  `update()`.
- Replay: capture `const t = runner.getTick()` **before** calling `step()`
  (that is the tick about to be simulated, matching `runGame`'s `tick`), then
  key the post-`step()` hash under `t`.
- Store both as `Map<number, string>` (**last-write-wins per tick** — this
  absorbs the shop duplicate), then walk the **sorted union of keys**. First key
  whose hashes differ (or that is missing from one side) is the divergence point.

### 3.3 Measured timings (this environment; `tsx` startup ≈ 1.1–1.2s)

| Mode      | Seeds              | Stop wave | Pure work | Wall (incl. tsx) | Budget |
|-----------|--------------------|-----------|-----------|------------------|--------|
| fast      | 42, 77, 256        | 3         | ~0.46s    | ~1.7s            | <2s ✅ |
| thorough  | 42,77,256,7,13,99  | 4         | ~1.07s    | ~2.3s            | <5s ✅ |

If your machine is slower and `--fast` risks breaching 2s, **reduce fast to 2
seeds at wave 3** before dropping any shop coverage — never go below wave 3
(need ≥2 shop transitions). Report the trade-off in the PR.

---

## 4. Implementation

### Step 1 — Add an optional per-tick hook to `runGame` (behavior-preserving)

In `src/headless/sim-runner.ts`:

- Extend `RunGameOptions` with:
  ```ts
  /** Optional per-tick observer for validation tooling. Called after each
   *  update() with the loop tick and the live game state. No-op when unset,
   *  so determinism and all existing callers are unaffected. */
  onTick?: (tick: number, g: GameState) => void;
  ```
  (Import `GameState` from `../types` if not already imported.)
- In the main loop, **immediately after `update(g, dt, null);`** and **before**
  the `shouldStopReplayAtWaveComplete` check, add:
  ```ts
  options.onTick?.(tick, g);
  ```
  Do not compute any hash inside `runGame` — keep `replay-debug` as the only
  place that knows the checkpoint shape. The validator supplies the callback and
  calls `buildReplayCheckpoint` itself.

**Constraint:** this is the *only* change to `runGame`. It must be a pure
no-op when `onTick` is undefined. Do not reorder existing statements.

> Note: an `onTick` at exactly this position, keyed by the loop `tick`, was the
> configuration the planner validated to align perfectly with the runner. Keep
> the call site here.

### Step 2 — New validator `src/headless/validate-replay.ts`

Requirements:

- CLI: `npx tsx src/headless/validate-replay.ts [--fast|--thorough] [--seeds=a,b,c] [--wave=N]`
  - Default mode: `--fast`.
  - `--fast` → seeds `[42, 77, 256]`, stop wave `3`.
  - `--thorough` → seeds `[42, 77, 256, 7, 13, 99]`, stop wave `4`.
  - `--seeds`/`--wave` override the mode defaults (for local debugging).
- For each seed:
  1. `const stopCondition = { type: "waveComplete", wave } as const;`
  2. Ground truth:
     ```ts
     const gt = new Map<number, string>();
     const orig = runGame(null, {
       seed, record: true, draftMode: true, stopCondition, maxTicks: 60000,
       onTick: (t, g) => gt.set(t, buildReplayCheckpoint(g, t).hash),
     });
     ```
  3. Replay via the **real runner**:
     ```ts
     const rp = new Map<number, string>();
     const rr = createReplayRunner({ seed, actions: orig.actions!, stopCondition });
     rr.init();
     for (let i = 0; i < 300000; i++) {
       if (rr.isFinished()) break;
       if (rr.isShopPaused()) { rr.resumeFromShop(); continue; }
       if (rr.isBonusPaused()) {
         const g = rr.getState(); if (g) g._bonusScreenDone = true;
         rr.resumeFromBonusScreen(); continue;
       }
       const t = rr.getTick();          // tick about to be simulated
       rr.step();
       rp.set(t, buildReplayCheckpoint(rr.getState()!, t).hash);
     }
     rr.cleanup();
     ```
  4. Compare `gt` vs `rp` over the sorted union of keys. On the first differing
     (or orphaned) tick, mark this seed FAILED and capture `{ seed, tick }`.
     Also assert final `score` / `wave` / `stats` equality between `orig` and
     `rr.getState()` as a coarse backstop.
- **On divergence**, print a high-signal report and `process.exit(1)`:
  - `seed`, `firstDiffTick`, the checkpoint `reason` if one is near that tick
    (state = "shop"/"waveStart" boundary), and a **field-level diff** of the two
    checkpoints at that tick. Build both full `ReplayCheckpoint` objects
    (`buildReplayCheckpoint(g, tick)`) and diff their comparable fields:
    `state, wave, score, burjHealth, ammo, launcherHP, fireChargeState,
    upgrades, stats, counts`. This is what turns "it diverged" into "ammo
    differs by 1 at the wave-2 shop boundary".
  - To produce that diff you need the *state objects* at the tick, not just the
    hash. Simplest robust approach: when a seed's hash comparison fails, **re-run
    that single seed** capturing full checkpoints into `Map<tick, ReplayCheckpoint>`
    on both sides (cheap — one extra seed run), then diff at `firstDiffTick`.
    Keep the hot path (hash-only maps) lean; only pay for full checkpoints on
    failure.
- **On success**, print a one-line summary per seed
  (`seed=42 wave=3 ticks=1774 OK`) and exit `0`.
- Must call `rr.cleanup()` (restores `Math.random`) on every path, including
  early exit, so RNG state never leaks between seeds. `runGame` already restores
  `Math.random` itself.
- Reuse the `isMain` guard pattern from `sim-runner.ts` so the file can be run
  directly and also imported by a test without side effects.

Guard against a silent no-op: if `orig.deathCause !== "completed"` for any seed
(meaning the stop wave was never reached — e.g. the bot died early after a
balance change), treat it as a **hard failure** with a clear message
("seed N never reached wave W; validator would be vacuous"). A guard that
silently validates zero shop transitions is worse than no guard.

### Step 3 — npm scripts

In `package.json`:

```jsonc
"validate:replay": "tsx src/headless/validate-replay.ts --fast",
"validate:replay:thorough": "tsx src/headless/validate-replay.ts --thorough",
```

Use `tsx` (already a dependency via `npx tsx` usage). Prefer a bare `tsx` in the
script (npm resolves `node_modules/.bin/tsx`); if that is not present as a
dependency, use `npx tsx`. Verify which resolves faster on this repo and pick
the faster one — startup is the dominant cost.

### Step 4 — Hook wiring (`.githooks/`)

The repo already routes hooks via `npm run hooks:install`
(`git config core.hooksPath .githooks`) and ships `.githooks/pre-commit`
(prettier + eslint on staged files). Note: **hooks are not installed in a fresh
clone** (`core.hooksPath` is unset until `npm run hooks:install` is run).

**4a. Extend `.githooks/pre-commit`** — after the eslint block, run the fast
validator **only when staged files touch simulation/replay code**, so doc/UI/art
commits stay instant:

```bash
# Replay-convergence guard — only when sim/replay code changed (keep pre-commit fast).
sim_touched=false
for file in "${staged_files[@]}"; do
  case "$file" in
    src/game-sim*|src/game-logic*|src/replay*|src/headless/sim-runner.ts|src/headless/bot-brain.ts|src/game-sim-*.ts)
      sim_touched=true; break;;
  esac
done
if [ "$sim_touched" = true ]; then
  echo "Sim/replay code changed — validating replay convergence (fast)..."
  npm run --silent validate:replay
fi
```

Match the existing script's style (`set -euo pipefail`, the `staged_files`
array is already populated earlier in the file — reuse it, don't re-glob).

**4b. Add `.githooks/pre-push`** (new file, `chmod +x`) running the thorough
validator unconditionally (a push is rarer and the 5s budget allows full shop
coverage):

```bash
#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
echo "Validating replay convergence (thorough) before push..."
npm run --silent validate:replay:thorough
```

Provide an escape hatch note in the doc/hook comment: `git push --no-verify`
bypasses in an emergency (standard git behavior; do not build a custom one).

### Step 5 — Tighten the existing vitest (cheap CI backstop)

In `src/headless/sim-runner.test.ts`, add one test that mirrors the validator's
methodology at a single seed/stop-wave so CI catches regressions even if a
committer skipped hooks:

- Record with `runGame({ seed: 42, record: true, stopCondition: { type: "waveComplete", wave: 3 }, onTick })`.
- Replay via `createReplayRunner` with the same `stopCondition`.
- Assert the tick-keyed hash maps are equal (using the **before-`step()`**
  tick-capture rule from 3.2) **and** `deathCause === "completed"`.

Keep it to one seed so the vitest run stays fast; the hooks carry the broader
seed set.

### Step 6 — Docs

- Add a short "Replay convergence guard" subsection to `docs/replay-system.md`
  (and a one-liner in the CLAUDE.md "Replay system" area) describing:
  `npm run validate:replay[:thorough]`, that hooks require `npm run hooks:install`,
  and the scope boundary from §1. Link back to this plan file.

---

## 5. Explicit non-goals / pitfalls to avoid

- ❌ Do not compare hash streams by array index (see 3.2).
- ❌ Do not bound with `maxTicks` instead of `stopCondition` (see 3.1).
- ❌ Do not add any hashing/knowledge of checkpoint shape into `runGame`; the
  callback stays dumb, `replay-debug` owns the shape.
- ❌ Do not make the pre-commit hook run the thorough set or full games.
- ❌ Do not let a seed that dies before the stop wave pass silently (see Step 2
  guard).
- ❌ Do not weaken `assertNoEditorOverridesForDeterministicRun` — the validator
  runs headless and must keep that guard active.
- ❌ Do not commit generated `replay.json` fixtures for this; the validator
  records in-memory each run.

---

## 6. Plan-review checklist (implementer → planner handshake)

Before writing code, the implementer should confirm (in a PR comment or commit
message) agreement or push back on:

1. The **comparison methodology** in §3.2 (tick-keyed maps, before-`step()`
   tick capture, last-write-wins). This is the crux — if you disagree, say why
   with a counter-measurement.
2. The **seed sets and stop waves** (§3.3). Substitutions are fine if timing
   budgets and ≥2-shop coverage hold and you re-measure.
3. The **hook gating** (pre-commit conditional on sim files; pre-push
   unconditional thorough).

If any of these change, note it in the PR so the planner can re-review against
reality rather than this doc.

---

## 7. Acceptance criteria (planner will verify on the PR)

- [ ] `npm run validate:replay` exits `0` and completes **< 2s wall** on the CI
      runner; `validate:replay:thorough` exits `0` **< 5s wall**.
- [ ] `runGame` change is a strict no-op when `onTick` is unset (diff shows only
      the option field + single call site; existing tests unchanged and green).
- [ ] Validator uses the **real** `createReplayRunner` (not a bespoke re-sim) and
      the §3.2 alignment; comparison is tick-keyed, not index-based.
- [ ] On an **injected** divergence the validator reports the correct
      `firstDiffTick` and a readable field diff, then exits non-zero. **Prove it:**
      temporarily perturb the runner (e.g. skip one tick around shop resume) and
      paste the validator output in the PR, then revert. This demonstrates the
      guard actually catches the class of bug it exists for.
- [ ] Seed-never-reached-stop-wave is a hard failure, not a silent pass.
- [ ] `pre-commit` runs the fast validator **only** when sim/replay files are
      staged; unrelated commits skip it. `pre-push` runs thorough.
- [ ] `hooks:install` path documented; `--no-verify` escape hatch noted.
- [ ] New vitest (Step 5) passes and asserts `deathCause === "completed"`.
- [ ] Full suite green: `npm run typecheck`, `npm run lint`, `npm test`.

---

## Appendix A — Reference: validated round-trip harness

This is the exact loop the planner ran to prove per-tick equality
(`firstDiffTick = -1`, no orphan ticks) across seeds 42/77/256/7/13/99 at stop
wave 4. Use it as the skeleton for the validator's hot path.

```ts
import { runGame } from "./sim-runner";
import { createReplayRunner } from "../replay";
import { buildReplayCheckpoint } from "../replay-debug";

function firstDivergentTick(seed: number, wave: number): number {
  const stopCondition = { type: "waveComplete", wave } as const;

  const gt = new Map<number, string>();
  const orig = runGame(null, {
    seed, record: true, draftMode: true, stopCondition, maxTicks: 60000,
    onTick: (t, g) => gt.set(t, buildReplayCheckpoint(g, t).hash),
  });
  if (orig.deathCause !== "completed") {
    throw new Error(`seed ${seed} never reached wave ${wave}`);
  }

  const rp = new Map<number, string>();
  const rr = createReplayRunner({ seed, actions: orig.actions!, stopCondition });
  rr.init();
  for (let i = 0; i < 300000; i++) {
    if (rr.isFinished()) break;
    if (rr.isShopPaused()) { rr.resumeFromShop(); continue; }
    if (rr.isBonusPaused()) {
      const g = rr.getState(); if (g) g._bonusScreenDone = true;
      rr.resumeFromBonusScreen(); continue;
    }
    const t = rr.getTick();
    rr.step();
    rp.set(t, buildReplayCheckpoint(rr.getState()!, t).hash);
  }
  rr.cleanup();

  for (const t of [...new Set([...gt.keys(), ...rp.keys()])].sort((a, b) => a - b)) {
    if (gt.get(t) !== rp.get(t)) return t; // -1 sentinel never returned here; caller treats >=0 as failure
  }
  return -1;
}
```
