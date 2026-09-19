"""Independent Part Six arithmetic from raw ledgers; no JS rule imports or derived inputs."""
import json, hashlib, math
from pathlib import Path

root = Path('operator-results/scoring-study-20260915')
load = lambda p: json.loads(p.read_text())
data = load(root / 'player-only/analysis.json')
PLAYER = {'player', 'f15', 'emp', 'flare'}
AUTO = {'hornets', 'roadrunner', 'patriot', 'ironBeam', 'phalanx'}
COMBOS = {'C10': (10, None), 'C5-0': (5, 0), 'C5-150': (5, 150), 'C5-350': (5, 350), 'C5-500': (5, 500), 'C5-700': (5, 700)}

wave_checks = 0
building_checks = 0
source_totals = {}
streaks = []
for run in data['runs']:
    events = load(root / ('quality/' + run['label'] + '-events.json'))
    combo = {k: 1 for k in COMBOS}
    got = {}
    lost, clear, bld = {}, {}, {}
    streak = 0
    for e in events:
        w = e['wave']
        row = got.setdefault(w, {f'{o}|{c}': 0 for o in ('today', 'P') for c in COMBOS})
        if e['type'] == 'asset_damage':
            lost[w] = lost.get(w, 0) + e['buildings']
        if e['type'] == 'reward' and e['kind'] == 'wave_clear':
            clear[w] = clear.get(w, 0) + e['amount']
        if e['type'] == 'reward' and e['kind'] == 'building_bonus':
            bld[w] = bld.get(w, 0) + e['amount']
        if e['type'] == 'combo':
            productive = e['reportedRootKills'] >= 1
            if productive:
                streak += 1
            else:
                if streak:
                    streaks.append(streak)
                streak = 0
            for k, (cap, bonus) in COMBOS.items():
                c = combo[k]
                if not productive:
                    combo[k] = 1
                elif bonus is None:
                    combo[k] = min(cap, c + 1)
                elif c == cap:
                    combo[k] = 1
                    for o in ('today', 'P'):
                        row[f'{o}|{k}'] += bonus
                else:
                    combo[k] = c + 1
            assert combo['C10'] == e['after']
        elif e['type'] == 'reward':
            kind = e['kind']
            if kind == 'kill':
                src = e['source']
                assert src in PLAYER or src in AUTO or src == 'impact'
                assert e['combo'] == combo['C10'] and e['amount'] == e['base'] * e['combo']
                t = source_totals.setdefault(src, [0, 0])
                t[0] += e['base']
                t[1] += e['amount'] - e['base']
                for k in COMBOS:
                    pts = e['base'] * combo[k]
                    row[f'today|{k}'] += pts
                    if src in PLAYER:
                        row[f'P|{k}'] += pts
            else:
                assert kind in ('multi', 'wave_clear', 'building_bonus', 'friendly_fire')
                for key in row:
                    row[key] += e['amount']
    if streak:
        streaks.append(streak)
    for w in run['waves']:
        for key, value in got[w['wave']].items():
            assert math.isclose(value, w['scores'][key], abs_tol=1e-9), (run['label'], w['wave'], key)
            wave_checks += 1
        assert got[w['wave']]['today|C10'] == w['original']
    alive = 10
    for w in run['waves']:
        alive -= lost.get(w['wave'], 0)
        assert alive == w['alive'] and lost.get(w['wave'], 0) == w['buildingsLost']
        assert clear.get(w['wave'], 0) == w['waveClear'] and bld.get(w['wave'], 0) == w['buildingBonus']
        if not w['terminal']:
            assert w['waveClear'] == 250 * w['wave'] and w['buildingBonus'] == 100 * alive * w['wave']
        building_checks += 1
    assert alive == run['buildingsAtEnd'] and run['buildingsTimeline'] == [w['alive'] for w in run['waves']]
    for key, total in run['scores'].items():
        assert math.isclose(sum(got[w]['%s' % key] for w in got), total, abs_tol=1e-9)
    assert sum(got[w]['today|C10'] for w in got) == run['original']

rank_checks = 0
for s in data['summaries']:
    for run in data['runs']:
        v = run['scores'][s['id']]
        higher = sum(r['scores'][s['id']] > v for r in data['runs'])
        ties = sum(r['scores'][s['id']] == v for r in data['runs'])
        assert 1 + higher + (ties - 1) / 2 == run['ranks'][s['id']]
        rank_checks += 1
    assert math.isclose(sum(r['scores'][s['id']] for r in data['runs']), s['total'], abs_tol=1e-9)

for s in data['sources']:
    assert source_totals[s['source']] == [s['base'], s['uplift']], s['source']
bucket = lambda n: '20+' if n >= 20 else '10-19' if n >= 10 else '5-9' if n >= 5 else str(n)
hist = {}
for n in streaks:
    hist[bucket(n)] = hist.get(bucket(n), 0) + 1
assert hist == data['totals']['streaks']
t = data['totals']
assert t['waveClear'] + t['buildingBonus'] == t['bonuses']
assert t['buildingsLost'] == sum(10 - r['buildingsAtEnd'] for r in data['runs'])

digests = load(root / 'player-only/input-digests.json')
for path, digest in digests.items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, path
result = {
    'waveScenarioChecks': wave_checks,
    'runRankChecks': rank_checks,
    'sources': len(data['sources']),
    'streaks': len(streaks),
    'buildingWaveChecks': building_checks,
    'unchangedInputs': len(digests),
}
(root / 'player-only/crosscheck.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
