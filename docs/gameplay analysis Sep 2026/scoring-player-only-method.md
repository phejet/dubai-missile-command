# Part six — player-only points and combo cash-out

Specification frozen before calculation on 2026-09-19. Analysis only; authorizes no
gameplay or scoring change.

## Why rescoring is exact here

All 26 recordings are draft mode (`draftMode: true`). Wave-end picks are free:
`buyDraftUpgrade` never reads or subtracts score, and no ledger contains a spending
event. Score is a pure output that never feeds back into the simulation, so rescoring
the recorded events gives the exact score each run would have had under the new
rules. No purchase or affordability caveat applies. (This corrects Part Five's note,
which said original points drove purchases.)

What rescoring cannot show is adaptation: these runs were played under today's
incentives, and players would change behaviour under new ones.

## Rule P — only player-initiated actions earn kill points

| Source in ledger                                                 | Owner     | Kill points  |
| ---------------------------------------------------------------- | --------- | ------------ |
| `player` — interceptor shots and their chain explosions          | player    | base × combo |
| `f15`, `emp`, `flare` — active abilities the player triggers     | player    | base × combo |
| `hornets`, `roadrunner`, `patriot`, `ironBeam`, `phalanx`        | automated | 0            |
| `impact` — a threat exploding on contact and catching neighbours | nobody    | 0            |

- Multi-kill bonuses stay at today's flat values (150 / 350 / 700) for **every**
  source, so a DOUBLE/TRIPLE/MEGA toast always pays. Reported per source.
- Wave-clear and building-survival bonuses and the F-15 friendly-fire penalty are
  unchanged. Unscored neutralizations stay unscored.
- Phalanx has zero kills in this corpus; its rule is stated for completeness.

## Combo rules

Combo triggers are unchanged: the recorded `combo` events, one per player-caused root
explosion (interceptor shots and some flare explosions). A trigger with at least one
root kill is productive; one with none is empty. Combo carries across waves.

- **C10 (today):** productive → min(10, c + 1); empty → 1.
- **C5·B (cash-out):** productive at c < 5 → c + 1; productive at c = 5 → pay a flat
  bonus B and reset to 1; empty → 1. Kills from the shot that triggers the cash-out
  score at ×5, because kills land before the explosion ends and the combo updates.
- B ∈ {0, 150, **350**, 700}. 150/350/700 reuse the existing double/triple/mega
  multi-kill values; 350 is the reference. B = 0 isolates the cost of the lower cap
  and reset alone.
- The combo multiplies every player-owned kill (including F-15, EMP and flare), as
  today. Automated kills earn zero regardless of combo.

## Scenarios

Point ownership {today: all sources, P: player-only} × combo {C10, C5·0, C5·150,
C5·350, C5·700} = 10 scenarios. Today × C10 must reproduce the recorded scores
exactly. Headlines: P × C10 (ownership alone) and P × C5·350 (both changes).
Values are fixed now; no tuning after results and no rescaling to preserve the old
point budget.

## Measures

- Per run: total, change, percentage change, rank and rank change; Spearman rank
  correlation with the original order.
- Points removed per source, split into base value and combo uplift; automated share
  of the original score.
- Per wave number: the same changes, plus score composition — interceptor base,
  interceptor combo uplift, active abilities, multi-kills by owner, survival bonuses,
  cash-out bonuses.
- Combo: multiplier at each player kill and at each shot; share of player kill points
  and shots at ×10; resets from ×5 or higher; resets caused by empty flare explosions;
  cash-outs per run and per wave.

## Verification

- Today × C10 reproduces every run total, every wave total, and every recorded kill's
  combo and every combo event's `after` value.
- Hand-worked rule cases for ownership, multi-kill, cash-out timing and resets.
- Independent Python reimplementation of all 10 scenarios per run and wave.
- SHA-256 digests of every consumed input unchanged after analysis.
- Browser check of the report's controls at desktop and 390px widths.

## Added after the first calculation

These were added after the scenario totals were known:

- Cash-out B = 500, added at the user's request (2026-09-19) after seeing the results.
  It is not a preselected value; the other scenarios are unchanged.

- Why each empty combo trigger was empty: the shot's intended target was destroyed
  first by automation, by another player shot, by an ability or impact, or not at all
  (from `quality/shots.json` contested overlap), plus empty flare explosions.
- Streak lengths (consecutive productive triggers) and a worked streak example at the
  corpus-average base value per productive shot.
- Same-wave rank agreement among runs that completed each wave.
- Survival split (user request, 2026-09-19): wave-clear bonus (250 × wave) and
  building bonus (100 × buildings standing × wave), each verified against its formula
  on every completed wave. Buildings standing = 10 minus logged `asset_damage`
  building losses; this reproduces all 168 recap counts and gives the end-of-run count
  that the recap does not record for the final wave. Building bonus lost to damage =
  100 × (10 − standing) × wave per completed wave.
- The rule-1 total without the multi-kill exception, derived as P × C10 minus
  automated and impact multi-kill bonuses.

## Reproduction

From the repository root, with the ignored corpus in
`operator-results/scoring-study-20260915/`:

```bash
node scripts/scoring-study/player-only-checks.mjs
node scripts/scoring-study/player-only-analysis.mjs
python3 scripts/scoring-study/player-only-crosscheck.py
node scripts/scoring-study/player-only-report.mjs
node scripts/scoring-study/verify-player-only.mjs   # needs Vite on port 5173
```

Outputs go to `operator-results/scoring-study-20260915/player-only/`; the anonymous
report is [scoring-player-only-results.html](scoring-player-only-results.html).
