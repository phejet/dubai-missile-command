# Scoring replay study: initial findings

2026-09-15. Discovery evidence for the [study plan](scoring-replay-study-plan.md).
No gameplay changes or experimental scoring systems have been implemented.

## Coverage and validation

- Retrieved all 26 sessions returned by the live Staging operator API, including
  all 26 available replays and detail summaries. Pagination was exhausted.
- These include the 21 previously backed-up recordings plus five newer recordings;
  action/build/final-tick signatures identify 26 distinct runs.
- All are iOS recordings, in draft mode, ending with the Burj destroyed. The user
  confirms genuine Staging play sessions are theirs. None carries a headless-browser
  marker. There are eight build identifiers and final waves range from 2 to 10.
- All 26 pass the maintained `inspectReplay` path: no checkpoint divergence, no
  stored-summary differences, and exact agreement with the recorded final tick.
- There are 168 completed-wave cards and 26 partial terminal-wave cards.

This covers the current retained operator inventory, not deleted or expired history.
There are no wave-11 recordings in this corpus. The results are repeated observations
of one player's play across builds, not independent samples of general player skill.

## The last completed wave usually earns the most

| Question                                                                                                   | Result             |
| ---------------------------------------------------------------------------------------------------------- | ------------------ |
| Last completed wave has the highest score, including the partial fatal wave                                | 23/26 runs (88.5%) |
| Last completed wave leads among completed waves after subtracting wave-clear and building-survival bonuses | 21/26 runs (80.8%) |
| Explicit wave-clear and building-survival bonuses as a share of completed-wave earnings                    | 53.2%              |
| Pearson correlation of final score with final wave, pooled across builds                                   | 0.9534             |

Highest-score comparisons include ties. The three exceptions to the first result
peak on earlier completed waves, not their fatal wave. One recording only completes
wave 1, so its completed-wave-only ranking is trivial; excluding it gives 22/25 and
20/25 respectively. No conclusion about shooting skill follows from these ranks alone.

The bonus subtraction uses the actual recorded/reconstructed surviving buildings
on each completed-wave card: 250 × wave plus 100 × buildings × wave. The 53.2% figure
is a pooled point-weighted share, not an average of individual percentages. Remaining
points still combine player and automated kills, combo uplift, multi-kill bonuses
and any penalties. They are not a player-skill score.

The original score calculation and battle state remain unchanged. This initial
comparison uses reconstructed wave summaries and arithmetic bonus subtraction,
not new scoring logic or a source-attributed kill ledger.

## A concrete example

In the newest recording that reaches wave 10:

| Completed wave | Points earned | Threats destroyed | Maximum combo |
| -------------- | ------------- | ----------------- | ------------- |
| 3              | 8,190         | 16                | 10            |
| 6              | 11,630        | 46                | 8             |
| 9              | 20,008        | 88                | 4             |

Wave 9 earns over twice wave 3's points despite a lower maximum combo. This is a
clear illustration of the score/precision distinction, not proof wave 3 was played
better: maximum combo is only one signal, and later threats and builds differ.

## Consequences for the study

The user's observed pattern is supported. Completion bonuses make a large direct
contribution, but removing them alone does not remove the late-wave dominance.
Next, attribute kill rewards to player versus automated sources, compare shooting
quality in matched opportunities, and assess whether late-wave timing decisions can
materially improve survival within the same build.

Keep ranking points and shop purchasing behavior separate during experiments. The
current corpus uses draft mode; the generic paid-shop concern must not be mistaken
for evidence that purchases reduced scores in these particular runs.

Private reproducibility artifacts are under ignored
`operator-results/scoring-study-20260915/`: the complete inventory, detail/replay
pairs, retrieval manifest, inspection script and per-run inspection results. Files
containing capture data use mode 0600 inside a mode-0700 directory. The operator
credential is not persisted in these artifacts or this report.
