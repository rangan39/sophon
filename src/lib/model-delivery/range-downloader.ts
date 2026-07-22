import { createSHA256 } from "hash-wasm";
import PQueue from "p-queue";
import pRetry from "p-retry";

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
  write: (data: Uint8Array, offset: number) => number | Promise<number>;
  flush: () => void | Promise<void>;
  getFile: () => Promise<File>;
};

export type ArtifactStateStore = {
  get: (key: string) => Promise<ArtifactDownloadState | undefined>;
  put: (state: ArtifactDownloadState) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type QueueLike = {
  add<T>(task: () => Promise<T>, options?: { signal?: AbortSignal }): Promise<T | void>;
};

type RangeArtifact = { key: string; url: string; size: number; sha256: string };
type DownloadOptions = {
  artifact: RangeArtifact;
  file: PositionedFile;
  stateStore: ArtifactStateStore;
  onProgress?: (progress: DeliveryProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  queue?: QueueLike;
  segmentSize?: number;
  retries?: number;
};

const globalRangeQueue = new PQueue({ concurrency: 4 });

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

async function downloadAndVerify({
  artifact,
  file,
  stateStore,
  onProgress = () => undefined,
  signal,
  fetch: fetcher = globalThis.fetch.bind(globalThis),
  queue = globalRangeQueue,
  segmentSize = 64 * 1024 * 1024,
  retries = 3
}: DownloadOptions) {
  throwIfAborted(signal);
  let state = await stateStore.get(artifact.key);
  const existingSize = await file.getSize();
  if (isReadyState(state, artifact, segmentSize) && existingSize === artifact.size) {
    onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
    return file.getFile();
  }

  if (!isPartialState(state, artifact, segmentSize) || !completedSegmentsFit(state.completed, existingSize, artifact.size, segmentSize)) {
    state = await createPartialState(artifact, segmentSize, "", file, stateStore);
  }

  let probe: { etag: string };
  try {
    probe = await probeArtifact(artifact, fetcher, queue, retries, signal);
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

  const completed = new Set(state.completed);
  const resumedBytes = [...completed].reduce((total, index) => total + getSegmentLength(index, artifact.size, segmentSize), 0);
  const visible = new Map<number, number>();
  let networkBytes = 0;
  const startedAt = now();
  const emit = (stage: DeliveryStage) => {
    const loaded = getVisibleLoaded(completed, visible, artifact.size, segmentSize);
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
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let commitChain = Promise.resolve();
  try {
    const tasks = getSegments(artifact.size, segmentSize)
      .filter(({ index }) => !completed.has(index))
      .map((segment) => pRetry(async () => {
        await queue.add(() => streamSegment({
            artifact,
            etag: probe.etag,
            segment,
            file,
            fetcher,
            signal: controller.signal,
            onChunk: (received) => {
              visible.set(segment.index, Math.max(visible.get(segment.index) ?? 0, received));
              networkBytes += received;
              emit(resumedBytes > 0 ? "resume" : "download");
            }
          }), { signal: controller.signal });
      }, {
        retries,
        factor: 2,
        minTimeout: 400,
        maxTimeout: 4_000,
        randomize: true,
        signal: controller.signal,
        shouldRetry: ({ error }) => !(error instanceof RangeContractError || error instanceof RangeDeliveryUnavailableError)
      }).then(async () => {
        const commit = commitChain.then(async () => {
          await file.flush();
          completed.add(segment.index);
          const nextState: ArtifactDownloadState = { ...state!, completed: [...completed].sort((left, right) => left - right) };
          state = nextState;
          await stateStore.put(nextState);
        });
        commitChain = commit.catch(() => undefined);
        await commit;
      }));
    try {
      await Promise.all(tasks);
      await commitChain;
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(tasks);
      throw error;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  await file.flush();
  if (await file.getSize() !== artifact.size) throw new RangeContractError(`Downloaded size did not match ${artifact.size} bytes.`);
  const snapshot = await file.getFile();
  emit("verify");
  const digest = await sha256File(snapshot, signal);
  if (digest !== artifact.sha256) throw new ArtifactIntegrityError(`SHA-256 mismatch for ${artifact.key}.`);
  state = { ...state, completed: getSegments(artifact.size, segmentSize).map(({ index }) => index), status: "ready" };
  await file.flush();
  await stateStore.put(state);
  onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes, networkBytes });
  return snapshot;
}

async function probeArtifact(artifact: RangeArtifact, fetcher: typeof fetch, queue: QueueLike, retries: number, signal?: AbortSignal) {
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
      await response.body?.cancel();
      throw new Error(`Retryable model probe response ${response.status}.`);
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

async function streamSegment({ artifact, etag, segment, file, fetcher, signal, onChunk }: {
  artifact: RangeArtifact;
  etag: string;
  segment: { index: number; start: number; end: number; length: number };
  file: PositionedFile;
  fetcher: typeof fetch;
  signal: AbortSignal;
  onChunk: (bytes: number) => void;
}) {
  throwIfAborted(signal);
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
    await response.body?.cancel();
    throw new Error(`Retryable model response ${response.status}.`);
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

async function sha256File(file: File, signal?: AbortSignal) {
  const hasher = await createSHA256();
  hasher.init();
  const reader = file.stream().getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return hasher.digest("hex");
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

class ArtifactIntegrityError extends Error {}
