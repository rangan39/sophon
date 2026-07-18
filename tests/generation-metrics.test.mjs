import assert from "node:assert/strict";
import test from "node:test";
import { calculateGenerationTiming, createGenerationTelemetryGate } from "../src/lib/generation-metrics.ts";

test("separates time to first token from decode throughput", () => {
  const timing = calculateGenerationTiming(100, [125, 145, 170], 175);

  assert.equal(timing.outputTokenCount, 3);
  assert.equal(timing.ttftMs, 25);
  assert.equal(timing.endToEndMs, 70);
  assert.equal(timing.decodeMs, 45);
  assert.equal(timing.timePerOutputTokenMs, 22.5);
  assert.ok(Math.abs((timing.decodeTokensPerSecond ?? 0) - 44.444444) < 0.0001);
  assert.equal(timing.latestInterTokenLatencyMs, 25);
  assert.equal(timing.p95InterTokenLatencyMs, 25);
});

test("does not invent decode throughput for a single output token", () => {
  const timing = calculateGenerationTiming(10, [35], 40);

  assert.equal(timing.ttftMs, 25);
  assert.equal(timing.endToEndMs, 25);
  assert.equal(timing.decodeTokensPerSecond, null);
  assert.equal(timing.timePerOutputTokenMs, null);
});

test("reports observed prefill time before any token arrives", () => {
  const timing = calculateGenerationTiming(50, [], 86);

  assert.equal(timing.outputTokenCount, 0);
  assert.equal(timing.endToEndMs, 36);
  assert.equal(timing.ttftMs, null);
  assert.equal(timing.decodeTokensPerSecond, null);
});

test("skips percentile work for live telemetry while retaining the latest latency", () => {
  const timing = calculateGenerationTiming(100, [125, 145, 170], 175, { includePercentiles: false });

  assert.equal(timing.latestInterTokenLatencyMs, 25);
  assert.equal(timing.p95InterTokenLatencyMs, null);
});

test("publishes initial and final telemetry while throttling intermediate decode updates", () => {
  const shouldPublish = createGenerationTelemetryGate(100);

  assert.equal(shouldPublish("prefill", 0), true);
  assert.equal(shouldPublish("decode", 10), true);
  assert.equal(shouldPublish("decode", 75), false);
  assert.equal(shouldPublish("decode", 110), true);
  assert.equal(shouldPublish("decode", 150), false);
  assert.equal(shouldPublish("complete", 151), true);
});
