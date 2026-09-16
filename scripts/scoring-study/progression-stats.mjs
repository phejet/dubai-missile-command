// Small deterministic statistics helpers. No score-dependent selection.
export const sum = (xs, f = (x) => x) => xs.reduce((a, x) => a + f(x), 0);
export const mean = (xs) => sum(xs) / xs.length;
export function pearson(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = mean(x),
    my = mean(y);
  let xx = 0,
    yy = 0,
    xy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx,
      dy = y[i] - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null;
}
export function ranks(values) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const result = [];
  for (let i = 0; i < order.length; ) {
    let j = i + 1;
    while (j < order.length && order[j].v === order[i].v) j++;
    for (let k = i; k < j; k++) result[order[k].i] = (i + j - 1) / 2 + 1;
    i = j;
  }
  return result;
}
export const spearman = (x, y) => pearson(ranks(x), ranks(y));
export function fitLine(x, y) {
  const mx = mean(x),
    my = mean(y);
  const xx = sum(x, (v) => (v - mx) ** 2);
  const b = xx ? sum(x.map((v, i) => (v - mx) * (y[i] - my))) / xx : 0;
  return { intercept: my - b * mx, slope: b };
}
export function linearBaseline(rows, xKey, yKey) {
  const x = rows.map((r) => r[xKey]),
    y = rows.map((r) => r[yKey]);
  const fit = fitLine(x, y);
  const sst = sum(y, (v) => (v - mean(y)) ** 2);
  const estimates = rows.map((r, i) => {
    const keep = rows.filter((_, j) => j !== i),
      loo = fitLine(
        keep.map((v) => v[xKey]),
        keep.map((v) => v[yKey]),
      );
    return {
      label: r.label,
      observed: y[i],
      predicted: fit.intercept + fit.slope * x[i],
      looPredicted: loo.intercept + loo.slope * x[i],
      residual: y[i] - (fit.intercept + fit.slope * x[i]),
    };
  });
  return {
    ...fit,
    pearson: pearson(x, y),
    spearman: spearman(x, y),
    rSquared: sst ? 1 - sum(estimates, (r) => (r.observed - r.predicted) ** 2) / sst : null,
    looRSquared: sst ? 1 - sum(estimates, (r) => (r.observed - r.looPredicted) ** 2) / sst : null,
    estimates,
  };
}
export function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return [...groups.values()];
}
export function residualCorrelation(rows, key, outcome, reward) {
  const groups = groupBy(rows, key).filter((g) => new Set(g.map((r) => r.label)).size >= 2);
  const x = [],
    y = [];
  for (const g of groups) {
    const mx = mean(g.map((r) => r[outcome])),
      my = mean(g.map((r) => r[reward]));
    for (const r of g) {
      x.push(r[outcome] - mx);
      y.push(r[reward] - my);
    }
  }
  return {
    r: pearson(x, y),
    rows: x.length,
    groups: groups.length,
    runs: new Set(groups.flat().map((r) => r.label)).size,
    varyingGroups: groups.filter((g) => new Set(g.map((r) => r[outcome])).size > 1).length,
    nonzeroOutcomeRuns: new Set(
      groups
        .flat()
        .filter((r) => r[outcome] !== 0)
        .map((r) => r.label),
    ).size,
  };
}
export function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    idx = (a.length - 1) * p,
    i = Math.floor(idx);
  return a[i] + (a[Math.ceil(idx)] - a[i]) * (idx - i);
}
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function sensitivity(rows, key, outcome, reward) {
  const observed = residualCorrelation(rows, key, outcome, reward);
  const ids = [...new Set(rows.map((r) => r.label))];
  const loo = ids
    .map(
      (id) =>
        residualCorrelation(
          rows.filter((r) => r.label !== id),
          key,
          outcome,
          reward,
        ).r,
    )
    .filter((v) => v !== null);
  const rng = random(16092026),
    boot = [];
  if (observed.runs >= 8 && observed.r !== null) {
    const blocks = ids.map((id) => rows.filter((r) => r.label === id));
    for (let n = 0; n < 1000; n++) {
      const sample = [];
      for (let i = 0; i < ids.length; i++) sample.push(...blocks[Math.floor(rng() * ids.length)]);
      const value = residualCorrelation(sample, key, outcome, reward).r;
      if (value !== null) boot.push(value);
    }
  }
  return {
    ...observed,
    leaveOneRunOut: loo.length ? [Math.min(...loo), Math.max(...loo)] : null,
    bootstrapValid: boot.length,
    runResamplingRange: boot.length ? [quantile(boot, 0.025), quantile(boot, 0.975)] : null,
  };
}
export function pareto(a, b, keys) {
  const diffs = keys.map((k) => a[k] - b[k]);
  if (diffs.every((d) => d <= 0) && diffs.some((d) => d < 0)) return -1;
  if (diffs.every((d) => d >= 0) && diffs.some((d) => d > 0)) return 1;
  return diffs.every((d) => d === 0) ? 0 : null;
}
