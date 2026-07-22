import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ModelDeliveryArtifact, ModelDeliveryManifest } from "@/lib/model-delivery/manifest";
import type { ArtifactDownloadState, ArtifactStateStore, PositionedFile } from "@/lib/model-delivery/range-downloader";

interface DeliveryDatabase extends DBSchema {
  artifacts: { key: string; value: ArtifactDownloadState };
}

type SyncAccessHandle = {
  getSize: () => number;
  truncate: (size: number) => void;
  write: (data: Uint8Array, options: { at: number }) => number;
  flush: () => void;
  close: () => void;
};

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

export type OpenArtifactFile = {
  file: PositionedFile;
  close: () => void;
};

let databasePromise: Promise<IDBPDatabase<DeliveryDatabase>> | null = null;

export class ModelDeliveryUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDeliveryUnavailableError";
  }
}

export function supportsPersistentModelDelivery() {
  return typeof navigator !== "undefined"
    && typeof navigator.storage?.getDirectory === "function"
    && typeof indexedDB !== "undefined"
    && typeof File !== "undefined"
    && typeof ReadableStream !== "undefined";
}

export function createArtifactStateStore(): ArtifactStateStore {
  return {
    async get(key) {
      return (await getDatabase()).get("artifacts", key);
    },
    async put(state) {
      const transaction = (await getDatabase()).transaction("artifacts", "readwrite", { durability: "strict" });
      await transaction.store.put(state);
      await transaction.done;
    },
    async delete(key) {
      const transaction = (await getDatabase()).transaction("artifacts", "readwrite", { durability: "strict" });
      await transaction.store.delete(key);
      await transaction.done;
    }
  };
}

export async function openArtifactFile(model: ModelDeliveryManifest, artifact: ModelDeliveryArtifact): Promise<OpenArtifactFile> {
  if (!supportsPersistentModelDelivery()) throw new ModelDeliveryUnavailableError("OPFS or IndexedDB is unavailable.");
  try {
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle("sophon-models", { create: true });
    const version = await app.getDirectoryHandle("v1", { create: true });
    const modelDirectory = await version.getDirectoryHandle(model.modelId, { create: true });
    const revisionDirectory = await modelDirectory.getDirectoryHandle(model.revision, { create: true });
    const handle = await revisionDirectory.getFileHandle(artifact.externalPath, { create: true }) as SyncFileHandle;
    if (typeof handle.createSyncAccessHandle !== "function") {
      throw new ModelDeliveryUnavailableError("Synchronous OPFS access is unavailable in this worker.");
    }
    const access = await handle.createSyncAccessHandle();
    let closed = false;
    return {
      file: {
        getSize: () => access.getSize(),
        truncate: (size) => access.truncate(size),
        write: (data, offset) => access.write(data, { at: offset }),
        flush: () => access.flush(),
        getFile: () => handle.getFile()
      },
      close: () => {
        if (closed) return;
        closed = true;
        access.close();
      }
    };
  } catch (error) {
    if (error instanceof ModelDeliveryUnavailableError) throw error;
    throw new ModelDeliveryUnavailableError("Persistent model storage could not be opened.", { cause: error });
  }
}

async function getDatabase() {
  databasePromise ??= openDB<DeliveryDatabase>("sophon-model-delivery", 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("artifacts")) database.createObjectStore("artifacts", { keyPath: "key" });
    },
    blocking() {
      const current = databasePromise;
      databasePromise = null;
      void current?.then((database) => database.close());
    },
    terminated() {
      databasePromise = null;
    }
  });
  return databasePromise;
}
