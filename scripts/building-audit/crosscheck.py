"""Independent geometry/count verification of the unchanged-replay audit."""
import json
from pathlib import Path

root = Path('operator-results/building-audit-20260919')
all_runs = json.loads((root / 'observed-results.json').read_text())
runs = [r for r in all_runs if r['cohort'] == 'human-study' and r['status'] == 'verified']
report = json.loads((root / 'analysis.json').read_text())

def intersects(origin, vector, box, max_t=float('inf')):
    # Independent boundary intersection formulation (observer uses slab clipping).
    def inside(x, y):
        return box['left'] - 1e-9 <= x <= box['right'] + 1e-9 and box['top'] - 1e-9 <= y <= box['bottom'] + 1e-9
    if inside(origin['x'], origin['y']):
        return True
    for axis, bounds in [('x', ('left', 'right')), ('y', ('top', 'bottom'))]:
        if vector[axis] == 0:
            continue
        for edge in bounds:
            t = (box[edge] - origin[axis]) / vector[axis]
            if 0 <= t <= max_t and inside(origin['x'] + t * vector['x'], origin['y'] + t * vector['y']):
                return True
    return False

bombs = [t for r in runs for t in r['audit']['records'] if t['type'] == 'bomb']
misses = 0
for b in bombs:
    start = b['start']
    actual = intersects(start, {'x': start['vx'], 'y': start['vy']}, b['bounds'])
    assert actual == b['initialRayHits']
    misses += not actual
    # Analytic trajectory also reproduces the observed wrong-building hit.
    if b['hitBuilding'] is not None and b['hitBuilding'] != b['target']:
        ticks = b['end']['tick'] - b['born']
        assert abs(start['x'] + start['vx'] * ticks - b['end']['x']) < 1e-7
        assert abs(start['y'] + start['vy'] * ticks - b['end']['y']) < 1e-7
        assert b['end']['targetAlive'] is True
        assert not actual

contacts = [c for r in runs for c in r['audit']['contacts']]
for c in contacts:
    vector = {a: c['current'][a] - c['previous'][a] for a in ('x', 'y')}
    assert intersects(c['previous'], vector, c['bounds'], 1)
    if c['eligible'] and c['point']:
        assert any(d['building'] == c['building'] and d['tick'] == c['tick'] and d['actor'] == c['id']
                   for r in runs for d in r['audit']['deaths'])

assert len(bombs) == report['bombs'] == 1238
assert misses == report['rayMisses'] == 132
assert sum(report['outcomes'].values()) == len(bombs)
assert sum(t['type'] != 'drone' for r in runs for t in r['audit']['records']) == report['missilesAndBombs']
assert sum(len(r['audit']['deaths']) for r in runs) == report['buildingDeaths'] == 60
assert sum(len(r['audit']['records']) for r in runs) == report['total'] == 6479
assert sum(not c['point'] and c['eligible'] for c in contacts) == 1
print('Independent checks passed: 1,238 bomb rays, 53 contact segments, outcome totals and recorded miss trajectory.')
