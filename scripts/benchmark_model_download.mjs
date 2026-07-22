#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const MiB = 1024 * 1024;
const url = process.env.SOPHON_BENCHMARK_URL
  ?? "https://huggingface.co/onnx-community/tiny-aya-global-ONNX/resolve/7fff1be9627e40f0d89c33f406882bdafb56ec90/onnx/model_q4f16.onnx_data";
const sampleBytes = readPositiveInteger(process.env.SOPHON_BENCHMARK_BYTES, 64 * MiB);
const trialCount = readPositiveInteger(process.env.SOPHON_BENCHMARK_TRIALS, 3);
const concurrencyValues = (process.env.SOPHON_BENCHMARK_CONCURRENCY ?? "1,2,4")
  .split(",")
  .map((value) => readPositiveInteger(value.trim()))
  .filter((value, index, values) => values.indexOf(value) === index);

const probe = await requestRange(0, 0);
const totalBytes = readTotalBytes(probe.headers.get("content-range"));
await probe.body?.cancel();
const bytesToRead = Math.min(sampleBytes, totalBytes);
const samples = [];

for (let trial = 0; trial < trialCount; trial += 1) {
  const order = trial % 2 === 0 ? concurrencyValues : [...concurrencyValues].reverse();
  for (const concurrency of order) {
    const ranges = partition(bytesToRead, concurrency);
    const startedAt = performance.now();
    const transferred = (await Promise.all(ranges.map(({ start, end }) => consumeRange(start, end))))
      .reduce((total, value) => total + value, 0);
    const durationMs = performance.now() - startedAt;
    samples.push({
      trial: trial + 1,
      concurrency,
      transferredBytes: transferred,
      durationMs: Math.round(durationMs),
      mebibytesPerSecond: Number((transferred / MiB / (durationMs / 1000)).toFixed(2))
    });
  }
}

const summaries = concurrencyValues.map((concurrency) => {
  const throughput = samples
    .filter((sample) => sample.concurrency === concurrency)
    .map((sample) => sample.mebibytesPerSecond)
    .sort((left, right) => left - right);
  return {
    concurrency,
    trials: throughput.length,
    minimumMebibytesPerSecond: throughput[0],
    medianMebibytesPerSecond: percentile(throughput, 0.5),
    p95MebibytesPerSecond: percentile(throughput, 0.95),
    maximumMebibytesPerSecond: throughput.at(-1)
  };
});

console.log(JSON.stringify({ url, totalBytes, sampleBytes: bytesToRead, trialCount, samples, summaries }, null, 2));

async function consumeRange(start, end) {
  const response = await requestRange(start, end);
  const expected = end - start + 1;
  if (Number(response.headers.get("content-length")) !== expected) {
    throw new Error(`Range ${start}-${end} returned an unexpected Content-Length.`);
  }
  let received = 0;
  for await (const chunk of response.body ?? []) received += chunk.byteLength;
  if (received !== expected) throw new Error(`Range ${start}-${end} ended at ${received} of ${expected} bytes.`);
  return received;
}

async function requestRange(start, end) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(2 * 60_000)
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(`Expected HTTP 206 for ${start}-${end}; received ${response.status}.`);
  }
  const expected = `bytes ${start}-${end}/`;
  if (!response.headers.get("content-range")?.startsWith(expected)) {
    await response.body?.cancel();
    throw new Error(`Invalid Content-Range for ${start}-${end}.`);
  }
  return response;
}

function partition(size, count) {
  const rangeCount = Math.min(count, size);
  return Array.from({ length: rangeCount }, (_, index) => {
    const start = Math.floor(index * size / rangeCount);
    const end = Math.floor((index + 1) * size / rangeCount) - 1;
    return { start, end };
  });
}

function readTotalBytes(contentRange) {
  const match = contentRange?.match(/^bytes 0-0\/(\d+)$/);
  if (!match) throw new Error("The range probe did not return a usable total size.");
  return readPositiveInteger(match[1]);
}

function readPositiveInteger(value, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  return parsed;
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}
