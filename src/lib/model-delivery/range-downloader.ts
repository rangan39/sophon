import { createSHA256 } from "hash-wasm";
import pRetry from "p-retry";
import {
  createAdaptiveRangeQueue,
  type AdaptiveRangeQueue,
  type RangeQueueLike
} from "@/lib/model-delivery/adaptive-range-queue";
import { createOrderedArtifactHasher } from "@/lib/model-delivery/ordered-artifact-hasher";

export type DeliveryStage = "download" | "resume" | "verify" | "cache";
export type DeliveryProgress = {
  loaded: number;
  total: number;
  stage: DeliveryStage;
  resumedBytes?: number;
  networkBytes?: number;
  bytesPerSecond?: number;
  etaMs?: number;
};

export type ArtifactDownloadState = {
  key: string;
  version: 1;
  size: number;
  sha256: string;
  segmentSize: number;
  etag: string;
  completed: number[];
  status: "partial" | "ready";
};

export type PositionedFile = {
  getSize: () => number | Promise<number>;
  truncate: (size: number) => void | Promise<void>;
  read: (data: Uint8Array, offset: number) => number | Promise<number>;
  write: (data: Uint8Array, offset: number) => number | Promise<number>;
  flush: () => void | Promise<void>;
  getFile: () => Promise<File>;
};

export type ArtifactStateStore = {
  get: (key: string) => Promise<ArtifactDownloadState | undefined>;
  put: (state: ArtifactDownloadState) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type RangeArtifact = {
  key: string;
  url: string;
  size: number;
  sha256: string;
  segmentSha256?: readonly string[];
};
export type DeliveryDiagnostic =
  | { type: "range"; index: number; bytes: number; durationMs: number; attempt: number }
  | { type: "checkpoint"; segments: number; durationMs: number }
  | { type: "verify"; bytes: number; durationMs: number; overlapped: boolean };
type DownloadOptions = {
  artifact: RangeArtifact;
  file: PositionedFile;
  stateStore: ArtifactStateStore;
  onProgress?: (progress: DeliveryProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  queue?: RangeQueueLike;
  segmentSize?: number;
  retries?: number;
  etag?: string;
  checkpointSegments?: number;
  checkpointIntervalMs?: number;
  onDiagnostic?: (diagnostic: DeliveryDiagnostic) => void;
};

const globalRangeQueue = createAdaptiveRangeQueue({ adaptive: adaptiveDownloadsEnabled() });
const verifiedThisSession = new Set<string>();

export class RangeDeliveryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeDeliveryUnavailableError";
  }
}

export class RangeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeContractError";
  }
}

export class RetryableRangeError extends Error {
  readonly status?: number;
  readonly retryAfterMs: number;

  constructor(message: string, status?: number, retryAfterMs = 0) {
    super(message);
    this.name = "RetryableRangeError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function downloadRangeArtifact(options: DownloadOptions): Promise<File> {
  try {
    return await downloadAndVerify(options);
  } catch (error) {
    if (error instanceof RangeDeliveryUnavailableError) {
      await resetArtifact(options.file, options.stateStore, options.artifact.key);
      throw error;
    }
    if (!(error instanceof ArtifactIntegrityError)) throw error;
    await resetArtifact(options.file, options.stateStore, options.artifact.key);
    try {
      return await downloadAndVerify(options);
    } catch (retryError) {
      if (retryError instanceof ArtifactIntegrityError) await resetArtifact(options.file, options.stateStore, options.artifact.key);
      throw retryError;
    }
  }
}

export async function probeRangeArtifact(
  artifact: RangeArtifact,
  options: Pick<DownloadOptions, "fetch" | "queue" | "retries" | "signal"> = {}
) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  return probeArtifact(artifact, fetcher, options.queue ?? globalRangeQueue, options.retries ?? 3, options.signal);
}

