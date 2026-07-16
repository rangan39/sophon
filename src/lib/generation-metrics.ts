export type GenerationTimingSnapshot = {
  outputTokenCount: number;
  endToEndMs: number;
  ttftMs: number | null;
  decodeMs: number;
  decodeTokensPerSecond: number | null;
  timePerOutputTokenMs: number | null;
  latestInterTokenLatencyMs: number | null;
  p95InterTokenLatencyMs: number | null;
};

export function calculateGenerationTiming(
  startedAtMs: number,
  tokenTimestampsMs: readonly number[],
  observedAtMs: number
): GenerationTimingSnapshot {
  const timestamps = tokenTimestampsMs.map((timestamp) => Math.max(startedAtMs, timestamp));
  const firstTokenAt = timestamps[0] ?? null;
  const lastTokenAt = timestamps.at(-1) ?? null;
  const endToEndMs = Math.max(0, (lastTokenAt ?? observedAtMs) - startedAtMs);
  const ttftMs = firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAtMs);
  const decodeMs = firstTokenAt === null || lastTokenAt === null
    ? 0
    : Math.max(0, lastTokenAt - firstTokenAt);
  const decodeTokenCount = Math.max(0, timestamps.length - 1);
  const timePerOutputTokenMs = decodeTokenCount > 0 && decodeMs > 0
    ? decodeMs / decodeTokenCount
    : null;
  const decodeTokensPerSecond = timePerOutputTokenMs === null
    ? null
    : 1000 / timePerOutputTokenMs;
  const interTokenLatencies = timestamps.slice(1).map((timestamp, index) => (
    Math.max(0, timestamp - (timestamps[index] ?? timestamp))
  ));

  return {
    outputTokenCount: timestamps.length,
    endToEndMs,
    ttftMs,
    decodeMs,
    decodeTokensPerSecond,
    timePerOutputTokenMs,
    latestInterTokenLatencyMs: interTokenLatencies.at(-1) ?? null,
    p95InterTokenLatencyMs: percentile(interTokenLatencies, 0.95)
  };
}

function percentile(values: readonly number[], quantile: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}
