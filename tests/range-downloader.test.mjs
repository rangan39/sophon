import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  downloadRangeArtifact,
  RangeContractError,
  RangeDeliveryUnavailableError
} from "../src/lib/model-delivery/range-downloader.ts";

test("streams positioned ranges with global concurrency four and flushes before every checkpoint", async () => {
  const bytes = Uint8Array.from({ length: 53 }, (_, index) => index * 7 % 251);
  const events = [];
  const file = new MemoryPositionedFile(events);
  const stateStore = new MemoryStateStore(events);
  const server = createRangeServer(bytes, { delayForStart: (start) => 18 - start % 17 });

  const result = await downloadRangeArtifact({
    artifact: artifact(bytes),
    file,
    stateStore,
    fetch: server.fetch,
    segmentSize: 8,
    retries: 0
  });

  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(server.maxActive, 4);
  assert.equal(stateStore.value?.status, "ready");
  assert.deepEqual(stateStore.value?.completed, [0, 1, 2, 3, 4, 5, 6]);
  for (let index = 0; index < events.length; index += 1) {
    if (events[index] === "put") assert.equal(events.slice(0, index).findLast((event) => event === "flush" || event === "put"), "flush");
  }
});

test("resumes durable segments without requesting them again", async () => {
  const bytes = Uint8Array.from({ length: 25 }, (_, index) => 100 + index);
  const file = new MemoryPositionedFile([], bytes.slice(0, 8));
  const stateStore = new MemoryStateStore([], {
    key: "fixture",
    version: 1,
    size: bytes.length,
    sha256: digest(bytes),
    segmentSize: 8,
    etag: '"fixture-etag"',
    completed: [0],
    status: "partial"
  });
  const server = createRangeServer(bytes);
  const progress = [];

  await downloadRangeArtifact({ artifact: artifact(bytes), file, stateStore, fetch: server.fetch, segmentSize: 8, retries: 0, onProgress: (event) => progress.push(event) });

  assert.equal(server.ranges.includes("bytes=0-7"), false);
  assert.ok(progress.some((event) => event.stage === "resume" && event.resumedBytes === 8));
  assert.deepEqual(file.bytes, bytes);
});

test("invalidates resumed bytes when the strong ETag changes", async () => {
  const bytes = Uint8Array.from({ length: 17 }, (_, index) => index + 1);
  const events = [];
  const file = new MemoryPositionedFile(events, bytes.slice(0, 8));
  const stateStore = new MemoryStateStore(events, {
    key: "fixture",
    version: 1,
    size: bytes.length,
    sha256: digest(bytes),
    segmentSize: 8,
    etag: '"old-etag"',
    completed: [0],
    status: "partial"
  });
  const server = createRangeServer(bytes, { etag: '"new-etag"' });

  await downloadRangeArtifact({ artifact: artifact(bytes), file, stateStore, fetch: server.fetch, segmentSize: 8, retries: 0 });

  assert.ok(server.ranges.includes("bytes=0-7"));
  assert.equal(stateStore.value?.etag, '"new-etag"');
  assert.deepEqual(file.bytes, bytes);
});

test("resets an oversized stale file instead of trapping the cache in a contract failure", async () => {
  const bytes = Uint8Array.from({ length: 17 }, (_, index) => index + 1);
  const staleBytes = new Uint8Array(bytes.length + 3);
  staleBytes.set(bytes);
  staleBytes.set([90, 91, 92], bytes.length);
  const file = new MemoryPositionedFile([], staleBytes);
  const stateStore = new MemoryStateStore([], {
    key: "fixture",
    version: 1,
    size: bytes.length,
    sha256: digest(bytes),
    segmentSize: 8,
    etag: '"fixture-etag"',
    completed: [0, 1, 2],
    status: "ready"
  });
  const server = createRangeServer(bytes);

  await downloadRangeArtifact({ artifact: artifact(bytes), file, stateStore, fetch: server.fetch, segmentSize: 8, retries: 0 });

  assert.ok(server.ranges.includes("bytes=0-7"));
  assert.deepEqual(file.bytes, bytes);
  assert.equal(stateStore.value?.status, "ready");
});

