#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pipeline, TextStreamer } from "@huggingface/transformers";

const modelPath = process.argv[2] ?? "public/models/sshleifer-tiny-gpt2-trace";
const measuredRuns = boundedInteger(process.env.SOPHON_BENCH_RUNS, 10, 1, 100);
const warmupRuns = boundedInteger(process.env.SOPHON_BENCH_WARMUPS, 2, 0, 10);
const maxNewTokens = boundedInteger(process.env.SOPHON_BENCH_TOKENS, 32, 1, 256);
const minimumTokensPerSecond = Number(process.env.SOPHON_BENCH_MIN_TPS ?? 500);
const prompt = process.env.SOPHON_BENCH_PROMPT ?? "The signal arrived just after midnight";

const loadStartedAt = performance.now();
const generator = await pipeline("text-generation", modelPath, {
  device: "cpu",
  dtype: "fp32",
  local_files_only: true
});
const loadMs = performance.now() - loadStartedAt;

try {
  for (let index = 0; index < warmupRuns; index += 1) await generate();
  const runs = [];
  for (let index = 0; index < measuredRuns; index += 1) runs.push(await generate());

  const medianTokensPerSecond = median(runs.map((run) => run.tokensPerSecond));
  console.log(JSON.stringify({
    modelPath,
    provider: "cpu",
    prompt,
    maxNewTokens,
    warmupRuns,
    measuredRuns,
    loadMs: round(loadMs),
    medianEndToEndMs: round(median(runs.map((run) => run.endToEndMs))),
    medianTtftMs: round(median(runs.map((run) => run.ttftMs))),
    medianOutputTokens: median(runs.map((run) => run.outputTokens)),
    medianTokensPerSecond: round(medianTokensPerSecond),
    minimumTokensPerSecond
  }, null, 2));
  if (!Number.isFinite(minimumTokensPerSecond) || medianTokensPerSecond < minimumTokensPerSecond) {
    throw new Error(`Runtime throughput ${round(medianTokensPerSecond)} tok/s is below the ${minimumTokensPerSecond} tok/s budget.`);
  }
} finally {
  await generator.dispose?.();
}

async function generate() {
  let firstTokenAt = null;
  let outputTokens = 0;
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: () => undefined,
    token_callback_function: () => {
      outputTokens += 1;
      firstTokenAt ??= performance.now();
    }
  });
  const startedAt = performance.now();
  await generator(prompt, {
    do_sample: false,
    max_new_tokens: maxNewTokens,
    return_full_text: false,
    streamer
  });
  const completedAt = performance.now();
  const endToEndMs = completedAt - startedAt;
  const ttftMs = (firstTokenAt ?? completedAt) - startedAt;
  const decodeMs = Math.max(0, completedAt - (firstTokenAt ?? completedAt));
  return {
    endToEndMs,
    outputTokens,
    ttftMs,
    tokensPerSecond: outputTokens > 1 && decodeMs > 0 ? (outputTokens - 1) * 1000 / decodeMs : 0
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
