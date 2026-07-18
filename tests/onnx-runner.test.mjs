import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./alias-loader.mjs", import.meta.url);
const { prepareGenerationInput, readGeneratedText, runOnnxTextModel } = await import("../src/lib/onnx-runner.ts");

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
