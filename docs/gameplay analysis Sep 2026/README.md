# Gameplay analysis — September 2026

The three reports, in order:

1. [Initial evidence and study design](gameplay-design-report.html).
2. [Reward attribution](scoring-attribution-results.html).
3. [Score-independent shooting quality](scoring-quality-results.html).

All three embed anonymous aggregate data and can be opened without the private
recordings. They document analysis, not a gameplay or roadmap change.

## Part three status

Measurements and automated checks are complete. Human calibration remains open:
review **clips 01, 03 and 05** in the [score-hidden clip tool](scoring-quality-review.html),
then label each Productive, Wasteful, Sensible withholding or Ambiguous, with a reason.
Labels save in the browser; copy them into the conversation to share them.

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
