import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import nextConfig from "../next.config.mjs";
import { DEFAULT_ONNX_MODEL, MODEL_REGISTRY, requireModelDefinition, resolveModelProvider } from "../src/lib/onnx-models.ts";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledModelRoot = join(repositoryRoot, "public/models/sshleifer-tiny-gpt2-trace");

test("keeps the bundled manifest aligned with the cached-decoder config", () => {
  assert.equal(DEFAULT_ONNX_MODEL.id, "tiny-gpt2");
  const config = JSON.parse(readFileSync(join(bundledModelRoot, "config.json"), "utf8"));
  assert.equal(config.use_cache, true);
  assert.equal(DEFAULT_ONNX_MODEL.format.contextLength, config.n_positions);
  assert.ok(statSync(join(bundledModelRoot, "generation_config.json")).size > 0);
});

test("keeps the bundled size and content-addressed route aligned with tracked artifacts", async () => {
  const files = listFiles(bundledModelRoot);
  const sizeBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(bundledModelRoot, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  const version = `v-${hash.digest("hex").slice(0, 12)}`;

  assert.equal(DEFAULT_ONNX_MODEL.format.sizeBytes, sizeBytes);
  assert.equal(DEFAULT_ONNX_MODEL.format.sizeLabel, `${(sizeBytes / 1_000_000).toFixed(1)} MB`);
  assert.ok(DEFAULT_ONNX_MODEL.source.kind === "local");
  assert.ok(DEFAULT_ONNX_MODEL.source.baseUrl.startsWith(`/models/${version}/`));

  const rewrites = await nextConfig.rewrites();
  assert.ok(rewrites.some((rewrite) => rewrite.source.startsWith(`/models/${version}/`)));
  const headers = await nextConfig.headers();
  const cacheRule = headers.find((rule) => rule.source === `/models/${version}/:path*`);
  assert.match(cacheRule?.headers[0]?.value ?? "", /max-age=31536000, immutable/);
});

test("rejects unknown model identifiers at runtime boundaries", () => {
  assert.throws(() => requireModelDefinition("not-a-model"), /Unknown model identifier/);
});

test("pins remote model sources to immutable commit revisions", () => {
  const remoteModels = MODEL_REGISTRY.filter((model) => model.source.kind === "huggingface");
  assert.ok(remoteModels.length > 0);
  for (const model of remoteModels) assert.match(model.source.revision, /^[a-f0-9]{40}$/);
});

test("resolves the fastest compatible provider from one pure policy", () => {
  assert.equal(resolveModelProvider(DEFAULT_ONNX_MODEL, { webgpu: true, wasm: true }), "wasm");
  assert.equal(resolveModelProvider(DEFAULT_ONNX_MODEL, { webgpu: false, wasm: true }), "wasm");
  assert.equal(resolveModelProvider(MODEL_REGISTRY[1], { webgpu: false, wasm: true }), "wasm");
});

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)])
    .sort();
}