test("retries transient range failures but rejects a malformed Content-Range", async () => {
  const bytes = Uint8Array.from({ length: 12 }, (_, index) => index + 20);
  const transient = createRangeServer(bytes, { failRangeOnce: "bytes=0-5" });
  await downloadRangeArtifact({
    artifact: artifact(bytes),
    file: new MemoryPositionedFile([]),
    stateStore: new MemoryStateStore([]),
    fetch: transient.fetch,
    segmentSize: 6,
    retries: 1
  });
  assert.equal(transient.ranges.filter((range) => range === "bytes=0-5").length, 2);

  const malformed = createRangeServer(bytes, { malformedRange: "bytes=0-5" });
  await assert.rejects(() => downloadRangeArtifact({
    artifact: artifact(bytes),
    file: new MemoryPositionedFile([]),
    stateStore: new MemoryStateStore([]),
    fetch: malformed.fetch,
    segmentSize: 6,
    retries: 2
  }), RangeContractError);
  assert.equal(malformed.ranges.filter((range) => range === "bytes=0-5").length, 1);
});

test("falls back only when range delivery is unavailable", async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  const file = new MemoryPositionedFile([], bytes);
  const stateStore = new MemoryStateStore([]);
  await assert.rejects(() => downloadRangeArtifact({
    artifact: artifact(bytes),
    file,
    stateStore,
    fetch: async () => new Response(bytes, { status: 200, headers: { etag: '"fixture-etag"', "content-length": String(bytes.length) } }),
    segmentSize: 2,
    retries: 0
  }), RangeDeliveryUnavailableError);
  assert.equal(file.bytes.length, 0);
  assert.equal(stateStore.value, undefined);
});

test("deletes a file that fails final SHA-256 verification twice", async () => {
  const expected = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const corrupt = expected.map((value) => value ^ 0xff);
  const file = new MemoryPositionedFile([]);
  const stateStore = new MemoryStateStore([]);
  const server = createRangeServer(corrupt);

  await assert.rejects(() => downloadRangeArtifact({
    artifact: artifact(expected),
    file,
    stateStore,
    fetch: server.fetch,
    segmentSize: 4,
    retries: 0
  }), /SHA-256 mismatch/);
  assert.equal(file.bytes.length, 0);
  assert.equal(stateStore.value, undefined);
  assert.equal(server.ranges.filter((range) => range === "bytes=0-3").length, 2);
});

function artifact(bytes) {
  return { key: "fixture", url: "https://example.test/model.bin", size: bytes.length, sha256: digest(bytes) };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class MemoryPositionedFile {
  constructor(events, initial = new Uint8Array()) {
    this.events = events;
    this.bytes = initial.slice();
  }
  getSize() { return this.bytes.length; }
  truncate(size) {
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, size));
    this.bytes = next;
    this.events.push("truncate");
  }
  write(data, offset) {
    if (offset + data.length > this.bytes.length) this.truncate(offset + data.length);
    this.bytes.set(data, offset);
    this.events.push("write");
    return data.length;
  }
  flush() { this.events.push("flush"); }
  getFile() { return Promise.resolve(new File([this.bytes], "model.bin")); }
}

class MemoryStateStore {
  constructor(events, value) {
    this.events = events;
    this.value = value;
  }
  async get() { return this.value ? structuredClone(this.value) : undefined; }
  async put(value) {
    this.events.push("put");
    this.value = structuredClone(value);
  }
  async delete() {
    this.events.push("delete");
    this.value = undefined;
  }
}

function createRangeServer(bytes, options = {}) {
  const etag = options.etag ?? '"fixture-etag"';
  const ranges = [];
  let active = 0;
  let maxActive = 0;
  let failed = false;
  const fetch = async (_url, init = {}) => {
    const headers = new Headers(init.headers);
    const range = headers.get("range");
    assert.ok(range);
    ranges.push(range);
    const match = range.match(/^bytes=(\d+)-(\d+)$/);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (range !== "bytes=0-0") assert.equal(headers.get("if-range"), etag);
    if (!failed && options.failRangeOnce === range) {
      failed = true;
      return new Response("busy", { status: 503 });
    }
    const body = bytes.slice(start, end + 1);
    let offset = 0;
    let finished = false;
    active += 1;
    maxActive = Math.max(maxActive, active);
    const finish = () => {
      if (finished) return;
      finished = true;
      active -= 1;
    };
    const stream = new ReadableStream({
      async pull(controller) {
        if (offset === 0 && options.delayForStart) await delay(options.delayForStart(start));
        const next = Math.min(body.length, offset + Math.max(1, Math.ceil(body.length / 2)));
        controller.enqueue(body.slice(offset, next));
        offset = next;
        if (offset === body.length) {
          controller.close();
          finish();
        }
      },
      cancel() { finish(); }
    });
    const contentRange = options.malformedRange === range
      ? `bytes ${start + 1}-${end}/${bytes.length}`
      : `bytes ${start}-${end}/${bytes.length}`;
    return new Response(stream, {
      status: 206,
      headers: { etag, "content-length": String(body.length), "content-range": contentRange }
    });
  };
  return { fetch, ranges, get maxActive() { return maxActive; } };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
