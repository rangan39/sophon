import PQueue from "p-queue";

export type RangeQueueLike = {
  add<T>(task: () => Promise<T>, options?: { signal?: AbortSignal }): Promise<T | void>;
};

export type AdaptiveRangeDiagnostic = {
  type: "concurrency";
  previous: number;
  current: number;
  reason: "probe" | "accepted" | "reverted" | "backoff" | "idle-reset";
  bytesPerSecond?: number;
};

export type AdaptiveRangeQueue = RangeQueueLike & {
  readonly concurrency: number;
  reportStart: () => void;
  reportSuccess: (bytes: number) => void;
  reportFailure: (retryable: boolean) => void;
};

export type AdaptiveRangeQueueOptions = {
  adaptive?: boolean;
  minimum?: number;
  initial?: number;
  maximum?: number;
  step?: number;
  epochBytes?: number;
  minimumEpochMs?: number;
  improvementThreshold?: number;
  cooldownMs?: number;
  idleResetMs?: number;
  now?: () => number;
  onDiagnostic?: (diagnostic: AdaptiveRangeDiagnostic) => void;
};

const MEBIBYTE = 1024 * 1024;

export function createAdaptiveRangeQueue({
  adaptive = true,
  minimum = 2,
  initial = 4,
  maximum = 12,
  step = 2,
  epochBytes = 256 * MEBIBYTE,
  minimumEpochMs = 3_000,
  improvementThreshold = 0.05,
  cooldownMs = 10_000,
  idleResetMs = 60_000,
  now = defaultNow,
  onDiagnostic = () => undefined
}: AdaptiveRangeQueueOptions = {}): AdaptiveRangeQueue {
  if (![minimum, initial, maximum, step, epochBytes].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("Adaptive range queue limits must be positive numbers.");
  }
  if (minimum > initial || initial > maximum) throw new TypeError("Adaptive range queue limits must satisfy minimum <= initial <= maximum.");
  if (!Number.isFinite(minimumEpochMs) || minimumEpochMs < 0
    || !Number.isFinite(improvementThreshold) || improvementThreshold < 0
    || !Number.isFinite(cooldownMs) || cooldownMs < 0
    || !Number.isFinite(idleResetMs) || idleResetMs < 0) {
    throw new TypeError("Adaptive range queue timing and improvement thresholds must be non-negative.");
  }

  const queue = new PQueue({ concurrency: initial });
  let epochStartedAt: number | null = null;
  let epochCompletedBytes = 0;
  let probeReference: { concurrency: number; bytesPerSecond: number } | null = null;
  let upwardProbingDisabled = !adaptive;
  let cooldownUntil = 0;
  let lastActivityAt: number | null = null;
  let activeTransfers = 0;

  const resetEpoch = () => {
    epochStartedAt = null;
    epochCompletedBytes = 0;
  };
  const changeConcurrency = (next: number, reason: AdaptiveRangeDiagnostic["reason"], bytesPerSecond?: number) => {
    const bounded = Math.max(minimum, Math.min(maximum, Math.round(next)));
    const previous = queue.concurrency;
    if (bounded === previous) return;
    queue.concurrency = bounded;
    onDiagnostic({ type: "concurrency", previous, current: bounded, reason, ...(bytesPerSecond === undefined ? {} : { bytesPerSecond }) });
  };
  const beginProbe = (sample: { concurrency: number; bytesPerSecond: number }, reason: "probe" | "accepted") => {
    if (queue.concurrency >= maximum) return;
    probeReference = sample;
    changeConcurrency(queue.concurrency + step, reason, sample.bytesPerSecond);
  };

  return {
    add: (task, options) => queue.add(task, options),
    get concurrency() {
      return queue.concurrency;
    },
    reportStart() {
      const observedAt = now();
      if (adaptive && activeTransfers === 0 && lastActivityAt !== null && observedAt - lastActivityAt >= idleResetMs) {
        changeConcurrency(initial, "idle-reset");
        probeReference = null;
        upwardProbingDisabled = false;
        cooldownUntil = 0;
        resetEpoch();
      }
      activeTransfers += 1;
      lastActivityAt = observedAt;
      epochStartedAt ??= observedAt;
    },
    reportSuccess(bytes) {
      activeTransfers = Math.max(0, activeTransfers - 1);
      if (!adaptive || !Number.isFinite(bytes) || bytes <= 0) return;
      const observedAt = now();
      epochStartedAt ??= observedAt;
      epochCompletedBytes += bytes;
      const durationMs = observedAt - epochStartedAt;
      if (epochCompletedBytes < epochBytes || durationMs < minimumEpochMs || durationMs <= 0) return;
      const bytesPerSecond = epochCompletedBytes / (durationMs / 1000);
      const sample = { concurrency: queue.concurrency, bytesPerSecond };
      resetEpoch();
      lastActivityAt = observedAt;

      if (observedAt < cooldownUntil) return;
      if (probeReference && sample.concurrency !== probeReference.concurrency) {
        const improves = sample.bytesPerSecond >= probeReference.bytesPerSecond * (1 + improvementThreshold);
        if (improves) {
          probeReference = null;
          beginProbe(sample, "accepted");
        } else {
          const previous = probeReference;
          probeReference = null;
          upwardProbingDisabled = true;
          changeConcurrency(previous.concurrency, "reverted", sample.bytesPerSecond);
        }
        return;
      }

      if (!upwardProbingDisabled) beginProbe(sample, "probe");
    },
    reportFailure(retryable) {
      activeTransfers = Math.max(0, activeTransfers - 1);
      if (!adaptive || !retryable) return;
      const observedAt = now();
      const next = Math.max(minimum, Math.floor(queue.concurrency / 2));
      changeConcurrency(next, "backoff");
      cooldownUntil = observedAt + cooldownMs;
      probeReference = null;
      upwardProbingDisabled = false;
      resetEpoch();
      lastActivityAt = observedAt;
    }
  };
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}
