export function roundMetric(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;
  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex] ?? sortedValues[sortedValues.length - 1] ?? 0;
  const upperValue = sortedValues[upperIndex] ?? lowerValue;
  if (lowerIndex === upperIndex) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex);
}

export function summarizeMetric(values) {
  const normalized = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (normalized.length === 0) return null;
  return {
    avg: roundMetric(normalized.reduce((sum, value) => sum + value, 0) / normalized.length),
    max: roundMetric(normalized[normalized.length - 1] ?? 0),
    p50: roundMetric(quantile(normalized, 0.5)),
    p95: roundMetric(quantile(normalized, 0.95)),
    p99: roundMetric(quantile(normalized, 0.99)),
    samples: normalized.length,
    total: roundMetric(normalized.reduce((sum, value) => sum + value, 0)),
  };
}

export function summarizeFrameMetric(frames, key) {
  return summarizeMetric(frames.map((frame) => Number(frame[key])));
}
