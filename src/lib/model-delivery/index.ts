import { getArtifactKey, getArtifactUrl, getModelDeliveryManifest, MODEL_SEGMENT_SIZE, type ModelDeliveryArtifact, type ModelDeliveryManifest } from "@/lib/model-delivery/manifest";
import { createArtifactStateStore, ModelDeliveryUnavailableError, openArtifactFile, supportsPersistentModelDelivery } from "@/lib/model-delivery/opfs-store";
import { downloadRangeArtifact, RangeDeliveryUnavailableError, type DeliveryProgress } from "@/lib/model-delivery/range-downloader";

type DeliveryModel = {
  id: string;
  source: { kind: "local"; baseUrl: string; revision: "bundled" } | { kind: "huggingface"; repo: string; revision: string };
};

export type PreparedModelDelivery = {
  externalData: { path: string; data: File }[];
  totalBytes: number;
};

const inFlightArtifacts = new Map<string, Promise<File>>();

export async function prepareModelDelivery(
  model: DeliveryModel,
  onProgress: (progress: DeliveryProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<PreparedModelDelivery | null> {
  const manifest = getModelDeliveryManifest(model.id);
  if (!manifest || model.source.kind !== "huggingface" || model.source.repo !== manifest.repo || model.source.revision !== manifest.revision) return null;
  if (!supportsPersistentModelDelivery()) return null;

  const totalBytes = manifest.externalData.reduce((total, artifact) => total + artifact.size, 0);
  const aggregate = createAggregateProgress(manifest, onProgress);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let primaryError: unknown;
  try {
    const results = await Promise.allSettled(manifest.externalData.map((artifact) => ensureArtifact(
      manifest,
      artifact,
      aggregate.update(artifact.path),
      controller.signal
    ).catch((error) => {
      if (primaryError === undefined) {
        primaryError = error;
        controller.abort(error);
      }
      throw error;
    })));
    if (primaryError !== undefined) throw primaryError;
    const prepared = results.map((result) => (result as PromiseFulfilledResult<File>).value);
    const files = prepared.map((data, index) => ({ path: manifest.externalData[index]!.externalPath, data }));
    aggregate.complete();
    return { externalData: files, totalBytes };
  } catch (error) {
    if (error instanceof RangeDeliveryUnavailableError || error instanceof ModelDeliveryUnavailableError || isStorageUnavailable(error)) return null;
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function ensureArtifact(
  model: ModelDeliveryManifest,
  artifact: ModelDeliveryArtifact,
  onProgress: (progress: DeliveryProgress) => void,
  signal?: AbortSignal
) {
  const key = getArtifactKey(model, artifact);
  const existing = inFlightArtifacts.get(key);
  if (existing) return existing;
  const loading = withArtifactLock(key, async () => {
    const opened = await openArtifactFile(model, artifact);
    try {
      return await downloadRangeArtifact({
        artifact: { key, url: getArtifactUrl(model, artifact), size: artifact.size, sha256: artifact.sha256 },
        file: opened.file,
        stateStore: createArtifactStateStore(),
        segmentSize: MODEL_SEGMENT_SIZE,
        onProgress,
        signal
      });
    } finally {
      opened.close();
    }
  }, signal).finally(() => inFlightArtifacts.delete(key));
  inFlightArtifacts.set(key, loading);
  return loading;
}

async function withArtifactLock<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator.locks?.request !== "function") return task();
  return navigator.locks.request(`sophon-model-delivery:${key}`, { mode: "exclusive", signal }, async () => task());
}

function createAggregateProgress(model: ModelDeliveryManifest, publish: (progress: DeliveryProgress) => void) {
  const entries = new Map<string, DeliveryProgress>(model.externalData.map((artifact) => [artifact.path, {
    loaded: 0,
    total: artifact.size,
    stage: "download" as const,
    resumedBytes: 0,
    networkBytes: 0
  }]));
  const startedAt = now();
  let lastPercent = -1;
  let lastStage = "";
  let lastPublishedAt = 0;
  const emit = (force = false) => {
    const values = [...entries.values()];
    const loaded = values.reduce((total, progress) => total + progress.loaded, 0);
    const total = values.reduce((sum, progress) => sum + progress.total, 0);
    const resumedBytes = values.reduce((sum, progress) => sum + (progress.resumedBytes ?? 0), 0);
    const networkBytes = values.reduce((sum, progress) => sum + (progress.networkBytes ?? 0), 0);
    const stage = values.some((progress) => progress.stage === "resume")
      ? "resume"
      : values.some((progress) => progress.stage === "download")
        ? "download"
        : values.some((progress) => progress.stage === "verify")
          ? "verify"
          : "cache";
    const elapsedSeconds = Math.max(0, now() - startedAt) / 1000;
    const bytesPerSecond = elapsedSeconds > 0 && networkBytes > 0 ? networkBytes / elapsedSeconds : undefined;
    const percent = Math.floor(loaded / total * 100);
    const observedAt = now();
    if (!force && percent === lastPercent && stage === lastStage && observedAt - lastPublishedAt < 200) return;
    lastPercent = percent;
    lastStage = stage;
    lastPublishedAt = observedAt;
    publish({
      loaded,
      total,
      stage,
      resumedBytes,
      networkBytes,
      ...(bytesPerSecond === undefined ? {} : { bytesPerSecond, etaMs: Math.max(0, total - loaded) / bytesPerSecond * 1000 })
    });
  };
  return {
    update(path: string) {
      return (progress: DeliveryProgress) => {
        entries.set(path, progress);
        emit();
      };
    },
    complete() {
      for (const [path, progress] of entries) entries.set(path, { ...progress, loaded: progress.total, stage: "cache" });
      emit(true);
    }
  };
}

function isStorageUnavailable(error: unknown) {
  return error instanceof DOMException && [
    "InvalidStateError",
    "NoModificationAllowedError",
    "NotAllowedError",
    "NotSupportedError",
    "QuotaExceededError",
    "SecurityError",
    "UnknownError"
  ].includes(error.name);
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export { MODEL_DELIVERY_MANIFESTS } from "@/lib/model-delivery/manifest";
export type { DeliveryProgress } from "@/lib/model-delivery/range-downloader";
