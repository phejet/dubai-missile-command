# Part four — matched progression and defense outcomes

Authorized 2026-09-16. Primary question: does better protection earn more score under
comparable conditions? This is observational analysis of the existing 26 verified
recordings, not a skill ranking, rescoring or gameplay experiment.

## Measures fixed before comparison

- Defense: Burj HP lost, buildings destroyed, launcher HP lost and defense sites
  destroyed. Keep the four measures separate. A Pareto-better outcome has no greater
  loss on any of the four and strictly less on at least one; mixed outcomes are
  incomparable. These are observed asset losses, not a count of all arriving threats.
- Rewards: complete-wave total, explicit wave/building bonuses, and combat earnings
  after removing those bonuses. Preserve manual base/uplift/multi versus other-source
  attribution from part two. No spending or penalties occurred in this corpus.
- Shooting context: resolved-shot damage success, kills/shot, manual/upgrade kill
  counts and EMP/F-15 casts. They explain behavior, not independently validated skill.
  Sparse clip labels are not assigned to whole waves or used as training targets.
- Cumulative comparisons stop after the same completed wave, before any terminal
  partial wave. Single-wave comparisons use all earnings attributed to that wave,
  including its existing bonus/shop boundary. Terminal waves are described separately.

## Matching tiers

1. Same completed wave and draft mode: broad exposure-aligned description.
2. Same wave, captured build and draft mode.
3. Same wave/build/mode and exact owned upgrade nodes at wave start.
4. Tier 3 plus exact starting Burj HP, per-launcher HP, per-building alive state,
   per-site alive state and meta-progression. This is the strictest available match.

Use recorded build identities, but publish anonymous build labels. Same build and
loadout do not mean same spawn sequence, commander history or starting combo. Report
seed/encounter differences and remaining state differences rather than treating any
pair as a controlled experiment. Explicitly show late-wave coverage at each tier.

Extract start contexts through the unchanged replay runner. Check all recorded
checkpoints, action consumption and final summary against the previously verified
baseline. Reconcile score credits per wave and cumulative boundaries.

## Progression and association

Report final score versus final wave Pearson and tie-aware Spearman correlations.
Fit only a simple one-predictor linear progression baseline. Report fitted R-squared,
leave-one-run-out predictive R-squared and residuals as descriptions; explained
variation is not a causal percentage attributable to progression.

Within completed-wave strata, examine score versus each asset-loss measure and shot
success. Residualize both variables by their matched-group means before correlating;
report usable rows/groups/runs and zero-variation cases. Compute total and combat-only
results, since the building bonus mechanically rewards preserved buildings.

Enumerate Pareto-comparable outcome pairs within each tier: did the better-protected
run receive higher, equal or lower score? Report both total and combat-only rewards.
Pairs share runs and are not independent trials. Match coverage and loss ties matter.

For uncertainty, resample whole run blocks, not individual waves. Use 1,000 fixed-seed
bootstrap resamples for within-group correlation sensitivity only where at least eight
runs contribute; report valid draws and the 2.5–97.5 percentile range. This describes
sampling sensitivity within this small one-player corpus, not a population skill CI.
Also use leave-one-run-out ranges to expose dependence on one run. Do not claim causal
or statistically conclusive relationships from a small or predominantly wave-one match.

## Delivery

A fourth self-contained HTML report in `docs/gameplay analysis Sep 2026/`, with match
coverage, progression baseline, same-completed-wave comparison, anonymous matched
examples and explicit remaining confounding. Private data and generated proof stay in
`operator-results/scoring-study-20260915/progression/`. No commit/push without a new request.

## Results and evidence

- 26 context runs pass original replay checkpoint, final-tick, action-consumption and
  maintained summary checks; completed-wave boundary balances reconcile to the ledger.
- 168 completed-wave records and 26 terminal records are kept separate.
- Strict match coverage: 11 groups, 41 records, 20 runs, waves one–four. Of 111 pairs,
  99 tie on asset losses and 12 have a better/worse protection ordering; those 12 are
  entirely waves one–two and reuse five worse-outcome runs. None contains an active cast.
- Fitted progression R² 0.909; leave-one-run-out predictive R² 0.879. Strict Burj-loss
  versus total-point residual r = -0.227, with run-resampling range -0.684 to +0.278
  (979 valid draws). This does not establish a reliable protection-score relationship.
- Statistical checks plus independent Python algebra verify match coverage, progression
  fit and all 40 stratified associations. Outcomes with constant values have undefined
  correlations; bootstrap valid-draw counts and damage-bearing run counts remain visible.

The report includes score-disagreement, bonus-reversal and agreement examples. Selection
illustrates mechanisms and remaining confounding; it is not a representative sample or
an estimate that 11/12 independent attempts would favor protection. No score formula,
causal shot value or late-wave capacity verdict is selected from this evidence.
