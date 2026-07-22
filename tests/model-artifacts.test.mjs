import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const seedPath = new URL("models/model-artifacts.seed.json", root);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const expectedSourcePaths = [
  "config.json",
  "generation_config.json",
  "onnx/model_q4f16.onnx",
  "onnx/model_q4f16.onnx_data",
  "onnx/model_q4f16.onnx_data_1",
  "tokenizer.json",
  "tokenizer_config.json"
];
const expectedNormalizedShards = [
  "onnx/model_q4f16.onnx_data",
  "onnx/model_q4f16.onnx_data_1",
  "onnx/model_q4f16.onnx_data_2",
  "onnx/model_q4f16.onnx_data_3",
  "onnx/model_q4f16.onnx_data_4"
];

test("pins the five-shard Tiny Aya artifact plan and immutable provenance", () => {
  assert.equal(seed.schemaVersion, 1);
  assert.deepEqual(seed.pipeline, {
    configPath: "config.json",
    externalTensorCount: 799,
    graphPath: "onnx/model_q4f16.onnx",
    initializerCount: 801,
    maxShardSizeBytes: 448 * 1024 ** 2,
    metadataPaths: ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json"],
    normalizedShardPaths: expectedNormalizedShards,
    onnxIrCommit: "32283c3dcae562b742adf119e943785ee12d1426",
    quantization: "q4f16",
    shardCount: 5,
    sourceShardCount: 2,
    topologicallySortGraph: true
  });

  const expectedModels = new Map([
    ["tiny-aya-global", 2_354_413_407],
    ["tiny-aya-earth", 2_354_413_397],
    ["tiny-aya-fire", 2_354_413_397],
    ["tiny-aya-water", 2_354_413_397]
  ]);
  assert.deepEqual(seed.models.map((model) => model.id), [...expectedModels.keys()]);
  for (const model of seed.models) {
    assert.match(model.source.repo, /^onnx-community\/tiny-aya-(global|earth|fire|water)-ONNX$/);
    assert.match(model.source.revision, /^[0-9a-f]{40}$/);
    assert.deepEqual(model.source.files.map((file) => file.path), expectedSourcePaths);
    assert.equal(
      model.source.files.reduce((total, file) => total + file.sizeBytes, 0),
      expectedModels.get(model.id)
    );
    for (const file of model.source.files) {
      assert.ok(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test("records shared graph and tokenizer bytes while keeping regional weights distinct", () => {
  const records = seed.models.map((model) => new Map(model.source.files.map((file) => [file.path, file])));
  assert.equal(new Set(records.map((files) => files.get("onnx/model_q4f16.onnx").sha256)).size, 1);
  assert.equal(new Set(records.map((files) => files.get("tokenizer.json").sha256)).size, 1);
  assert.equal(new Set(records.map((files) => files.get("onnx/model_q4f16.onnx_data").sha256)).size, 4);
  assert.equal(new Set(records.map((files) => files.get("onnx/model_q4f16.onnx_data_1").sha256)).size, 4);
});

test("artifact CLIs expose help without importing optional multi-gigabyte build dependencies", () => {
  for (const script of ["scripts/reshard_onnx.py", "scripts/verify_model_artifacts.py"]) {
    const result = spawnSync("python3", [join(rootPath, script), "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script} --help failed:\n${result.stderr}`);
    assert.match(result.stdout, /usage:/i);
  }
});

test("re-sharding refuses an existing output directory before reading model bytes", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sophon-artifact-safety-"));
  const inputDir = join(temporaryRoot, "input");
  const outputDir = join(temporaryRoot, "output");
  try {
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    const result = spawnSync("python3", [
      join(rootPath, "scripts/reshard_onnx.py"),
      "--model-id", "tiny-aya-global",
      "--input-dir", inputDir,
      "--output-dir", outputDir,
      "--seed", fileURLToPath(seedPath)
    ], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /output directory must not already exist/i);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
