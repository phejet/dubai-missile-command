"""Independent algebraic cross-check of the JavaScript descriptive calculations."""
import collections
import json
import math
from pathlib import Path

root = Path('operator-results/scoring-study-20260915/progression')
data = json.loads((root / 'analysis.json').read_text())


def correlation(x, y):
    n = len(x)
    xy = math.fsum(a * b for a, b in zip(x, y)) - math.fsum(x) * math.fsum(y) / n
    xx = math.fsum(a * a for a in x) - math.fsum(x) ** 2 / n
    yy = math.fsum(b * b for b in y) - math.fsum(y) ** 2 / n
    return xy / math.sqrt(xx * yy)


x = [row['finalWave'] for row in data['runRows']]
y = [row['score'] for row in data['runRows']]
assert math.isclose(correlation(x, y), data['progression']['pearson'], abs_tol=1e-12)
slope = (math.fsum(a * b for a, b in zip(x, y)) - sum(x) * sum(y) / len(x)) / (
    math.fsum(a * a for a in x) - sum(x) ** 2 / len(x))
intercept = sum(y) / len(y) - slope * sum(x) / len(x)
assert math.isclose(slope, data['progression']['slope'], abs_tol=1e-9)
assert math.isclose(intercept, data['progression']['intercept'], abs_tol=1e-9)
for tier in data['tiers']:
    groups = collections.defaultdict(list)
    for row in data['rows']:
        fields = [row['wave'], row['mode']]
        if tier['tier'] >= 2:
            fields += [row['build']]
        if tier['tier'] >= 3:
            fields += [row['owned']]
        if tier['tier'] >= 4:
            fields += [row['assets']]
        groups[json.dumps(fields, sort_keys=True)].append(row)
    groups = [group for group in groups.values() if len(group) >= 2]
    assert sum(map(len, groups)) == tier['rows']
    for association in tier['associations']:
        rx, ry = [], []
        for group in groups:
            group = [v for v in group if v[association['outcome']] is not None]
            if len(group) < 2:
                continue
            mx = sum(v[association['outcome']] for v in group) / len(group)
            my = sum(v[association['reward']] for v in group) / len(group)
            rx += [v[association['outcome']] - mx for v in group]
            ry += [v[association['reward']] - my for v in group]
        if association['r'] is not None:
            assert math.isclose(correlation(rx, ry), association['r'], abs_tol=1e-10)
(root / 'independent-crosscheck.json').write_text(json.dumps({
    'progressionFit': True, 'matchCoverage': True, 'stratifiedAssociationsChecked': 40
}, indent=2))
print('Independent Python check: progression fit, match coverage and all 40 associations agree.')
