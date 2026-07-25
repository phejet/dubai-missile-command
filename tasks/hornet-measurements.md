# Wild Hornets measurements

All `variants.ts` rows use 20 games. Deltas below roughly 10% are treated as unresolved.
The `average` bot rows are the primary baseline; the `BOT_SKIP`/`BOT_FOCUS_Y` rows are a
reduced-fire scenario, not a human-performance model.

## Phase 0 — pre-change baseline

### Primary (`average`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down/orphan |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ----------------: |
| 70000     | 1 pad            | 10,020 | 5.35 |           56 | 28.9% |  4.1% |             57.4% |
| 70000     | 2 pads           | 13,252 | 6.05 |          102 | 31.0% |  7.7% |             53.2% |
| 70000     | 2 pads + SkyMesh | 16,609 | 6.65 |          117 | 43.8% | 44.3% |              0.0% |
| 91000     | 1 pad            |  9,478 | 5.30 |           54 | 26.9% |  5.2% |             58.4% |
| 91000     | 2 pads           | 13,615 | 6.30 |          107 | 35.0% |  6.4% |             52.0% |
| 91000     | 2 pads + SkyMesh | 16,853 | 6.75 |          118 | 45.0% | 44.1% |              0.0% |

### Reduced-fire scenario (`BOT_SKIP=0.35 BOT_FOCUS_Y=700`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down/orphan |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ----------------: |
| 70000     | 1 pad            |  5,217 | 4.30 |           42 | 44.7% |  6.7% |             39.1% |
| 70000     | 2 pads           | 12,165 | 5.90 |           98 | 44.7% |  9.4% |             38.6% |
| 70000     | 2 pads + SkyMesh | 13,377 | 6.15 |          103 | 52.2% | 37.8% |              0.0% |
| 91000     | 1 pad            |  6,117 | 4.55 |           44 | 43.3% |  6.8% |             39.9% |
| 91000     | 2 pads           | 11,056 | 5.80 |           95 | 43.2% |  8.2% |             41.5% |
| 91000     | 2 pads + SkyMesh | 15,459 | 6.50 |          112 | 51.4% | 37.5% |              0.0% |

### Guardrails

- `src/game-sim.test.ts`: 134 passing.
- Determinism seed `12345`: score 118,618, wave 12, 390 missile kills, 169 drone
  kills, 407 shots; repeated run matched.

## Final narrow-fuze implementation

These rows include distinct death presentations, batch launch assignment, pass-below
relinquishing, the accel-aware preloaded-speed gate, the conditional MIRV-family filter,
SkyMesh loiter, and the uncatchable-case lead clamp. Fuze/blast remain 12/30.

### Primary (`average`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down | Loiter peak / mean p95 |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ---------: | ---------------------: |
| 70000     | 1 pad            |  9,340 | 5.25 |           53 | 27.1% |  0.2% |      62.0% |                0 / 0.0 |
| 70000     | 2 pads           | 12,632 | 6.05 |           95 | 35.7% |  0.8% |      55.5% |                0 / 0.0 |
| 70000     | 2 pads + SkyMesh | 17,350 | 6.80 |          113 | 51.6% | 27.6% |       0.0% |                6 / 3.4 |
| 91000     | 1 pad            | 10,685 | 5.35 |           55 | 29.4% |  0.1% |      60.3% |                0 / 0.0 |
| 91000     | 2 pads           | 12,976 | 6.05 |           97 | 34.4% |  0.6% |      57.7% |                0 / 0.0 |
| 91000     | 2 pads + SkyMesh | 15,941 | 6.65 |          111 | 52.6% | 27.4% |       0.0% |                6 / 3.5 |

### Reduced-fire scenario

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down | Loiter peak / mean p95 |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ---------: | ---------------------: |
| 70000     | 1 pad            |  6,046 | 4.45 |           42 | 47.8% |  1.1% |      41.1% |                0 / 0.0 |
| 70000     | 2 pads           | 11,397 | 5.80 |           89 | 47.2% |  0.8% |      44.1% |                0 / 0.0 |
| 70000     | 2 pads + SkyMesh | 14,301 | 6.25 |          101 | 57.7% | 24.6% |       0.0% |                6 / 3.0 |
| 91000     | 1 pad            |  6,086 | 4.55 |           43 | 47.2% |  0.1% |      43.0% |                0 / 0.0 |
| 91000     | 2 pads           | 10,496 | 5.60 |           84 | 48.5% |  1.1% |      42.4% |                0 / 0.0 |
| 91000     | 2 pads + SkyMesh | 14,854 | 6.30 |          103 | 60.0% | 22.9% |       0.0% |                6 / 3.0 |

### Decisions

- The feasibility gate cut ordinary-pad fuel-outs to 0.1–1.1%. Across the two
  primary seed sets, two-pad score stayed within the ±10% unresolved band.
- After the gate, hornets still launched 144 times at MIRV-family targets and killed
  13 (9.0%). The soft filter reduced that to 40 launches and four kills across the
  same 40 games; those launches occur only when no other target exists.
- SkyMesh hit the explicit concurrency cap of six, with mean per-run p95 concurrency
  of 3.0–3.5. The cap is doing real work and remains an obvious tuning lever.
- The plan's `3.0 / 5.6` solver hand-check says 100 ticks, but the continuous crossing
  is 99.47 and therefore rounds to 99. The implementation and test use the computed
  value rather than preserving the table's inconsistent rounding.

## Optional 45/52 fuze trial — declined

The wide proximity warhead was measured against the final implementation at both seed
bases, then reverted.

| Profile      | Seed base | 1 pad score delta | 2 pads score delta | SkyMesh score delta |
| ------------ | --------: | ----------------: | -----------------: | ------------------: |
| `average`    |     70000 |             +5.8% |              -4.9% |              +20.5% |
| `average`    |     91000 |             -9.9% |              +4.7% |              +15.1% |
| reduced-fire |     70000 |             -3.8% |              +9.0% |              +16.1% |
| reduced-fire |     91000 |             +6.9% |             +24.6% |              +24.4% |

The replicated effect is a strong SkyMesh power increase, not a general consistency
improvement. Ordinary-pad results are mixed and mostly inside noise, so Phase 2b does
not land without a deliberate balance decision and controller feel-check.

## Bot re-tune

The average bot's priority order changed from
`patriot → launcherKit → emp → wildHornets` to
`wildHornets → emp → patriot → launcherKit`. Controlled 20-game seed blocks beat the
old order on both bases; a final independent 100-game sample averaged 24,964 points,
wave 7.3, and 0.875 shot efficiency.

## Final verification and performance

- Unit: 467 passing.
- Static checks: typecheck, ESLint, Prettier, and production build passing.
- Determinism seed `12345`: score 112,346, wave 11, 409 missile kills, 152 drone
  kills, 466 shots; repeated run matched.
- Replays: all three tracked replay-v7 fixtures validated.
- Browser: 17 smoke and replay tests passing.
- Final iPhone production build `3a7c432+4c2779e5` installed on Alex's iPhone 15 Pro.
- Median iPhone p95: 17 ms for both `perf-wave1` and `perf-wave4-upgrades`.
- Matching desktop and device reports:
  `perf-results/baselines/3a7c432+4c2779e5/`.
