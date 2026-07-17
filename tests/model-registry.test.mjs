import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ONNX_MODEL, MODEL_REGISTRY, requireModelDefinition } from "../src/lib/onnx-models.ts";

test("keeps the bundled manifest aligned with the exported fixed-context graph", () => {
  assert.equal(DEFAULT_ONNX_MODEL.id, "tiny-gpt2");
  assert.equal(DEFAULT_ONNX_MODEL.format.contextLength, 64);
});

test("rejects unknown model identifiers at runtime boundaries", () => {
  assert.throws(() => requireModelDefinition("not-a-model"), /Unknown model identifier/);
});

test("pins remote model sources to immutable commit revisions", () => {
  const remoteModels = MODEL_REGISTRY.filter((model) => model.source.kind === "huggingface");
  assert.ok(remoteModels.length > 0);
  for (const model of remoteModels) assert.match(model.source.revision, /^[a-f0-9]{40}$/);
});
