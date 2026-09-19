# Replay study: does score reward shooting skill?

Date: 2026-09-15. Updated 2026-09-16: parts one and two verified; part three measurements verified, with nine user labels and the defense-first criterion recorded; no skill ranking validated. Part four is now complete as an observational analysis; part five is complete as a fixed-event scoring experiment; part six has not started. See [scoring alternatives](scoring-rescoring-results.html). See [matched progression results](scoring-progression-results.html).

Latest evidence: [26-run live corpus findings](scoring-replay-initial-findings.md).
The live retrieval update below supersedes the initial access blocker.
This is an analysis plan, not a scoring redesign or a roadmap status change.

Latest scoring clarification (2026-09-18): survival already rewards better defense
through continued play; scoring should reward better skill. Earlier protection-based
comparisons remain context, not the criterion for selecting a skill-scoring formula.
Which skilled choices and execution should distinguish equally surviving runs is open.

User clarification: genuine Staging play sessions are all the user's; retrieve all
available sessions and retain the automated-test exclusions. Scope also includes
the reported wave-10/11 difficulty wall and whether threat overlap crowds out timing
skill in favor of builds and active weapons.

## Initial evidence

Inspected 72 local replay payloads across `replays/`, `diag-results/`, and the
September 4 Staging replay backup. There were 72 distinct combinations of build,
seed, final tick and actions. Of these, 51 identify HeadlessChrome in their capture
environment; exclude them from claims about the user's play even though they say
`isHuman: true`. The other 21 are candidate human runs; the user confirms genuine Staging play is theirs.

The 21 candidates span five build identifiers, waves 5–10, and scores 26,344–119,848.
All passed `src/headless/validate-replay.ts` against the current checkout, using
their recorded checkpoints. This is initial compatibility evidence; the study must
also verify final summaries, termination, and action consumption explicitly.

Across these 21 records, Pearson correlation between stored score and final wave
is **0.9535**. Wave-8 scores range from **53,912 to 74,056**. These are pooled,
exploratory observations: build, upgrades, seed and survival differ. They do not
establish how well anyone shot or which scoring component caused the correlation.

Live Staging inventory was attempted using the existing read-only D1 query helper.
The initial attempt hit a Wrangler log permission error; attempts with a writable
log location failed both inside the sandbox and with escalation, without useful
diagnostics. No live results were retrieved. This local backup is not an exhaustive
or current corpus. Production has no usable database ID in checked-in configuration.
Subsequent log inspection identified HTTP 400 while refreshing the Cloudflare OAuth
token. The user has been asked to complete `npx wrangler login` before retrieval resumes.

## What scoring actually does

- Base kill awards: ordinary missile 28; drones 20/40; MIRV 100; bomb 42;
  MIRV warhead and stack2 56; stack3 72 (`getKillReward`).
- Kill paths multiply these awards by the shared combo, including automated kills.
- A player root explosion with at least one kill increments combo by one, capped
  at 10; an empty resolved player root resets it to 1. Normal resolution happens
  when the explosion expires, with special handling at wave completion.
- Root multi-kills award 150/350/700 for two/three/four-plus kills. The award itself
  is not restricted to player explosions, although the `multiShots` statistic is.
- Wave completion adds 250 × wave. Building survival adds 100 × surviving buildings
  × wave through the bonus flow. Direct friendly F-15 hits subtract 500.
- Shop purchases subtract from the same `score` field. Final score is therefore
  affected by spending as well as earning; inspect free/draft purchases separately.
- Displayed hit ratio is capped total kills / shots fired, including automation.
  It cannot serve as independent evidence of player accuracy.

The user's incentive concern is supported by these rules: at ×10, another successful
shot cannot raise combo, while an empty blast can reduce rewards on future automated
kills. An automated kill does not itself consume combo; the problem is the shared
benefit combined with the player's asymmetric risk.

## Study sequence

### 1. Establish the complete, attributable corpus

Restore working authenticated read access, then page through every available
session and fetch every eligible replay. Include existing local exports and
diagnostic replay payloads; keep unavailable, expired, omitted and malformed counts.
The user confirmed genuine Staging play is theirs; exclude automated tests.
Use installation provenance privately where needed; do not infer identity from score.

