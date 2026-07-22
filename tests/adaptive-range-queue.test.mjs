import assert from "node:assert/strict";
import test from "node:test";
import { createAdaptiveRangeQueue } from "../src/lib/model-delivery/adaptive-range-queue.ts";

test("keeps a faster concurrency probe and continues ramping", () => {
  let observedAt = 0;
  const diagnostics = [];
  const queue = createAdaptiveRangeQueue({
    epochBytes: 100,
    minimumEpochMs: 0,
    now: () => observedAt,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });

  queue.reportStart();
  observedAt = 1_000;
  queue.reportSuccess(100);
  assert.equal(queue.concurrency, 6);

  queue.reportStart();
  observedAt = 2_000;
  queue.reportSuccess(120);
  assert.equal(queue.concurrency, 8);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.reason), ["probe", "accepted"]);
});

test("reverts a concurrency probe that does not improve goodput", () => {
  let observedAt = 0;
  const diagnostics = [];
  const queue = createAdaptiveRangeQueue({
    epochBytes: 100,
    minimumEpochMs: 0,
    now: () => observedAt,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });

  queue.reportStart();
  observedAt = 1_000;
  queue.reportSuccess(100);
  assert.equal(queue.concurrency, 6);

  queue.reportStart();
  observedAt = 2_000;
  queue.reportSuccess(104);
  assert.equal(queue.concurrency, 4);
  assert.equal(diagnostics.at(-1)?.reason, "reverted");
});

test("backs off multiplicatively after retryable failures", () => {
  const diagnostics = [];
  const queue = createAdaptiveRangeQueue({
    initial: 8,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });

  queue.reportFailure(false);
  assert.equal(queue.concurrency, 8);
  queue.reportFailure(true);
  assert.equal(queue.concurrency, 4);
  queue.reportFailure(true);
  assert.equal(queue.concurrency, 2);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.reason), ["backoff", "backoff"]);
});

test("supports a fixed concurrency fallback", () => {
  let observedAt = 0;
  const queue = createAdaptiveRangeQueue({
    adaptive: false,
    initial: 4,
    epochBytes: 1,
    minimumEpochMs: 0,
    now: () => observedAt
  });

  queue.reportStart();
  observedAt = 1_000;
  queue.reportSuccess(1_000);
  queue.reportFailure(true);
  assert.equal(queue.concurrency, 4);
});

test("returns to the conservative starting point after an idle period", () => {
  let observedAt = 0;
  const queue = createAdaptiveRangeQueue({
    initial: 8,
    idleResetMs: 1_000,
    now: () => observedAt
  });

  queue.reportStart();
  queue.reportFailure(true);
  assert.equal(queue.concurrency, 4);
  observedAt = 2_000;
  queue.reportStart();
  assert.equal(queue.concurrency, 8);
});
