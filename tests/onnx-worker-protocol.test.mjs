import assert from "node:assert/strict";
import test from "node:test";
import { isWorkerRequest, isWorkerResponse, isWorkerResult } from "../src/lib/onnx-worker-protocol.ts";

test("accepts valid generation requests and rejects malformed numeric options", () => {
  assert.equal(isWorkerRequest({
    type: "generate",
    requestId: "request-1",
    messages: [{ role: "user", content: "The signal is" }],
    modelId: "tiny-aya-global",
    options: { maxNewTokens: 24, temperature: 0.8, topK: 40 }
  }), true);

  assert.equal(isWorkerRequest({
    type: "generate",
    requestId: "request-2",
    messages: [{ role: "user", content: "The signal is" }],
    modelId: "tiny-aya-global",
    options: { maxNewTokens: "24" }
  }), false);

  assert.equal(isWorkerRequest({
    type: "generate",
    requestId: "request-3",
    messages: [{ role: "tool", content: "not supported" }],
    modelId: "tiny-aya-global",
    options: {}
  }), false);
});

test("accepts targeted cancellation requests and validates acknowledgements", () => {
  assert.equal(isWorkerRequest({
    type: "cancel",
    requestId: "cancel-1",
    targetRequestId: "request-1"
  }), true);
  assert.equal(isWorkerRequest({
    type: "cancel",
    requestId: "cancel-2",
    targetRequestId: ""
  }), false);

  assert.equal(isWorkerResult("cancel", {
    cancelled: true,
    targetRequestId: "request-1"
  }), true);
  assert.equal(isWorkerResult("cancel", {
    cancelled: false,
    targetRequestId: null
  }), true);
  assert.equal(isWorkerResult("cancel", {
    cancelled: true,
    targetRequestId: null
  }), false);
  assert.equal(isWorkerResult("cancel", {
    cancelled: "yes",
    targetRequestId: "request-1"
  }), false);
});

test("accepts explicit model preloads and validates completion", () => {
  assert.equal(isWorkerRequest({ type: "preload", requestId: "preload-1", modelId: "tiny-aya-global" }), true);
  assert.equal(isWorkerRequest({ type: "preload", requestId: "preload-2", modelId: "" }), false);
  assert.equal(isWorkerResult("preload", { ok: true }), true);
});

test("validates worker events before dispatching them", () => {
  assert.equal(isWorkerResponse({
    type: "telemetry",
    requestId: "request-1",
    telemetry: {
      phase: "decode",
      promptTokenCount: 3,
      contextTokenCount: 3,
      outputTokenCount: 2,
      endToEndMs: 12,
      ttftMs: 8,
      decodeMs: 4,
      decodeTokensPerSecond: 250,
      timePerOutputTokenMs: 4,
      latestInterTokenLatencyMs: 4,
      p95InterTokenLatencyMs: null
    }
  }), true);
  assert.equal(isWorkerResponse({
    type: "log",
    requestId: "request-1",
    event: { level: "info", message: "Retrying", phase: "download", progress: { loaded: 90, total: 100, networkBytes: 125 } }
  }), true, "retried bytes may exceed the unique artifact size");
  assert.equal(isWorkerResponse({ type: "log", requestId: "request-1", event: { level: "info", message: "Loading", phase: "download", progress: { loaded: 25, total: 100 } } }), true);
  assert.equal(isWorkerResponse({
    type: "log",
    requestId: "request-1",
    event: {
      level: "info",
      message: "Resuming",
      phase: "download",
      progress: { loaded: 75, total: 100, stage: "resume", resumedBytes: 50, networkBytes: 25, bytesPerSecond: 20, etaMs: 1250 }
    }
  }), true);
  for (const progress of [{ loaded: -1, total: 100 }, { loaded: 101, total: 100 }, { loaded: 0, total: 0 }, { loaded: Number.NaN, total: 100 }]) {
    assert.equal(isWorkerResponse({ type: "log", requestId: "request-1", event: { level: "info", message: "Loading", progress } }), false);
  }
  for (const progress of [
    { loaded: 25, total: 100, stage: "unknown" },
    { loaded: 25, total: 100, resumedBytes: 101 },
    { loaded: 25, total: 100, networkBytes: -1 },
    { loaded: 25, total: 100, bytesPerSecond: Number.NaN },
    { loaded: 25, total: 100, etaMs: -1 }
  ]) {
    assert.equal(isWorkerResponse({ type: "log", requestId: "request-1", event: { level: "info", message: "Loading", progress } }), false);
  }
  assert.equal(isWorkerResponse({ type: "error", requestId: "request-1" }), false);
});

test("checks operation-specific completion envelopes", () => {
  assert.equal(isWorkerResult("capabilities", { webgpu: true, wasm: true, crossOriginIsolated: false }), true);
  assert.equal(isWorkerResult("generate", { ok: false, code: "REQUEST_FAILED", message: "failed" }), true);
  assert.equal(isWorkerResult("generate", { ok: false, code: "CANCELLED", message: "Generation cancelled." }), true);
  assert.equal(isWorkerResult("generate", { ok: false, code: "UNKNOWN", message: "failed" }), false);
  assert.equal(isWorkerResult("generate", { ok: true, result: {} }), false);
});
