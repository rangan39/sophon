import { createSHA256 } from "hash-wasm";
import { getArtifactKey, getArtifactUrl, type ModelAuxiliaryArtifact, type ModelDeliveryManifest } from "@/lib/model-delivery/manifest";
import type { DeliveryProgress } from "@/lib/model-delivery/range-downloader";
import { ModelDeliveryUnavailableError, toModelStorageError } from "@/lib/model-delivery/errors";

export const TRANSFORMERS_CACHE_NAME = "transformers-cache";

const verifiedThisSession = new Set<string>();

export async function ensureAuxiliaryArtifact(
  model: ModelDeliveryManifest,
  artifact: ModelAuxiliaryArtifact,
  onProgress: (progress: DeliveryProgress) => void,
  signal?: AbortSignal
) {
  if (typeof caches === "undefined") throw new ModelDeliveryUnavailableError("This browser cannot store the model files Sophon needs.");
  throwIfAborted(signal);
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const key = getArtifactUrl(model, artifact);
  const sessionKey = getArtifactKey(model, artifact);
  const cached = await cache.match(key);
  if (cached) {
    if (verifiedThisSession.has(sessionKey)) {
      onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
      return;
    }
    const cachedBytes = await readAndHash(cached, artifact.size, (loaded) => {
      onProgress({ loaded, total: artifact.size, stage: "verify", resumedBytes: artifact.size, networkBytes: 0 });
    }, signal);
    if (cachedBytes.sha256 === artifact.sha256) {
      verifiedThisSession.add(sessionKey);
      onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: artifact.size, networkBytes: 0 });
      return;
    }
    await cache.delete(key);
    verifiedThisSession.delete(sessionKey);
  }

  const response = await fetch(key, { cache: "no-store", redirect: "follow", signal });
  if (!response.ok) throw new Error(`Model metadata request failed with HTTP ${response.status} for ${artifact.path}.`);
  const downloaded = await readAndHash(response, artifact.size, (loaded) => {
    onProgress({ loaded, total: artifact.size, stage: "download", resumedBytes: 0, networkBytes: loaded });
  }, signal);
  if (downloaded.sha256 !== artifact.sha256) throw new Error(`SHA-256 mismatch for ${sessionKey}.`);
  try {
    await cache.put(key, new Response(downloaded.bytes, {
      headers: {
        "content-length": String(artifact.size),
        "content-type": response.headers.get("content-type") ?? "application/octet-stream"
      }
    }));
  } catch (error) {
    throw toModelStorageError(error, "The browser ran out of storage while caching verified model metadata.");
  }
  verifiedThisSession.add(sessionKey);
  onProgress({ loaded: artifact.size, total: artifact.size, stage: "cache", resumedBytes: 0, networkBytes: artifact.size });
}

export async function hasAuxiliaryArtifact(model: ModelDeliveryManifest, artifact: ModelAuxiliaryArtifact) {
  if (typeof caches === "undefined") return false;
  const cached = await (await caches.open(TRANSFORMERS_CACHE_NAME)).match(getArtifactUrl(model, artifact));
  return Boolean(cached && Number(cached.headers.get("content-length")) === artifact.size);
}

export async function deleteAuxiliaryArtifacts(model: ModelDeliveryManifest) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  await Promise.all(model.auxiliary.map(async (artifact) => {
    await cache.delete(getArtifactUrl(model, artifact));
    verifiedThisSession.delete(getArtifactKey(model, artifact));
  }));
}

async function readAndHash(
  response: Response,
  expectedSize: number,
  onChunk: (loaded: number) => void,
  signal?: AbortSignal
) {
  if (!response.body) throw new Error("The model metadata response had no body.");
  const hasher = await createSHA256();
  hasher.init();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > expectedSize) throw new Error(`Model metadata exceeded its declared size of ${expectedSize} bytes.`);
      hasher.update(value);
      chunks.push(value);
      onChunk(loaded);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (loaded !== expectedSize) throw new Error(`Model metadata ended at ${loaded} of ${expectedSize} bytes.`);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, sha256: hasher.digest("hex") };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was cancelled.", "AbortError");
}
