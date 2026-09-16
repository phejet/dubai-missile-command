# Gameplay analysis — September 2026

The four reports, in order:

1. [Initial evidence and study design](gameplay-design-report.html).
2. [Reward attribution](scoring-attribution-results.html).
3. [Score-independent shooting quality](scoring-quality-results.html).
4. [Matched progression and defense outcomes](scoring-progression-results.html).

All four embed anonymous aggregate data and can be opened without the private
recordings. They document analysis, not a gameplay or roadmap change.

## Part three status

Measurements and automated checks are complete. Nine user labels were received;
clip 02 was corrected to Productive, and clip 06 remains unlabelled. The user’s primary
criterion is preventing threats from reaching their targets. Dense clips limit
confidence in individual-shot judgments. See the [calibration notes](scoring-quality-method.md#user-calibration--2026-09-16)
and [recorded labels](scoring-quality-user-labels.json). No skill ranking is validated.

The clip tool requires this checkout's local Vite server and ignored private corpus.
It is not a public replay publication. After `npm run dev`, open:

<http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-quality-review.html>

[Provisional agent judgments](scoring-quality-judgments.json) were recorded before any
candidate ranking. They use six rendered temporal frames per clip, with known sampling
categories; they are not independent blinded human labels. No ranking was calculated.

## Reproduction and evidence

Scripts: `scripts/scoring-study/`, from the repository root. Private inputs:
`operator-results/scoring-study-20260915/`. Generated evidence stays in its
`attribution/` and `quality/` subdirectories and is not committed.

See the [attribution handover](scoring-attribution-handover.md) for baseline reproduction.
For quality measurement:

```bash
node scripts/scoring-study/build.mjs
node operator-results/scoring-study-20260915/attribution/observed.mjs --quality --cases
node operator-results/scoring-study-20260915/attribution/observed.mjs --quality
node scripts/scoring-study/quality-analysis.mjs --select-clips
node scripts/scoring-study/quality-report.mjs
```

`quality-clip-proof.ts` bundles with esbuild for a Node ESM entrypoint, then writes
70 headless reference checkpoints. `verify-quality.mjs` compares the browser clips
against those checkpoints, checks controls and phone layout, and captures frame sheets.

Verified: all 26 stored summaries and final ticks; all actions and 3,159 recorded
checkpoints; 4,819 equal baseline/observed state/RNG samples; 11 attribution cases and
six additional quality cases. Clip verification: 60 exact seek frames and 70 headless
checkpoint matches, play/pause, label persistence, 390px layout and no page errors.

Part two's unresolved-shot count used root combo events. Part three follows the whole
projectile/explosion lineage: 3,390 normally resolved shots and four unresolved at the
recording end. This resolves 57 formerly unclassified empty shots without changing
any reward attribution. Definitions and limitations are in the
[part-three method](scoring-quality-method.md).

## Part four status and reproduction

[Part four](scoring-progression-results.html) is complete as an observational analysis.
Final score/final-wave Pearson r is 0.953; a simple linear baseline has fitted R² 0.909
and leave-one-run-out predictive R² 0.879. These are descriptive, not causal percentages.
Strict matching leaves 41 completed-wave records through wave four. Only 12 strict
pairs have different loss outcomes, all in waves one–two; 11 favor the better-protected
run in total score. They share runs and retain different seeds/starting combos. No
strict matches exist after wave four, so the late-wave skill/build question is unresolved.

```bash
node scripts/scoring-study/build.mjs --progression
node operator-results/scoring-study-20260915/progression/progression-context.mjs
node scripts/scoring-study/progression-analysis.mjs
node scripts/scoring-study/progression-checks.mjs
python3 scripts/scoring-study/progression-crosscheck.py
node scripts/scoring-study/progression-report.mjs
node scripts/scoring-study/verify-progression.mjs
```

The last command needs local Vite and Chromium. All generated data and screenshots
remain in the ignored `progression/` directory. No rescoring or new gameplay experiment
was run. See the [part-four method](scoring-progression-method.md) for definitions,
matching tiers, run-block resampling and limits.
