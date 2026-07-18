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

export type GenerationTelemetryPhase = "prefill" | "decode" | "complete";

export const LIVE_TELEMETRY_INTERVAL_MS = 100;

export function calculateGenerationTiming(
  startedAtMs: number,
  tokenTimestampsMs: readonly number[],
  observedAtMs: number,
  options: { includePercentiles?: boolean } = {}
): GenerationTimingSnapshot {
  const outputTokenCount = tokenTimestampsMs.length;
  const firstTimestamp = tokenTimestampsMs[0];
  const lastTimestamp = tokenTimestampsMs.at(-1);
  const firstTokenAt = firstTimestamp === undefined ? null : Math.max(startedAtMs, firstTimestamp);
  const lastTokenAt = lastTimestamp === undefined ? null : Math.max(startedAtMs, lastTimestamp);
  const endToEndMs = Math.max(0, (lastTokenAt ?? observedAtMs) - startedAtMs);
  const ttftMs = firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAtMs);
  const decodeMs = firstTokenAt === null || lastTokenAt === null
    ? 0
    : Math.max(0, lastTokenAt - firstTokenAt);
  const decodeTokenCount = Math.max(0, outputTokenCount - 1);
  const timePerOutputTokenMs = decodeTokenCount > 0 && decodeMs > 0
    ? decodeMs / decodeTokenCount
    : null;
  const decodeTokensPerSecond = timePerOutputTokenMs === null
    ? null
    : 1000 / timePerOutputTokenMs;
  const previousTimestamp = tokenTimestampsMs.at(-2);
  const latestInterTokenLatencyMs = lastTokenAt === null || previousTimestamp === undefined
    ? null
    : Math.max(0, lastTokenAt - Math.max(startedAtMs, previousTimestamp));

  return {
    outputTokenCount,
    endToEndMs,
    ttftMs,
    decodeMs,
    decodeTokensPerSecond,
    timePerOutputTokenMs,
    latestInterTokenLatencyMs,
    p95InterTokenLatencyMs: options.includePercentiles === false
      ? null
      : percentile(interTokenLatencies(tokenTimestampsMs, startedAtMs), 0.95)
  };
}

export function createGenerationTelemetryGate(intervalMs = LIVE_TELEMETRY_INTERVAL_MS) {
  let hasPublishedDecode = false;
  let lastDecodePublishedAt = -Infinity;

  return (phase: GenerationTelemetryPhase, observedAtMs: number) => {
    if (phase !== "decode") return true;
    if (!hasPublishedDecode || observedAtMs - lastDecodePublishedAt >= intervalMs) {
      hasPublishedDecode = true;
      lastDecodePublishedAt = observedAtMs;
      return true;
    }
    return false;
  };
}

function interTokenLatencies(tokenTimestampsMs: readonly number[], startedAtMs: number) {
  const latencies: number[] = [];
  for (let index = 1; index < tokenTimestampsMs.length; index += 1) {
    const current = Math.max(startedAtMs, tokenTimestampsMs[index] ?? startedAtMs);
    const previous = Math.max(startedAtMs, tokenTimestampsMs[index - 1] ?? startedAtMs);
    latencies.push(Math.max(0, current - previous));
  }
  return latencies;
}

function percentile(values: readonly number[], quantile: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}
