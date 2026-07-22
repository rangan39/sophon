import assert from "node:assert/strict";
import test from "node:test";
import {
  getArtifactKey,
  getArtifactUrl,
  getModelDeliveryManifest,
  MODEL_DELIVERY_MANIFESTS,
  MODEL_SEGMENT_SIZE
} from "../src/lib/model-delivery/manifest.ts";

const EXPECTED = {
  "tiny-aya-global": ["onnx-community/tiny-aya-global-ONNX", "7fff1be9627e40f0d89c33f406882bdafb56ec90", [
    "136c11c8985b57f58e4565b90b0aa63ab209cd250e1769a8c28f2781f550b1c4",
    "987f114e76909c265ee4ac80382bf2a6d508fbe99c892b030ac9c2a077b53373"
  ]],
  "tiny-aya-earth": ["onnx-community/tiny-aya-earth-ONNX", "24a24ee8b8483762575fe734e57bad21ca36d8c6", [
    "06934e8fe4b1cb3652c26cb75b4adddf51e5bfca3db236c37a73d5633c74104f",
    "7878d7ba2d83c1f9a2439deadc5b36a54de3b1c0a403a44847ac8aa9a1097a9e"
  ]],
  "tiny-aya-fire": ["onnx-community/tiny-aya-fire-ONNX", "70f6b7edf79955855d7939342d2a39ab644d3ed6", [
    "9abe27c21a14864773a0d9a3314c513fb771f4468e84b921b0298bdf0b3e8087",
    "702c83998ccab013a93735759a9e2e8d1c3318a7c6fadb2a50a0418fb0d6726d"
  ]],
  "tiny-aya-water": ["onnx-community/tiny-aya-water-ONNX", "e1109b664b476b709d13bf40dc105efb147caa09", [
    "a6bb9723276b6c7f0fa17532f0d1b5bd5595092444a30ff84ed3797bb62b7fba",
    "6c832d12d54831dd35df6f566fd200c6ec40965063bac54a9122b8c0b0d18943"
  ]]
};

test("pins the two current external-data artifacts for every Tiny Aya model", () => {
  assert.equal(MODEL_SEGMENT_SIZE, 64 * 1024 * 1024);
  assert.deepEqual(MODEL_DELIVERY_MANIFESTS.map(({ modelId }) => modelId), Object.keys(EXPECTED));
  for (const model of MODEL_DELIVERY_MANIFESTS) {
    const [repo, revision, hashes] = EXPECTED[model.modelId];
    assert.equal(model.repo, repo);
    assert.equal(model.revision, revision);
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    assert.deepEqual(model.externalData.map(({ path }) => path), [
      "onnx/model_q4f16.onnx_data",
      "onnx/model_q4f16.onnx_data_1"
    ]);
    assert.deepEqual(model.externalData.map(({ externalPath }) => externalPath), [
      "model_q4f16.onnx_data",
      "model_q4f16.onnx_data_1"
    ]);
    assert.deepEqual(model.externalData.map(({ size }) => size), [2_064_531_456, 268_435_456]);
    assert.deepEqual(model.externalData.map(({ sha256 }) => sha256), hashes);
    assert.equal(model.externalData.reduce((total, artifact) => total + artifact.size, 0), 2_332_966_912);
    for (const artifact of model.externalData) {
      assert.equal(getArtifactUrl(model, artifact), `https://huggingface.co/${repo}/resolve/${revision}/${artifact.path}`);
      assert.equal(getArtifactKey(model, artifact), `${model.modelId}:${revision}:${artifact.path}`);
    }
  }
});

test("does not resolve unregistered model identifiers", () => {
  assert.equal(getModelDeliveryManifest("not-a-model"), null);
});
