"""Independent event-to-wave arithmetic; no JS rule imports or derived component inputs."""
import json, hashlib, math
from pathlib import Path
root = Path('operator-results/scoring-study-20260915')
load = lambda p: json.loads(p.read_text())
data = load(root / 'rescoring/analysis.json')
count = 0
for run in data['runs']:
    events = load(root / ('quality/' + run['label'] + '-events.json'))
    seen = {}
    expected = {w['wave']: {v['id']: 0.0 for v in data['variants']} for w in run['waves']}
    manual, base = {}, {}
    for e in events:
        if e['type'] != 'reward':
            continue
        w = e['wave']; k = e['kind']
        if k == 'kill':
            base[w] = base.get(w, 0) + e['base']
            credit = e['base'] * sum(c['damage'] for c in e['contributors'] if c['source'] == 'player') / sum(c['damage'] for c in e['contributors'])
            manual[w] = manual.get(w, 0) + credit
            n = seen.get(e['shotId'], 0)
            for v in data['variants']:
                val = e['base']
                if e['source'] == 'player':
                    if v['family'] == 'A': val += v['alpha'] * (e['amount'] - e['base'])
                    if v['family'] == 'B': val += v['productive'] if n == 0 else v['extra'] if n < 4 else 0
                expected[w][v['id']] += val
            if e['source'] == 'player': seen[e['shotId']] = n + 1
        else:
            for v in data['variants']:
                if k != 'multi' or (v['family'] == 'A' and e['source'] == 'player'):
                    expected[w][v['id']] += e['amount']
    for w in run['waves']:
        for v in data['variants']:
            val = expected[w['wave']][v['id']]
            if v['family'] == 'C': val += min(manual.get(w['wave'], 0), v['cap'] * base.get(w['wave'], 0))
            assert math.isclose(val, w['scores'][v['id']]['net'], abs_tol=1e-8)
            count += 1
    for v in data['variants']:
        total = sum(w['scores'][v['id']]['net'] for w in run['waves'])
        assert math.isclose(total, run['scores'][v['id']]['net'], abs_tol=1e-8)
        rank = 1 + sum(r['scores'][v['id']]['gross'] > run['scores'][v['id']]['gross'] for r in data['runs'])
        ties = sum(r['scores'][v['id']]['gross'] == run['scores'][v['id']]['gross'] for r in data['runs'])
        assert rank + (ties-1)/2 == run['scores'][v['id']]['rank']
for p in data['pairs']:
    def wave(label): return next(w for r in data['runs'] if r['label'] == label for w in r['waves'] if w['wave'] == p['wave'])
    a,b = wave(p['better']),wave(p['worse'])
    assert a['original']-b['original'] == p['original']
    for v in data['variants']: assert math.isclose(a['scores'][v['id']]['net']-b['scores'][v['id']]['net'],p['scores'][v['id']],abs_tol=1e-8)
digests = load(root / 'rescoring/input-digests.json')
for path, digest in digests.items(): assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest
result = {'waveVariantChecks':count, 'runRankChecks':len(data['runs'])*len(data['variants']), 'strictPairs':len(data['pairs']), 'unchangedInputs':len(digests)}
(root / 'rescoring/crosscheck.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