Keep raw captures and private run links in ignored, restricted local artifacts.
Publish only anonymous run labels and aggregates. Deduplicate using payload hashes
and action/build signatures, retaining provenance and identifying overlapping exports.
Separate human, bot, headless tests, debug starts, abandoned runs and uncertain cases.
Inventory build, rules, platform, input, draft mode, initial state, duration, seed,
checkpoints, summary availability and outcome. Small or incomplete runs are labelled,
not silently discarded because their scores are inconvenient.

### 2. Reconstruct the baseline before judging it

Use the maintained replay runner and bonus/shop transitions. Require checkpoint
agreement, expected termination/final tick, recorded action consumption and matching
final score/wave/stats. Quarantine mismatches with an explicit reason; do not suppress
verification or treat replay-format equality as proof of simulation compatibility.

Add a read-only event ledger covering every score credit/debit and threat destruction.
Track shot identity, player/automatic/active source, chain root, threat type, damage
assists, combo before/after, wave, tick, purchases and bonuses. Audit all kill paths:
explosions, hornets, roadrunners, beam, Phalanx, Patriot, EMP and F-15. Boolean
`playerCaused` alone is not enough for detailed ownership. Preserve uncertain assists.

Reconcile the ledger exactly to original score, including purchases and penalties.
Report gross earnings and remaining balance separately. Verify that instrumentation
does not change RNG, checkpoints, actions, damage, purchases or terminal outcome.

### 3. Describe good shooting without using score as the answer

Measure successful player shots / resolved player shots, kills and base threat value
per shot, multi-kill distribution, empty shots, repeated coverage, timely interceptions,
player/automation contributions and damage suffered. Keep unresolved terminal shots
separate. Account for opportunities: no shot can be sensible when defenses cover a lane.

Inspect 8–12 short, score-hidden clips spanning effective cluster shots, misses,
contested kills, sensible restraint, urgent saves and automation-heavy play. Record
timestamped judgments and confidence before calculating candidate rankings. Ask the
user to label a small ambiguous subset; their judgment anchors what “played well” means.
Do not equate low altitude with a save: whether automation would have intercepted
requires a separately labelled counterfactual, not a guess from the final kill owner.

### 4. Test how much progression explains

Break score into player base rewards, player combo uplift, automation base rewards,
automation combo uplift, multi-kills, wave/building bonuses, penalties and spending.
Compare runs through the same completed wave and within matching build/mode/loadout
groups where data allows. Treat incomplete final waves separately.

Report score/wave rank and linear correlations alongside within-wave variation and
associations with independently assessed shooting. Use simple progression baselines
and examine residuals, rather than fitting a complicated model to 21 runs. Account
for repeated waves from one run when estimating uncertainty. State sample sizes and
confounding explicitly; this corpus cannot establish population-wide skill rankings.

### 5. Rescore identical events with a small set of hypotheses

Keep original score driving simulation, shop affordability and replay verification.
Compute candidate scores in a separate ledger. Changing live `g.score` would change
the experiment's conditions. Any later separation of ranking points and shop currency
is a product decision, not something to slip into analysis instrumentation.

Compare current scoring against three initial families, choosing coarse parameter
ranges before evaluating held-out examples:

1. **Player-only combo uplift:** automation earns base value; player kills and their
   chains receive the precision multiplier. Test whether continuing to shoot has
   value and whether contested kills still make misses unfairly punishing.
2. **Per-shot quality bonus:** reward productive shots and multi-kills independently
   of a persistent shared streak. Test reset, step-down and neutral handling of
   contested empty shots; check whether spamming cheap singles beats careful clusters.
3. **Base defense score plus player contribution bonus:** retain survival/defense
   value while adding bounded bonuses for productive shooting, chains and measurable
   assists. Only include “save” bonuses if causal evidence supports them.

Evaluate rank reversals against score-blind clip judgments, matched-wave separation,
automation-heavy runs, small aiming improvements, spam, idling at max combo and
last-hit stealing. Distinguish rules-based incentive arguments from observed replay
evidence. A missing shot or disabled defense changes the trajectory: any such test is
a separate counterfactual experiment, not rescoring the identical run.

Hold out whole runs (and builds where feasible), show parameter sensitivity, and
reject improvements that depend on one lucky run. Historical rescoring measures
rewards for existing behavior; it cannot prove how people will adapt to new incentives.

### Before Part Six: building targeting and impact audit (RM-09)

