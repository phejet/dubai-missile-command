# Part five — fixed-event scoring experiment

Specification frozen before candidate calculation on 2026-09-18. Supports RM-08
replay inspection; authorizes no gameplay/economy change and closes no release gate.
The original analysis used preventing threats reaching targets as its criterion.

**Subsequent user clarification (2026-09-18):** survival already rewards better defense
through continued play; scoring should reward better skill. The protection comparisons
remain descriptive context, not a validated skill criterion. Formulas and calculations
below are unchanged. Which skilled choices/execution should distinguish equally
surviving runs remains to be defined.

## Fixed inputs and accounting

Use all 26 verified quality event ledgers and the original baseline summaries.
Hash replay payloads, event ledgers and supporting inputs before and after analysis.
Reconcile original reward sums and per-wave totals, kill/shot counts and prior
baseline/observed summaries. Do not run candidate formulas inside the simulation.
Original points alone drove every recorded purchase and outcome.

All candidates retain base value for every scored kill, original wave/building
bonuses, friendly-fire penalties and spending. Unscored neutralizations stay unscored.
Report gross positive earnings and net after original debits separately. Alternative
net balances are hypothetical accounting, not evidence of alternative affordability.
No candidate invents a save bonus. Defense value here is the existing survival bonus,
not a newly validated measure of all assets protected.

## Candidate families and preselected ranges

A. **Player-only combo:** base + original bonuses/debits + player-origin multi-kill
awards + alpha × original player kill combo uplift. Alpha = 0.5, **1**, 1.5.
Automation and impact kills receive base only (including removal of their multi-kill
awards). Original combo timing/reset rules remain; this changes who benefits, not
how the multiplier evolves. Active EMP/F-15 are non-manual for this experiment.

B. **Per-shot rewards:** base + original bonuses/debits + P for each manual shot
with at least one credited kill + M × min(3, kills−1) for that shot's extra kills.
(P,M) = (25,50), **(50,100)**, (100,200). Replace all original combo/multi awards.
Count the entire observed shot lineage, including chains. Award incrementally at
kill time, so terminal unresolved shots receive only earned observed bonuses and
wave boundaries cannot move points backwards. Empty and contested empty shots have
zero direct reward or penalty; no persistent streak. Reset/step-down variants would
reintroduce state and are excluded explicitly, not silently scored as neutral.

C. **Defense plus bounded contribution:** base + original bonuses/debits +
min(manual damage credit, c × all scored-kill base value), separately per wave.
c = 0.25, **0.5**, 1. Manual credit for each killed target is base value × manual
applied damage / total applied damage in its recorded contributor history. Includes
manual chain damage and assists to automated last hits, not damage to surviving or
unscored targets. Replace all original combo/multi awards. Keep fractions until
presentation; no rounding in the experiment. This is an attribution proxy, not
causal prevention. The cap grows with threat value, not number of shots.

Bold values are reference settings, not fitted winners. Do not tune after observing
results. No rescaling to force candidates to match the original point budget.

## Comparisons and limits

Show every run's score change and relative rank, completed and terminal waves
separately, cumulative comparisons through the same completed wave, all 12 existing
strict loss-differing pairs and parameter sensitivity. Use gross earnings for rank;
show net balances separately. Show original automation dependence and cap saturation.

Predeclare run numbers divisible by four as a six-run sensitivity holdout; remaining
20 form the reference subset. Also summarize by build and leave each run out. All
runs were already inspected in earlier parts: this is not a genuinely unseen test,
and no formula is trained or selected on either subset. Do not claim validation.

Relate candidate rewards to the existing score-hidden clips and user labels without
projecting a focal action label onto a run. A ranking reversal is descriptive, not
an improvement in measured skill. Asset protection comparisons use Part Four's
strict matches and partial ordering; dependent pairs, differing seeds/combos and
sparse early-wave losses remain limitations.

Audit incentives with explicit algebraic toy examples: empty fire, four singles
versus one four-kill shot, last-hit transfer, max-combo restraint and cap saturation.
These are rule calculations, not changed-input replay experiments. Historical data
cannot establish behavior adaptation, the effect of a missing shot, or small aiming
improvements. Those require later controlled play; retain the recordings unchanged.

## Reproduction and observed results

From the repository root with the existing ignored corpus:

```bash
node scripts/scoring-study/rescoring-analysis.mjs
node scripts/scoring-study/rescoring-checks.mjs
python3 scripts/scoring-study/rescoring-crosscheck.py
node scripts/scoring-study/rescoring-report.mjs
node scripts/scoring-study/verify-rescoring.mjs
```

The last command needs local Vite on port 5173 and installed Playwright Chromium.
Outputs: ignored `operator-results/scoring-study-20260915/rescoring/`; the anonymous
HTML report is written beside this method. Source formulas live in
`scripts/scoring-study/rescoring-rules.mjs`.

Reference pooled point changes are A −18.2%, B −31.7%, C −36.8%. All 26 runs lose
raw points at every setting. Of the 12 existing strict loss-differing pairs, A favors
better protection in 11, B in 8 and C in 8 (original: 11). C's cap saturates in 123
of 194 wave records. None of this establishes a skill metric or a finalist.

No positive manual damage credit was observed on non-manual last hits. Assist
handling is therefore verified with controlled rule arithmetic, not evidence that
it improves credit allocation in these recordings. The 508 contested empty shots
are overlap measurements, not causal kill-stealing or waste classifications.

Verification: 11 rule cases; independent Python agreement on 1,746 wave/formula
values, 234 run ranks and all 12 pair differences; 60 consumed input digests unchanged.
These are ledger proofs, reusing the prior simulation verification. There is no
candidate simulation and no claim that altered scoring would reproduce purchases.
