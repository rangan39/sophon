#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const seedUrl = new URL("../models/model-artifacts.seed.json", import.meta.url);
const seed = JSON.parse(await readFile(seedUrl, "utf8"));
const segmentSize = readPositiveInteger(process.env.SOPHON_SEGMENT_SIZE, 64 * 1024 * 1024);
const fileConcurrency = readPositiveInteger(process.env.SOPHON_SEGMENT_HASH_CONCURRENCY, 8);
const artifacts = seed.models.flatMap((model) => model.source.files
  .filter((file) => file.path.startsWith("onnx/") && file.path.includes(".onnx_data"))
  .map((file) => ({
    key: `${model.id}:${file.path}`,
    url: `https://huggingface.co/${model.source.repo}/resolve/${model.source.revision}/${file.path}`,
    size: file.sizeBytes,
    sha256: file.sha256
  })));
const results = new Array(artifacts.length);
let nextArtifact = 0;

await Promise.all(Array.from({ length: Math.min(fileConcurrency, artifacts.length) }, async () => {
  while (true) {
    const index = nextArtifact;
    nextArtifact += 1;
    if (index >= artifacts.length) return;
    results[index] = await hashArtifact(artifacts[index]);
    console.error(`hashed ${index + 1}/${artifacts.length}: ${artifacts[index].key}`);
  }
}));

const entries = results.map(({ sha256, segments }) => `  "${sha256}": [\n${segments.map((digest) => `    "${digest}"`).join(",\n")}\n  ]`).join(",\n");
console.log(`export const MODEL_SEGMENT_DIGESTS: Readonly<Record<string, readonly string[]>> = {\n${entries}\n};`);

async function hashArtifact(artifact) {
  const whole = createHash("sha256");
  const segments = [];
  let etag;
  for (let start = 0; start < artifact.size; start += segmentSize) {
    const end = Math.min(artifact.size, start + segmentSize) - 1;
    const response = await fetch(artifact.url, {
      headers: { Range: `bytes=${start}-${end}`, ...(etag ? { "If-Range": etag } : {}) },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(5 * 60_000)
    });
    if (response.status !== 206) throw new Error(`${artifact.key} returned HTTP ${response.status} for ${start}-${end}.`);
    const expectedRange = `bytes ${start}-${end}/${artifact.size}`;
    if (response.headers.get("content-range") !== expectedRange) throw new Error(`${artifact.key} returned an invalid Content-Range.`);
    if (Number(response.headers.get("content-length")) !== end - start + 1) throw new Error(`${artifact.key} returned an invalid Content-Length.`);
    const responseEtag = response.headers.get("etag");
    if (!responseEtag || responseEtag.startsWith("W/") || etag && responseEtag !== etag) throw new Error(`${artifact.key} did not retain one strong ETag.`);
    etag = responseEtag;
    const segment = createHash("sha256");
    let received = 0;
    for await (const chunk of response.body ?? []) {
      received += chunk.byteLength;
      segment.update(chunk);
      whole.update(chunk);
    }
    if (received !== end - start + 1) throw new Error(`${artifact.key} ended at ${received} bytes for ${start}-${end}.`);
    segments.push(segment.digest("hex"));
  }
  const actual = whole.digest("hex");
  if (actual !== artifact.sha256) throw new Error(`${artifact.key} whole-file SHA-256 mismatch: expected ${artifact.sha256}, got ${actual}.`);
  return { sha256: artifact.sha256, segments };
}

function readPositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  return parsed;
}
