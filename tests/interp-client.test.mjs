import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);

const timers = new Map();
const scheduled = [];
let nextTimerId = 0;
let lastRequest;
let respond;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback, delay) {
      const id = nextTimerId += 1;
      timers.set(id, { callback, delay });
      scheduled.push({ id, delay });
      return id;
    }
  }
});

Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  value: class FakeWorker {
    constructor() {
      this.onmessage = null;
      respond = (response) => this.onmessage?.({ data: response });
    }
    postMessage(request) { lastRequest = request; }
    terminate() {}
  }
});

const { preloadModel, terminateRuntimeWorker } = await import("../src/lib/interp-client.ts");

test("preload uses an idle watchdog refreshed only by meaningful progress plus an overall ceiling", async () => {
  const loading = preloadModel("tiny-aya-global");
  assert.equal(lastRequest.type, "preload");
  assert.deepEqual(scheduled.map(({ delay }) => delay), [2 * 60_000, 6 * 60 * 60_000]);

  const log = (progress) => respond({
    type: "log",
    requestId: lastRequest.requestId,
    event: { level: "info", message: "Loading", phase: "download", progress }
  });
  log({ loaded: 10, total: 100, stage: "download" });
  assert.equal(scheduled.length, 3);
  log({ loaded: 10, total: 100, stage: "download", bytesPerSecond: 20 });
  assert.equal(scheduled.length, 3, "duplicate byte progress must not keep a stalled worker alive");
  log({ loaded: 20, total: 100, stage: "download" });
  assert.equal(scheduled.length, 4);
  log({ loaded: 0, total: 100, stage: "verify" });
  assert.equal(scheduled.length, 5, "a new delivery stage starts a fresh idle window");
  assert.deepEqual([...timers.values()].map(({ delay }) => delay).sort((a, b) => a - b), [2 * 60_000, 6 * 60 * 60_000]);

  respond({ type: "complete", requestId: lastRequest.requestId, result: { ok: true } });
  await loading;
  assert.equal(timers.size, 0);
  terminateRuntimeWorker();
});