async function downloadAndVerify({
  artifact,
  file,
  stateStore,
  onProgress = () => undefined,
  onDiagnostic = () => undefined,
  signal,
  fetch: fetcher = globalThis.fetch.bind(globalThis),
  queue = globalRangeQueue,
  segmentSize = 64 * 1024 * 1024,
  retries = 3,
  etag: suppliedEtag,
  checkpointSegments = 4,
  checkpointIntervalMs = 1_000
}: DownloadOptions) {
  if (!Number.isSafeInteger(checkpointSegments) || checkpointSegments <= 0) throw new TypeError("Checkpoint segment count must be a positive integer.");
  if (!Number.isFinite(checkpointIntervalMs) || checkpointIntervalMs < 0) throw new TypeError("Checkpoint interval must be non-negative.");
  const segmentDigests = getSegmentDigests(artifact, segmentSize);
  throwIfAborted(signal);
  let state = await stateStore.get(artifact.key);
  const existingSize = await file.getSize();
  if (isReadyState(state, artifact, segmentSize) && existingSize === artifact.size) {
    if (!verifiedThisSession.has(artifact.key)) {
      onProgress({ loaded: 0, total: artifact.size, stage: "verify", resumedBytes: artifact.size, networkBytes: 0 });
      const digest = await sha256File(await file.getFile(), signal, (loaded) => {
        onProgress({ loaded, total: artifact.size, stage: "verify", resumedBytes: artifact.size, networkBytes: 0 });
      });
      if (digest !== artifact.sha256) throw new ArtifactIntegrityError(`SHA-256 mismatch for ${artifact.key}.`);
      verifiedThisSession.add(artifact.key);
    }
    onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
    return file.getFile();
  }

  if (!isPartialState(state, artifact, segmentSize) || !completedSegmentsFit(state.completed, existingSize, artifact.size, segmentSize)) {
    state = await createPartialState(artifact, segmentSize, "", file, stateStore);
  }

  let probe: { etag: string };
  try {
    probe = suppliedEtag ? { etag: suppliedEtag } : await probeArtifact(artifact, fetcher, queue, retries, signal);
  } catch (error) {
    if (error instanceof RangeDeliveryUnavailableError) await resetArtifact(file, stateStore, artifact.key);
    throw error;
  }
  if (state.etag && state.etag !== probe.etag) {
    state = await createPartialState(artifact, segmentSize, probe.etag, file, stateStore);
  } else if (!state.etag) {
    state = { ...state, etag: probe.etag };
    await file.flush();
    await stateStore.put(state);
  }

  const durable = new Set(state.completed);
  const resumedBytes = [...durable].reduce((total, index) => total + getSegmentLength(index, artifact.size, segmentSize), 0);
  const visible = new Map<number, number>();
  let networkBytes = 0;
  const startedAt = now();
  const emit = (stage: DeliveryStage) => {
    const loaded = getVisibleLoaded(durable, visible, artifact.size, segmentSize);
    const elapsedSeconds = Math.max(0, now() - startedAt) / 1000;
    const bytesPerSecond = elapsedSeconds > 0 && networkBytes > 0 ? networkBytes / elapsedSeconds : undefined;
    const remaining = Math.max(0, artifact.size - loaded);
    onProgress({
      loaded,
      total: artifact.size,
      stage,
      resumedBytes,
      networkBytes,
      ...(bytesPerSecond === undefined ? {} : { bytesPerSecond, etaMs: remaining / bytesPerSecond * 1000 })
    });
  };
  emit(resumedBytes > 0 ? "resume" : "download");

  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const verifier = durable.size > 0 || segmentDigests === null
    ? await createOrderedArtifactHasher({ file, size: artifact.size, segmentSize, signal: controller.signal })
    : null;
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const initialHash = verifier?.markMany(durable) ?? Promise.resolve();
  void initialHash.catch((error) => controller.abort(error));
  const checkpoints = createCheckpointBatcher({
    file,
    stateStore,
    durable,
    getState: () => state!,
    setState: (nextState) => { state = nextState; },
    maximumPending: checkpointSegments,
    intervalMs: checkpointIntervalMs,
    onDiagnostic,
    onError: (error) => controller.abort(error)
  });
  try {
    const tasks = getSegments(artifact.size, segmentSize)
      .filter(({ index }) => !durable.has(index))
      .map((segment) => {
        let attempt = 0;
        return pRetry(async () => {
          attempt += 1;
          try {
            await queue.add(async () => {
              reportRangeStart(queue);
              const rangeStartedAt = now();
              try {
                await streamSegment({
                  artifact,
                  etag: probe.etag,
                  segment,
                  file,
                  fetcher,
                  signal: controller.signal,
                  expectedSha256: segmentDigests?.[segment.index],
                  onChunk: (received) => {
                    visible.set(segment.index, Math.max(visible.get(segment.index) ?? 0, received));
                    networkBytes += received;
                    emit(resumedBytes > 0 ? "resume" : "download");
                  }
                });
                reportRangeSuccess(queue, segment.length);
                onDiagnostic({ type: "range", index: segment.index, bytes: segment.length, durationMs: now() - rangeStartedAt, attempt });
              } catch (error) {
                reportRangeFailure(queue, isRetryableRangeFailure(error));
                throw error;
              }
            }, { signal: controller.signal });
          } catch (error) {
            if (error instanceof RetryableRangeError && error.retryAfterMs > 0) {
              await abortableDelay(error.retryAfterMs, controller.signal);
            }
            throw error;
          }
        }, {
          retries,
          factor: 2,
          minTimeout: 400,
          maxTimeout: 4_000,
          randomize: true,
          signal: controller.signal,
          shouldRetry: ({ error }) => !(error instanceof RangeContractError || error instanceof RangeDeliveryUnavailableError)
        }).then(async () => {
          visible.set(segment.index, segment.length);
          await Promise.all([
            verifier?.markComplete(segment.index) ?? Promise.resolve(),
            checkpoints.markComplete(segment.index)
          ]);
        });
      });
    try {
      await Promise.all(tasks);
      await checkpoints.flush();
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(tasks);
      await checkpoints.flush().catch(() => undefined);
      throw error;
    }
  } finally {
    checkpoints.dispose();
    signal?.removeEventListener("abort", abort);
  }

  if (await file.getSize() !== artifact.size) throw new RangeContractError(`Downloaded size did not match ${artifact.size} bytes.`);
  emit("verify");
  const verifyStartedAt = now();
  await initialHash;
  const digest = await verifier?.digest();
  onDiagnostic({ type: "verify", bytes: artifact.size, durationMs: now() - verifyStartedAt, overlapped: true });
  if (digest !== undefined && digest !== artifact.sha256) throw new ArtifactIntegrityError(`SHA-256 mismatch for ${artifact.key}.`);
  state = { ...state, completed: getSegments(artifact.size, segmentSize).map(({ index }) => index), status: "ready" };
  await file.flush();
  await stateStore.put(state);
  verifiedThisSession.add(artifact.key);
  onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes, networkBytes });
  return file.getFile();
}

