# Wild Hornets analysis harness

Artifacts backing [`docs/wild-hornets-targeting-analysis.md`](../../wild-hornets-targeting-analysis.md).
**Not shipped code and not on any import path from `src/`.** Kept so the findings can be
re-run and audited rather than taken on trust.

## What `probe.ts` does

Mirrors the loop in `src/headless/sim-runner.ts`, with three deliberate differences:

1. **Forces an exact loadout** via `buyDraftUpgrade` (which is free — see `game-sim-shop.ts:344`)
   followed by `prepareWaveStart(g)`. No draft randomness.
2. **Buys nothing in the shop** (`closeShop(g)` with no purchase), so in the isolation runs
   hornets are the only auto-defense and every effect is attributable. `marginal.ts` overrides
   this by forcing a non-hornet core in the loadout instead.
3. **Snapshots pre-update state every tick** and diffs `g.hornets` afterwards to classify each
   hornet's fate.

### The classifier — and why it must use pre-update state

`updateAutoSystems()` runs _before_ `updateExplosions()` inside `update()` (`game-sim.ts:2231`
vs `:2234`), so a hornet's own blast kills its target **within the same tick**. Classifying from
post-update state makes every successful hit indistinguishable from "target died to something
else" — the first version of this harness reported a 0.2% detonation rate for exactly that
reason.

Because `updateAutoSystems` runs first, every branch a hornet takes this tick is evaluated
against positions from the end of the _previous_ tick. So the classifier reproduces the sim's
own branch order against the pre-update snapshot:

```ts
if (!hp)                                      r.outcome = "waveReset";
else if (hp.life - 1 <= 0)                    r.outcome = "fuel";
else if (hp.x < -60 || hp.x > 960 || ...)     r.outcome = "bounds";
else if (!t || !tp || !tp.alive)              r.outcome = "orphan";
else if (d < FUZE)                            r.outcome = "detonate";
else                                          r.outcome = "waveReset";
```

`waveReset` is the between-wave despawn at `game-sim-shop.ts:407`, which clears `g.hornets`.

### Player-profile knobs (env)

The stock bot fires more accurately and often than a human and never cedes screen area, which
inflates the orphan rate. Two knobs model a human:

| Env               | Effect                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `BOT_SKIP=0.35`   | drops 35% of firing opportunities via a third seeded RNG (`seed ^ 0x9e3779b9`) |
| `BOT_FOCUS_Y=700` | bot ignores any threat below y=700, ceding the lower screen to hornets         |

**"realistic profile" throughout the analysis = `BOT_SKIP=0.35 BOT_FOCUS_Y=700`.**
**"bot-default" = neither set.** `marginal.ts` / `strategy.ts` runs use `BOT_SKIP=0.35` only,
because the complement-build player does not cede the bottom.

## Running

```bash
# outcome breakdown across the three hornet loadouts
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 label

# marginal value of hornets on top of a Roadrunner+Patriot+Phalanx core
BOT_SKIP=0.35 npx tsx docs/analysis-harness/wild-hornets/marginal.ts

# cross-side / magazine telemetry
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/pads.ts 20 70000 label 2pad
```

| Script        | Answers                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `variants.ts` | outcome mix, fuel/orphan rates, tail-chase geometry, per-loadout summary      |
| `run.ts`      | verbose single-config report incl. terminal funnel and fuze counterfactuals   |
| `pads.ts`     | per-pad magazine state, cross-side launch rate and justification              |
| `geometry.ts` | cross-side vs same-side conditioned on _arrival_ (isolates terminal geometry) |
| `fuel.ts`     | accel-aware intercept prediction vs actual flight time                        |
| `loiter.ts`   | loiter entry / reactivation / wait-time distribution                          |
| `meshfuel.ts` | whether SkyMesh fuel-outs still had a live target                             |
| `border.ts`   | activation-border and speed-cap rule sweeps                                   |
| `strategy.ts` | cede-the-bottom strategy at constant attention budget                         |
| `marginal.ts` | ablation: value of each hornet purchase on a built core                       |

## Reproducing the counterfactuals

