# Part three: shooting quality independent of score

Date: 2026-09-15. Authorized scope: part three of the replay study. No scoring,
spawn, counterfactual or progression-comparison experiment. No run ranking yet. Measurements and browser checks are verified; user labels on clips 01, 03 and 05 remain pending.

## Definitions fixed before selecting clips

- A **resolved shot** has lost its projectile and all observed descendant explosions
  through normal expiry. Boundary-cleared and terminal-active shots remain separate,
  including productive shots in those groups. Root combo resolution alone is insufficient
  because descendants can still kill after the root expires.
- A **successful shot** produces at least one actual damaging contribution. Report
  final-kill-producing shots separately. Success / resolved shots uses only resolved
  shots in both numerator and denominator.
- Kills and base threat value per resolved shot exclude combo and bonuses. Base value
  is the game's existing threat weighting, not an independently established difficulty
  weighting. Report counts alongside it. Show the 0/1/2/3/4+ kill distribution.
- **Repeated coverage** means two simultaneously live manual interceptors share an
  intended-target reference captured by the game's real firing function. This is an
  overlap observation, not proof a shot was unnecessary. Lead shots may have no intended
  target at launch and still work.
- **Contested empty shots** are resolved non-damaging shots whose intended target was
  killed by another source between launch and resolution. Separate other manual shots,
  upgrade systems and impact effects. Do not call every other-source kill a stolen kill.
- **Urgent interceptions** use the maintained `predictBurjImpactTicks` immediately
  before a damaging hit, with a 60-tick horizon. This is a current-course projection
  excluding defenses and structural shadowing. It is not a proved save or actual
  remaining lifetime; flare-controlled threats return null, and EMP can alter wall time.
- **Damage suffered** measures observed Burj HP reductions, destroyed buildings/sites
  and launcher HP reductions per wave. Do not infer blame from temporal proximity.
- **Opportunity context** samples every active combat tick, before recorded actions:
  live threats, ready firing charges (using a cloned fire-charge state), live launchers,
  active manual projectiles, upgrade ownership, active readiness and current damaging
  explosions covering threats. Exclude shop, wave-clear and post-destruction time.
  A ready charge plus a threat is not proof that shooting is sensible.
- **Restraint candidates** are at least one second without manual fire while threats
  and firing capacity are present. Distinguish intervals in which actual upgrade kills
  occurred with no asset damage. This is observed safe withholding, not inferred intent
  or proof every lane was guaranteed covered.

## Clip sampling and judgment

Select ten non-overlapping 6–10-second segments using event categories, never final
score or score rank. Seek diversity across recordings and early/late waves:

- Two productive cluster-shot examples.
- Two empty-shot examples, including one with no observed contest if available.
- Two contested/repeated-coverage examples.
- Two withholding/upgrade-heavy examples.
- Two projected urgent-interception or damage-pressure examples.

Use the original replay runner and Pixi battlefield renderer. Show manual shot taps,
charge availability, active readiness and asset condition; suppress score, combo,
multi-kill reward labels and aggregate run outcomes. No audio. Selection categories
and candidate metrics are hidden during initial viewing. Clips retain their original
recorded actions and simulation state; no changed-input branch is introduced.

Record timestamped judgments with confidence before constructing any candidate ranking.
Rubric: productive timing/placement; apparently wasteful; sensible withholding;
ambiguous/needs more context. Describe what is visible separately from inferred intent.
Ask the user to judge three ambiguous clips with these same labels and a short reason.
Store their labels separately from agent judgments. Until that human input arrives,
part three is ready for review, not validated as a model of player skill.

## Verification and delivery

Reuse exact baseline checkpoint, summary, action-consumption and state-sample gates.
Add controlled tests for full descendant expiry, boundary/terminal censoring, repeated
intended targets, a competing kill and read-only charge projection. Keep part-two
outputs intact under `attribution/`; write new artifacts under `quality/`.

Deliver an HTML clip-review surface plus descriptive metrics and explicit denominators.
No score association or ranking belongs in this step. Keep the local server running.