async function probeArtifact(artifact: RangeArtifact, fetcher: typeof fetch, queue: RangeQueueLike, retries: number, signal?: AbortSignal) {
  return pRetry(async () => {
    const response = await queue.add(() => fetcher(artifact.url, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      redirect: "follow",
      signal
    }), { signal });
    if (!(response instanceof Response)) throw new RangeDeliveryUnavailableError("The range probe did not return a response.");
    if (response.status === 200) {
      await response.body?.cancel();
      throw new RangeDeliveryUnavailableError("The model host does not support byte ranges.");
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      const retryAfterMs = readRetryAfterMs(response.headers.get("retry-after"));
      await response.body?.cancel();
      reportRangeFailure(queue, true);
      if (retryAfterMs > 0) await abortableDelay(retryAfterMs, signal);
      throw new RetryableRangeError(`Retryable model probe response ${response.status}.`, response.status, retryAfterMs);
    }
    try {
      validateRangeResponse(response, 0, 0, artifact.size, null);
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    const etag = response.headers.get("etag");
    await response.body?.cancel();
    if (!etag || etag.startsWith("W/")) throw new RangeDeliveryUnavailableError("The model host did not provide a strong ETag.");
    return { etag };
  }, {
    retries,
    factor: 2,
    minTimeout: 400,
    maxTimeout: 4_000,
    randomize: true,
    signal,
    shouldRetry: ({ error }) => !(error instanceof RangeContractError || error instanceof RangeDeliveryUnavailableError)
  });
}

async function streamSegment({ artifact, etag, segment, file, fetcher, signal, expectedSha256, onChunk }: {
  artifact: RangeArtifact;
  etag: string;
  segment: { index: number; start: number; end: number; length: number };
  file: PositionedFile;
  fetcher: typeof fetch;
  signal: AbortSignal;
  expectedSha256?: string;
  onChunk: (bytes: number) => void;
}) {
  throwIfAborted(signal);
  const segmentHasher = expectedSha256 ? await createSHA256() : null;
  segmentHasher?.init();
  const response = await fetcher(artifact.url, {
    headers: { Range: `bytes=${segment.start}-${segment.end}`, "If-Range": etag },
    cache: "no-store",
    redirect: "follow",
    signal
  });
  if (response.status === 200) {
    await response.body?.cancel();
    throw new RangeDeliveryUnavailableError("A ranged model request returned the full file.");
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    const retryAfterMs = readRetryAfterMs(response.headers.get("retry-after"));
    await response.body?.cancel();
    throw new RetryableRangeError(`Retryable model response ${response.status}.`, response.status, retryAfterMs);
  }
  try {
    validateRangeResponse(response, segment.start, segment.end, artifact.size, etag);
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  if (!response.body) throw new Error("The ranged model response had no body.");
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > segment.length) throw new RangeContractError("A ranged response exceeded its declared length.");
      await writeAll(file, value, segment.start + received);
      segmentHasher?.update(value);
      received += value.byteLength;
      onChunk(value.byteLength);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (received !== segment.length) throw new Error(`Ranged response ended at ${received} of ${segment.length} bytes.`);
  if (expectedSha256 && segmentHasher?.digest("hex") !== expectedSha256) {
    throw new SegmentIntegrityError(`SHA-256 mismatch for segment ${segment.index} of ${artifact.key}.`);
  }
}

