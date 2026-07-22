import { createSHA256 } from "hash-wasm";

export type ReadablePositionedFile = {
  read: (data: Uint8Array, offset: number) => number | Promise<number>;
};

type Segment = { index: number; start: number; length: number };

export async function createOrderedArtifactHasher({
  file,
  size,
  segmentSize,
  signal,
  readBufferSize = 4 * 1024 * 1024,
  onHashed = () => undefined
}: {
  file: ReadablePositionedFile;
  size: number;
  segmentSize: number;
  signal?: AbortSignal;
  readBufferSize?: number;
  onHashed?: (bytes: number) => void;
}) {
  if (!Number.isSafeInteger(readBufferSize) || readBufferSize <= 0) throw new TypeError("Hash read buffer size must be a positive integer.");
  const segments = getSegments(size, segmentSize);
  const hasher = await createSHA256();
  hasher.init();
  const ready = new Set<number>();
  const buffer = new Uint8Array(Math.min(readBufferSize, Math.max(1, segmentSize)));
  let nextSegment = 0;
  let hashedBytes = 0;
  let drainChain = Promise.resolve();

  const drain = async () => {
    while (nextSegment < segments.length && ready.has(nextSegment)) {
      throwIfAborted(signal);
      const segment = segments[nextSegment]!;
      let offset = 0;
      while (offset < segment.length) {
        throwIfAborted(signal);
        const requested = Math.min(buffer.byteLength, segment.length - offset);
        const count = await file.read(buffer.subarray(0, requested), segment.start + offset);
        if (!Number.isSafeInteger(count) || count <= 0 || count > requested) {
          throw new Error(`Positioned hash read did not make progress for segment ${segment.index}.`);
        }
        hasher.update(buffer.subarray(0, count));
        offset += count;
        hashedBytes += count;
        onHashed(hashedBytes);
      }
      nextSegment += 1;
    }
  };
  const scheduleDrain = () => {
    drainChain = drainChain.then(drain);
    return drainChain;
  };

  return {
    markComplete(index: number) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
        return Promise.reject(new RangeError(`Invalid completed segment index ${index}.`));
      }
      ready.add(index);
      return scheduleDrain();
    },
    markMany(indices: Iterable<number>) {
      for (const index of indices) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
          return Promise.reject(new RangeError(`Invalid completed segment index ${index}.`));
        }
        ready.add(index);
      }
      return scheduleDrain();
    },
    async digest() {
      await scheduleDrain();
      if (nextSegment !== segments.length || hashedBytes !== size) {
        throw new Error(`Cannot finalize artifact hash at ${hashedBytes} of ${size} bytes.`);
      }
      return hasher.digest("hex");
    }
  };
}

function getSegments(size: number, segmentSize: number): Segment[] {
  return Array.from({ length: Math.ceil(size / segmentSize) }, (_, index) => {
    const start = index * segmentSize;
    return { index, start, length: Math.min(segmentSize, size - start) };
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The model download was aborted.", "AbortError");
}
