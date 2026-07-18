import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { env, pipelineCalls, pipelineRemotePathTemplates } = await import("@huggingface/transformers");
const { preloadOnnxModel, prepareGenerationInput, readGeneratedText, runOnnxTextModel } = await import("../src/lib/onnx-runner.ts");

test("prepares GPT-2 turns as a completion prompt with an assistant cue", () => {
  assert.equal(prepareGenerationInput("gpt2", [
    { role: "system", content: " Be concise. " },
    { role: "user", content: " Hello " },
    { role: "assistant", content: " Hi. " },
    { role: "user", content: " Continue " }
  ]), "System: Be concise.\n\nUser: Hello\n\nAssistant: Hi.\n\nUser: Continue\n\nAssistant:");
});

test("preserves structured turns for instruct-model chat templates", () => {
  assert.deepEqual(prepareGenerationInput("qwen", [
    { role: "system", content: " Be concise. " },
    { role: "user", content: " Hello " },
    { role: "assistant", content: "   " }
  ]), [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" }
  ]);
});

test("reads generated text from completion and chat pipeline results", () => {
  assert.equal(readGeneratedText([{ generated_text: "completion" }]), "completion");
  assert.equal(readGeneratedText([{
    generated_text: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "chat response" }
    ]
  }]), "chat response");
  assert.equal(readGeneratedText([{ unexpected: true }]), "");
});

test("returns typed cancellation before loading a model for an aborted request", async () => {
  const controller = new AbortController();
  controller.abort();

  assert.deepEqual(await runOnnxTextModel([{ role: "user", content: "Hello" }], {
    modelId: "tiny-gpt2",
    signal: controller.signal
  }), {
    ok: false,
    code: "CANCELLED",
    message: "Generation cancelled."
  });
});

test("preloads and reuses the pinned Tiny Aya WebGPU pipeline without generating", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: { requestAdapter: async () => ({}) } } });
  pipelineCalls.length = 0;
  pipelineRemotePathTemplates.length = 0;
  const logs = [];
  await preloadOnnxModel("tiny-aya-global", (event) => logs.push(event));
  await preloadOnnxModel("tiny-aya-global", (event) => logs.push(event));

  assert.equal(pipelineCalls.length, 1);
  assert.deepEqual(pipelineCalls[0], [
    "text-generation",
    "onnx-community/tiny-aya-global-ONNX",
    { device: "webgpu", dtype: "q4f16", revision: "7fff1be9627e40f0d89c33f406882bdafb56ec90" }
  ]);
  assert.equal(pipelineRemotePathTemplates[0], "{model}/resolve/7fff1be9627e40f0d89c33f406882bdafb56ec90/");
  assert.equal(env.remotePathTemplate, "{model}/resolve/{revision}/");
  assert.equal(env.allowLocalModels, false);
  assert.equal(env.allowRemoteModels, true);
  assert.equal(logs[0]?.phase, "download");
  assert.match(logs.at(-1)?.message ?? "", /cached model pipeline/i);
});