function validateRangeResponse(response: Response, start: number, end: number, total: number, etag: string | null) {
  if (response.status !== 206) throw new RangeContractError(`Expected HTTP 206, received ${response.status}.`);
  const contentRange = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!contentRange || Number(contentRange[1]) !== start || Number(contentRange[2]) !== end || Number(contentRange[3]) !== total) {
    throw new RangeContractError(`Invalid Content-Range for bytes ${start}-${end}/${total}.`);
  }
  const expectedLength = end - start + 1;
  if (Number(response.headers.get("content-length")) !== expectedLength) {
    throw new RangeContractError(`Invalid Content-Length for bytes ${start}-${end}.`);
  }
  if (etag !== null && response.headers.get("etag") !== etag) throw new RangeContractError("The artifact ETag changed during download.");
}

async function writeAll(file: PositionedFile, data: Uint8Array, offset: number) {
  let written = 0;
  while (written < data.byteLength) {
    const count = await file.write(data.subarray(written), offset + written);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error("The positioned file write did not make progress.");
    written += count;
  }
}

async function sha256File(file: File, signal?: AbortSignal, onChunk?: (loaded: number) => void) {
  const hasher = await createSHA256();
  hasher.init();
  const reader = file.stream().getReader();
  let loaded = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      loaded += value.byteLength;
      onChunk?.(loaded);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return hasher.digest("hex");
}

function createCheckpointBatcher({
  file,
  stateStore,
  durable,
  getState,
  setState,
  maximumPending,
  intervalMs,
  onDiagnostic,
  onError
}: {
  file: PositionedFile;
  stateStore: ArtifactStateStore;
  durable: Set<number>;
  getState: () => ArtifactDownloadState;
  setState: (state: ArtifactDownloadState) => void;
  maximumPending: number;
  intervalMs: number;
  onDiagnostic: (diagnostic: DeliveryDiagnostic) => void;
  onError: (error: unknown) => void;
}) {
  const pending = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstError: unknown;
  let commitChain = Promise.resolve();

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const checkpoint = () => {
    clearTimer();
    if (firstError !== undefined) return Promise.reject(firstError);
    const batch = [...pending];
    pending.clear();
    if (batch.length === 0) return commitChain.then(() => {
      if (firstError !== undefined) throw firstError;
    });
    const commit = commitChain.then(async () => {
      const startedAt = now();
      await file.flush();
      const nextCompleted = new Set(durable);
      for (const index of batch) nextCompleted.add(index);
      const nextState: ArtifactDownloadState = {
        ...getState(),
        completed: [...nextCompleted].sort((left, right) => left - right)
      };
      await stateStore.put(nextState);
      for (const index of batch) durable.add(index);
      setState(nextState);
      onDiagnostic({ type: "checkpoint", segments: batch.length, durationMs: now() - startedAt });
    });
    commitChain = commit.catch((error) => {
      firstError ??= error;
    });
    return commit;
  };
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void checkpoint().catch(onError);
    }, intervalMs);
  };

  return {
    markComplete(index: number) {
      if (durable.has(index) || pending.has(index)) return Promise.resolve();
      pending.add(index);
      if (pending.size >= maximumPending) return checkpoint();
      schedule();
      return Promise.resolve();
    },
    flush: checkpoint,
    dispose: clearTimer
  };
}

function reportRangeStart(queue: RangeQueueLike) {
  if (isAdaptiveRangeQueue(queue)) queue.reportStart();
}

function reportRangeSuccess(queue: RangeQueueLike, bytes: number) {
  if (isAdaptiveRangeQueue(queue)) queue.reportSuccess(bytes);
}