Scripts alone reproduce only the **baseline** measurements. Every counterfactual also required a
temporary patch to `src/game-sim.ts`, applied behind an env flag, measured, then reverted with
`git checkout src/game-sim.ts`. The patches, all inside the hornet block of
`updateAutoSystems()` / `pickHornetLaunchTarget()` / `pickHornetRetargetTarget()`:

| Env flag                                  | Patch                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HORNET_FUZE=<px>`                        | replace the literal `12` in `if (d < 12)` (`game-sim.ts:1086`)                                                                                                                        |
| `HORNET_SELFBOOM=1`                       | detonate at `h.x, h.y` with radius `max(blastRadius, fuze * 1.15)` instead of at `hTarget.x, hTarget.y`                                                                               |
| `HORNET_LEAD=1`                           | lead multiplier 0.3 → 1.0, keeping the iterative time estimate                                                                                                                        |
| `HORNET_LEAD=2`                           | closed-form intercept solve `\|R + Vt\| = st`, smallest positive root, clamped to `h.life`, pure-pursuit fallback when no positive real root                                          |
| `HORNET_GATE=<frac>`                      | drop launch candidates whose constant-velocity intercept time exceeds `168 * frac`; hold fire if none remain                                                                          |
| `HORNET_SOFT=<w>`                         | soft score penalty `max(0, t - 168*0.85) * w` instead of a hard filter                                                                                                                |
| `HORNET_FUELGATE=<frac>`                  | **accel-aware** gate: `hxInterceptTicks(...) <= 168 * frac`, using `v0·a(aⁿ−1)/(a−1)` for threat position and bisection for `n`                                                       |
| `HORNET_FUELGATE_HOLD=1`                  | when the accel-aware gate leaves no candidate, return `null` instead of falling back to the full pool                                                                                 |
| `HORNET_RETARGET_FUEL=<frac>`             | same accel-aware test applied in `pickHornetRetargetTarget`, budgeted against `h.life` remaining                                                                                      |
| `HORNET_LOCALFIX=1`                       | gate the half-map fallback on _live_ threats rather than _unassigned_ ones (hold if own half is merely busy)                                                                          |
| `HORNET_ROLEFIX=1`                        | allow doubling on an in-role target (<2 assigned) before falling out of role                                                                                                          |
| `HORNET_NOMIRV=1`                         | drop `mirv`/`mirv_warhead`/`stack2`/`stack3` from launch candidates when anything else exists                                                                                         |
| `HORNET_ACTIVATE_Y=<y>`                   | only launch at threats with `t.y >= y`                                                                                                                                                |
| `HORNET_MAXSPD=<v>`                       | only launch at threats with `hypot(vx,vy) <= v`                                                                                                                                       |
| `HORNET_MISSILE_MAXSPD=<v>`               | drones/bombs always eligible; other types only while `hypot(vx,vy) <= v`                                                                                                              |
| `HORNET_LIFE`, `HORNET_SPEEDMUL`          | override hornet `life` / `speed` at spawn                                                                                                                                             |
| `HORNET_RELOAD=<ticks>`                   | override `reloadPerSlot` (default 60)                                                                                                                                                 |
| `HORNET_LOITER=<ticks>`                   | SkyMesh loiter: on finding no target, anchor and orbit instead of drifting; burn `HORNET_LOITER_BURN` (0.25) of normal fuel; self-destruct after this many ticks of continuous loiter |
| `HORNET_LOITER_R`, `HORNET_LOITER_ANYALT` | loiter orbit radius (22); ignore `HORNET_DIVE_SLACK` while loitering                                                                                                                  |

`probe.ts` reads `HORNET_FUZE` itself so its classifier matches a patched fuze, and reads a
`_pred` field the `HORNET_FUELGATE` patch stamps on each launched hornet for prediction-accuracy
telemetry. Both are no-ops against unpatched `src/`.

## Verified state

`src/` is unmodified — every patch above was reverted. Confirm with:

```bash
git diff --stat src/          # empty
npx vitest run src/game-sim.test.ts   # 134 passing
```