The [building-impact audit](building-impact-audit-results.html), inserted on 2026-09-19,
is complete for the available local corpus. Review its two reproduced defects and
coverage limits before returning to the scoring decision. No scoring or balance changes were made.

### 6. Return a decision, backed by examples

Deliver a corpus coverage report, reconciled baseline score breakdown, anonymous
run/wave comparisons, timestamped good/poor/ambiguous shooting examples, and a candidate
comparison showing who gains or loses points and why. Recommend one or two finalists
only when evidence supports them; otherwise specify the missing play situations.

Then agree on the desired survival-versus-shooting balance and ranking/economy
relationship before implementation. A small interactive feel-check must confirm the
finalist encourages active, useful shooting without punishing sensible reliance on
upgrades. No gameplay scoring changes are part of this planning task.

## Parallel question: does late-wave difficulty suppress skill?

Study this alongside scoring, but keep its causal experiments separate. Changing
spawn patterns changes the battle, so old recorded shot coordinates cannot fairly
evaluate a new encounter as though the player had seen and reacted to it.

Initial code evidence: `getWaveConfig` in `src/wave-spawner.ts` increases late-wave
budget and concurrent threat-value capacity with nonlinear terms. `SATURATION`
can raise the concurrent cap by another 18%, bounded by budget. This cap measures
weighted threat value, not a literal count of rockets. The spawner already has
threat mixes, tactics and set pieces; inspect why their timing does or does not
produce distinct decisions before proposing more types.

For waves 7–11 and each terminal lead-in, record:

- Concurrent threat count and value, peak and sustained overlap, simultaneous
  impact deadlines, lanes, speeds and opportunities to kill clusters with one shot.
- Available firing charges, recharge windows, live launchers, upgrades, surviving
  sites, active readiness/cast timing, and damage events on the same timeline.
- Time spent capacity-limited versus shots withheld while capacity was available.
  Separate arriving overload from earlier misses or lost defenses that caused it.
- Decision windows: how long a useful aim point remains viable, whether a short
  wait improves a cluster shot, and whether that wait risks an unavoidable impact.

Compare matched build/loadout wave segments and distinguish three possible failure
patterns: recoverable aiming/timing mistakes, strategically weak defense coverage,
and incoming demand exceeding available response capacity. Inspect earlier choices
before labelling the final seconds unavoidable. The local corpus ends at wave 10,
so wave-11 conclusions require newer data or explicitly labelled new experiments.

After baseline analysis, test bounded hypotheses: stagger impact deadlines; alternate
pressure bursts with useful recharge opportunities; vary compositions and trajectories
while constraining sustained overlap. Keep total threat budget fixed in one experiment
and peak pressure fixed in another to isolate timing from sheer reduction in difficulty.

Use paired seeds/loadouts and controlled shot-timing perturbations or policies for
mechanical sensitivity checks. A bot or oracle is only a capacity benchmark, not a
human skill verdict. Resume actual player runs from suitable states for later feel-checks
if supported, or play new matched scenarios; label all changed-input/spawn branches
as counterfactuals. Do not pass their divergence off as replay verification success.

The desired evidence is that better timed, readable decisions materially improve
survival within the same build, and that spending the active early does not routinely
remove every viable response later. Preserve meaningful build choices and escalating
challenge. Report the shooting/build/active tradeoffs instead of promising every build
can beat every wave. Recommend scoring and difficulty changes together only after
showing which problem each change addresses.

## Additional hypothesis: the last completed wave usually scores highest

For every verified run, identify the highest-earning wave, including ties, and whether
it is the last completed wave. Compare complete waves separately from the truncated
terminal wave. Repeat after removing explicit completion/building bonuses, then after
separating player and automation earnings. Compare per-shot quality and threat
opportunities rather than expecting low-volume early waves to earn the largest totals.
The target is a meaningful premium for exceptional play in comparable conditions,
not forcing early waves to win the score ranking.

Live retrieval update: the user supplied and confirmed an operator bearer. All 26
sessions in the current Staging operator inventory were retrieved, with 26 available
replays and their detail summaries. Pagination completed with no next cursor. Raw
artifacts live in ignored `operator-results/scoring-study-20260915/`; the credential
is not saved there. This resolves the Wrangler-login retrieval blocker. It establishes
coverage of the current operator API inventory, not of expired or deleted history.