function reportRangeFailure(queue: RangeQueueLike, retryable: boolean) {
  if (isAdaptiveRangeQueue(queue)) queue.reportFailure(retryable);
}

function isAdaptiveRangeQueue(queue: RangeQueueLike): queue is AdaptiveRangeQueue {
  const candidate = queue as Partial<AdaptiveRangeQueue>;
  return typeof candidate.reportStart === "function"
    && typeof candidate.reportSuccess === "function"
    && typeof candidate.reportFailure === "function";
}

function isRetryableRangeFailure(error: unknown) {
  return !(error instanceof RangeContractError
    || error instanceof RangeDeliveryUnavailableError
    || error instanceof SegmentIntegrityError
    || error instanceof DOMException && error.name === "AbortError");
}

function getSegmentDigests(artifact: RangeArtifact, segmentSize: number) {
  if (artifact.segmentSha256 === undefined) return null;
  const expectedCount = Math.ceil(artifact.size / segmentSize);
  if (artifact.segmentSha256.length !== expectedCount
    || artifact.segmentSha256.some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
    throw new RangeContractError(`Invalid segment integrity manifest for ${artifact.key}.`);
  }
  return artifact.segmentSha256;
}

function readRetryAfterMs(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  const requested = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Math.max(0, Date.parse(value) - Date.now());
  return Number.isFinite(requested) ? Math.min(requested, 60_000) : 0;
}

function abortableDelay(durationMs: number, signal?: AbortSignal) {
  if (durationMs <= 0) return Promise.resolve();
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, durationMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The model download was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function getSegments(size: number, segmentSize: number) {
  return Array.from({ length: Math.ceil(size / segmentSize) }, (_, index) => {
    const start = index * segmentSize;
    const end = Math.min(size, start + segmentSize) - 1;
    return { index, start, end, length: end - start + 1 };
  });
}

function getSegmentLength(index: number, size: number, segmentSize: number) {
  return Math.max(0, Math.min(segmentSize, size - index * segmentSize));
}

function getVisibleLoaded(completed: ReadonlySet<number>, visible: ReadonlyMap<number, number>, size: number, segmentSize: number) {
  return getSegments(size, segmentSize).reduce((total, segment) => total + (completed.has(segment.index)
    ? segment.length
    : Math.min(segment.length, visible.get(segment.index) ?? 0)), 0);
}

function isReadyState(state: ArtifactDownloadState | undefined, artifact: RangeArtifact, segmentSize: number): state is ArtifactDownloadState {
  return isPartialState(state, artifact, segmentSize) && state.status === "ready";
}

function isPartialState(state: ArtifactDownloadState | undefined, artifact: RangeArtifact, segmentSize: number): state is ArtifactDownloadState {
  return Boolean(state
    && state.version === 1
    && state.key === artifact.key
    && state.size === artifact.size
    && state.sha256 === artifact.sha256
    && state.segmentSize === segmentSize
    && Array.isArray(state.completed));
}

function completedSegmentsFit(completed: readonly number[], fileSize: number, artifactSize: number, segmentSize: number) {
  const segmentCount = Math.ceil(artifactSize / segmentSize);
  const unique = new Set(completed);
  return fileSize <= artifactSize
    && unique.size === completed.length
    && completed.every((index) => Number.isSafeInteger(index)
    && index >= 0
    && index < segmentCount
    && index * segmentSize + getSegmentLength(index, artifactSize, segmentSize) <= fileSize);
}

async function createPartialState(artifact: RangeArtifact, segmentSize: number, etag: string, file: PositionedFile, store: ArtifactStateStore) {
  await file.truncate(0);
  await file.flush();
  const state: ArtifactDownloadState = {
    key: artifact.key,
    version: 1,
    size: artifact.size,
    sha256: artifact.sha256,
    segmentSize,
    etag,
    completed: [],
    status: "partial"
  };
  await store.put(state);
  return state;
}

async function resetArtifact(file: PositionedFile, store: ArtifactStateStore, key: string) {
  verifiedThisSession.delete(key);
  await file.truncate(0);
  await file.flush();
  await store.delete(key);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was aborted.", "AbortError");
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function adaptiveDownloadsEnabled() {
  return typeof process === "undefined" || process.env.NEXT_PUBLIC_SOPHON_ADAPTIVE_DOWNLOADS !== "0";
}

class ArtifactIntegrityError extends Error {}
class SegmentIntegrityError extends ArtifactIntegrityError {}
