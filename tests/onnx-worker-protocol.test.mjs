import assert from "node:assert/strict";
import test from "node:test";
import { isWorkerRequest, isWorkerResponse, isWorkerResult } from "../src/lib/onnx-worker-protocol.ts";

test("accepts valid generation requests and rejects malformed numeric options", () => {
  assert.equal(isWorkerRequest({
    type: "generate",
    requestId: "request-1",
    prompt: "The signal is",
    modelId: "tiny-gpt2",
    options: { maxNewTokens: 24, temperature: 0.8, topK: 40 }
  }), true);

  assert.equal(isWorkerRequest({
    type: "generate",
    requestId: "request-2",
    prompt: "The signal is",
    modelId: "tiny-gpt2",
    options: { maxNewTokens: "24" }
  }), false);
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
      p95InterTokenLatencyMs: 4
    }
  }), true);
  assert.equal(isWorkerResponse({ type: "error", requestId: "request-1" }), false);
});

test("checks operation-specific completion envelopes", () => {
  assert.equal(isWorkerResult("capabilities", { webgpu: true, wasm: true, crossOriginIsolated: false }), true);
  assert.equal(isWorkerResult("generate", { ok: false, code: "REQUEST_FAILED", message: "failed" }), true);
  assert.equal(isWorkerResult("generate", { ok: true, result: {} }), false);
});
