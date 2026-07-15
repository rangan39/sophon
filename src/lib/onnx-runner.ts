import { getModelDefinition, getModelRepo, type ModelManifest, type ModelProvider } from "@/lib/onnx-models";
import type {
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
  ModelLoadResult,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  OnnxRunResult,
  OnnxToken,
  RuntimeCapabilities
} from "@/lib/onnx-types";

type TensorLike = { data: ArrayLike<number | bigint>; dims: readonly number[] };
type TokenizerLike = {
  encode: (text: string, options?: Record<string, unknown>) => number[];
  decode: (tokenIds: number[] | bigint[], options?: Record<string, unknown>) => string;
  pad_token_id?: number | null;
  eos_token_id?: number | null;
};
type SessionLike = {
  inputNames?: string[];
  outputNames?: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, TensorLike>>;
  release?: () => Promise<void> | void;
};
type LocalRuntime = {
  tokenizer: TokenizerLike;
  session: SessionLike;
  tensor: new (type: "int64", data: BigInt64Array, dims: number[]) => unknown;
  sequenceLength: number;
};
type PipelineLike = ((prompt: string, options: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer?: TokenizerLike;
  dispose?: () => Promise<void> | void;
};
type Metadata = { base_model: string; sequence_length: number; output_names: string[] };

const localRuntimeCache = new Map<string, Promise<LocalRuntime>>();
const pipelineCache = new Map<string, Promise<PipelineLike>>();

export function getRuntimeCapabilities(): RuntimeCapabilities {
  const scope = globalThis as typeof globalThis & { navigator?: Navigator & { gpu?: unknown }; crossOriginIsolated?: boolean };
  return {
    webgpu: Boolean(scope.navigator?.gpu),
    wasm: typeof WebAssembly !== "undefined",
    crossOriginIsolated: Boolean(scope.crossOriginIsolated)
  };
}

export async function loadOnnxModel(modelId: string, onLog?: (event: OnnxLogEvent) => void): Promise<ModelLoadResult> {
  const model = getModelDefinition(modelId);
  const provider = resolveProvider(model);
  const log = onLog ?? (() => undefined);
  const cacheKey = `${model.id}:${provider}`;
  const reused = model.source.kind === "local" ? localRuntimeCache.has(model.id) : pipelineCache.has(cacheKey);
  const startedAt = performance.now();

  if (model.source.kind === "local") await getLocalRuntime(model, log);
  else await getPipeline(model, provider, log);

  return {
    modelId: model.id,
    label: model.label,
    provider,
    verification: model.verification,
    loadMs: performance.now() - startedAt,
    reused
  };
}

export async function runOnnxTextModel(prompt: string, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  const model = getModelDefinition(options.modelId);
  if (model.source.kind === "local") return runLocalModel(prompt, model, options);
  return runTransformersJsModel(prompt, model, options);
}

export async function unloadOnnxModel(modelId?: string) {
  const localIds = modelId ? [modelId] : [...localRuntimeCache.keys()];
  for (const id of localIds) {
    const runtimePromise = localRuntimeCache.get(id);
    localRuntimeCache.delete(id);
    if (!runtimePromise) continue;
    const runtime = await runtimePromise.catch(() => null);
    await runtime?.session.release?.();
  }

  const pipelineKeys = modelId
    ? [...pipelineCache.keys()].filter((key) => key.startsWith(`${modelId}:`))
    : [...pipelineCache.keys()];
  for (const key of pipelineKeys) {
    const pipelinePromise = pipelineCache.get(key);
    pipelineCache.delete(key);
    if (!pipelinePromise) continue;
    const pipeline = await pipelinePromise.catch(() => null);
    await pipeline?.dispose?.();
  }
}

export async function benchmarkOnnxModel(
  modelId: string,
  suite: BenchmarkSuite,
  options: { warmupRuns?: number; measuredRuns?: number; onLog?: (event: OnnxLogEvent) => void } = {}
): Promise<BenchmarkResult> {
  const warmupRuns = Math.max(0, Math.min(2, options.warmupRuns ?? 1));
  const measuredRuns = Math.max(1, Math.min(10, options.measuredRuns ?? 3));
  const runs: BenchmarkRun[] = [];
  let provider: ModelProvider | null = null;

  options.onLog?.({ level: "info", message: "Benchmark started", detail: `${suite.label} · ${measuredRuns} measured runs`, phase: "benchmark" });

  for (const benchmarkPrompt of suite.prompts) {
    for (let iteration = 0; iteration < warmupRuns; iteration += 1) {
      await runOnnxTextModel(benchmarkPrompt.prompt, {
        modelId,
        maxNewTokens: benchmarkPrompt.maxNewTokens,
        temperature: 0.05,
        topK: 1
      });
    }

    for (let iteration = 0; iteration < measuredRuns; iteration += 1) {
      const response = await runOnnxTextModel(benchmarkPrompt.prompt, {
        modelId,
        maxNewTokens: benchmarkPrompt.maxNewTokens,
        temperature: 0.05,
        topK: 1
      });
      if (response.ok) {
        provider = response.result.metrics.provider;
        runs.push({
          promptId: benchmarkPrompt.id,
          iteration,
          ok: true,
          generationMs: response.result.metrics.generationMs,
          firstTokenMs: response.result.metrics.firstTokenMs,
          tokensPerSecond: response.result.metrics.tokensPerSecond,
          outputTokenCount: response.result.metrics.outputTokenCount
        });
      } else {
        runs.push({
          promptId: benchmarkPrompt.id,
          iteration,
          ok: false,
          generationMs: null,
          firstTokenMs: null,
          tokensPerSecond: null,
          outputTokenCount: null,
          error: response.message
        });
      }
    }
  }

  const successful = runs.filter((run) => run.ok);
  const result: BenchmarkResult = {
    modelId,
    suiteId: suite.id,
    provider,
    warmupRuns,
    measuredRuns,
    runs,
    summary: {
      successfulRuns: successful.length,
      failedRuns: runs.length - successful.length,
      medianGenerationMs: median(successful.map((run) => run.generationMs)),
      medianTokensPerSecond: median(successful.map((run) => run.tokensPerSecond)),
      medianFirstTokenMs: median(successful.map((run) => run.firstTokenMs))
    }
  };
  options.onLog?.({
    level: result.summary.failedRuns === 0 ? "success" : "warning",
    message: "Benchmark complete",
    detail: `${result.summary.successfulRuns}/${runs.length} runs succeeded`,
    phase: "benchmark"
  });
  return result;
}

async function runLocalModel(prompt: string, model: ModelManifest, options: OnnxRunOptions): Promise<OnnxRunResponse> {
  const log = options.onLog ?? (() => undefined);
  const maxNewTokens = clamp(options.maxNewTokens ?? 24, 1, 64);
  const temperature = clamp(options.temperature ?? 0.8, 0.05, 2);
  const topK = clamp(options.topK ?? 40, 1, 100);
  const loadStartedAt = performance.now();

  try {
    const provider = resolveProvider(model);
    const runtime = await getLocalRuntime(model, log);
    const modelLoadMs = performance.now() - loadStartedAt;
    const promptTokenIds = runtime.tokenizer.encode(prompt, { add_special_tokens: false });
    log({ level: "info", message: "Prompt tokenized", detail: `${promptTokenIds.length} input tokens`, phase: "tokenize" });

    if (promptTokenIds.length >= runtime.sequenceLength) {
      return {
        ok: false,
        code: "PROMPT_TOO_LONG",
        message: `This model accepts at most ${runtime.sequenceLength - 1} prompt tokens.`,
        tokenCount: promptTokenIds.length,
        maxTokens: runtime.sequenceLength - 1
      };
    }

    const generationStartedAt = performance.now();
    const allTokenIds = [...promptTokenIds];
    const generatedTokens: OnnxToken[] = [];
    let firstTokenMs: number | null = null;
    let lastOutputs: Record<string, TensorLike> = {};
    const eosTokenId = runtime.tokenizer.eos_token_id ?? null;

    for (let step = 0; step < maxNewTokens; step += 1) {
      const context = allTokenIds.slice(-runtime.sequenceLength);
      const inputIds = padIds(context, runtime.sequenceLength, runtime.tokenizer.pad_token_id ?? eosTokenId ?? 0);
      const attentionMask = Array.from({ length: runtime.sequenceLength }, (_, index) => index < context.length ? 1 : 0);
      lastOutputs = await runtime.session.run({
        attention_mask: new runtime.tensor("int64", toBigInt64(attentionMask), [1, attentionMask.length]),
        input_ids: new runtime.tensor("int64", toBigInt64(inputIds), [1, inputIds.length])
      });

      const logits = lastOutputs.logits ?? lastOutputs[Object.keys(lastOutputs)[0]];
      if (!logits) throw new Error("The ONNX model did not return a logits output.");
      const nextTokenId = sampleNextToken(logits, context.length - 1, temperature, topK);
      const tokenText = runtime.tokenizer.decode([nextTokenId], { clean_up_tokenization_spaces: false, skip_special_tokens: false });
      allTokenIds.push(nextTokenId);
      generatedTokens.push({ id: nextTokenId, text: tokenText });
      if (firstTokenMs === null) firstTokenMs = performance.now() - generationStartedAt;
      if (eosTokenId !== null && nextTokenId === eosTokenId) break;
    }

    const generationMs = performance.now() - generationStartedAt;
    const generatedText = runtime.tokenizer.decode(generatedTokens.map((token) => token.id), { clean_up_tokenization_spaces: false, skip_special_tokens: true });
    const fullText = runtime.tokenizer.decode(allTokenIds, { clean_up_tokenization_spaces: false, skip_special_tokens: true });
    const tokensPerSecond = generatedTokens.length > 0 ? generatedTokens.length / (generationMs / 1000) : 0;
    const result: OnnxRunResult = {
      model: {
        id: model.id,
        label: model.label,
        baseModel: getModelRepo(model),
        modelPath: model.source.kind === "local" ? model.source.modelPath : "",
        sequenceLength: runtime.sequenceLength,
        verification: model.verification
      },
      prompt,
      generatedText,
      fullText,
      generatedTokens,
      inputTokenCount: promptTokenIds.length,
      outputTokenCount: generatedTokens.length,
      elapsedMs: generationMs,
      tokensPerSecond,
      metrics: {
        provider,
        modelLoadMs,
        generationMs,
        firstTokenMs,
        inputTokenCount: promptTokenIds.length,
        outputTokenCount: generatedTokens.length,
        tokensPerSecond
      },
      inputNames: runtime.session.inputNames ?? [...model.graph.inputNames],
      outputNames: runtime.session.outputNames ?? Object.keys(lastOutputs),
      outputShapes: Object.fromEntries(Object.entries(lastOutputs).map(([name, tensor]) => [name, [...tensor.dims]]))
    };
    log({ level: "success", message: "Generation complete", detail: `${result.outputTokenCount} tokens · ${tokensPerSecond.toFixed(1)} tok/s`, durationMs: Math.round(generationMs), phase: "runtime" });
    return { ok: true, result };
  } catch (error) {
    return failure(error, log, model.label);
  }
}

async function runTransformersJsModel(prompt: string, model: ModelManifest, options: OnnxRunOptions): Promise<OnnxRunResponse> {
  const log = options.onLog ?? (() => undefined);
  const maxNewTokens = clamp(options.maxNewTokens ?? 24, 1, 64);
  const temperature = clamp(options.temperature ?? 0.8, 0.05, 2);
  const topK = clamp(options.topK ?? 40, 1, 100);
  const loadStartedAt = performance.now();

  try {
    const provider = resolveProvider(model);
    const generator = await getPipeline(model, provider, log);
    const modelLoadMs = performance.now() - loadStartedAt;
    if (!generator.tokenizer) throw new Error(`${model.label} did not expose a tokenizer, so Sophon cannot report valid token metrics.`);
    const inputTokenIds = generator.tokenizer.encode(prompt, { add_special_tokens: false });
    const generationStartedAt = performance.now();
    const output = await generator(prompt, {
      max_new_tokens: maxNewTokens,
      do_sample: temperature > 0.1 && topK > 1,
      temperature,
      top_k: topK,
      return_full_text: false
    });
    const generationMs = performance.now() - generationStartedAt;
    const generatedText = readGeneratedText(output);
    const outputTokenIds = generator.tokenizer.encode(generatedText, { add_special_tokens: false });
    const generatedTokens = outputTokenIds.map((id) => ({ id, text: generator.tokenizer?.decode([id], { clean_up_tokenization_spaces: false, skip_special_tokens: false }) ?? "" }));
    const tokensPerSecond = outputTokenIds.length > 0 ? outputTokenIds.length / (generationMs / 1000) : 0;
    const repo = getModelRepo(model);
    const result: OnnxRunResult = {
      model: {
        id: model.id,
        label: model.label,
        baseModel: repo,
        modelPath: `${repo}@${model.source.kind === "huggingface" ? model.source.revision : "bundled"}`,
        sequenceLength: model.format.contextLength ?? 0,
        verification: model.verification
      },
      prompt,
      generatedText,
      fullText: `${prompt}${generatedText}`,
      generatedTokens,
      inputTokenCount: inputTokenIds.length,
      outputTokenCount: outputTokenIds.length,
      elapsedMs: generationMs,
      tokensPerSecond,
      metrics: {
        provider,
        modelLoadMs,
        generationMs,
        firstTokenMs: null,
        inputTokenCount: inputTokenIds.length,
        outputTokenCount: outputTokenIds.length,
        tokensPerSecond
      },
      inputNames: [...model.graph.inputNames],
      outputNames: [...model.graph.outputNames],
      outputShapes: {}
    };
    log({ level: "success", message: "Generation complete", detail: `${result.outputTokenCount} tokens · ${tokensPerSecond.toFixed(1)} tok/s`, durationMs: Math.round(generationMs), phase: "runtime" });
    return { ok: true, result };
  } catch (error) {
    return failure(error, log, model.label);
  }
}

async function getLocalRuntime(model: ModelManifest, log: (event: OnnxLogEvent) => void) {
  const cached = localRuntimeCache.get(model.id);
  if (cached) {
    log({ level: "info", message: "Using cached model session", detail: model.label, phase: "runtime" });
    return cached;
  }
  const loading = loadLocalRuntime(model, log).catch((error) => {
    localRuntimeCache.delete(model.id);
    throw error;
  });
  localRuntimeCache.set(model.id, loading);
  return loading;
}

async function loadLocalRuntime(model: ModelManifest, log: (event: OnnxLogEvent) => void): Promise<LocalRuntime> {
  if (model.source.kind !== "local") throw new Error(`${model.label} is not a local ONNX model.`);
  const startedAt = performance.now();
  log({ level: "info", message: "Loading ONNX model", detail: model.source.modelPath, phase: "download" });
  const [{ AutoTokenizer, env }, ort] = await Promise.all([import("@huggingface/transformers"), import("onnxruntime-web/webgpu")]);
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  const metadataResponse = await fetch(model.source.metadataUrl);
  if (!metadataResponse.ok) throw new Error(`Could not load model metadata (${metadataResponse.status}).`);
  const metadata = await metadataResponse.json() as Metadata;
  const tokenizer = await AutoTokenizer.from_pretrained(model.source.baseUrl) as unknown as TokenizerLike;
  const session = await ort.InferenceSession.create(model.source.modelPath, { executionProviders: ["webgpu"] }) as unknown as SessionLike;
  log({ level: "success", message: "ONNX session ready", detail: `${metadata.base_model} · ${metadata.sequence_length} token context`, durationMs: Math.round(performance.now() - startedAt), phase: "runtime" });
  return { tokenizer, session, tensor: ort.Tensor as unknown as LocalRuntime["tensor"], sequenceLength: metadata.sequence_length };
}

async function getPipeline(model: ModelManifest, provider: ModelProvider, log: (event: OnnxLogEvent) => void) {
  if (model.source.kind !== "huggingface") throw new Error(`${model.label} has no Hugging Face source.`);
  const cacheKey = `${model.id}:${provider}`;
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    log({ level: "info", message: "Using cached model pipeline", detail: `${model.label} · ${provider}`, phase: "runtime" });
    return cached;
  }
  log({ level: "info", message: "Loading experimental model", detail: `${model.source.repo}@${model.source.revision}`, phase: "download" });
  const loading = import("@huggingface/transformers").then(async (transformers) => {
    const pipeline = (transformers as unknown as {
      pipeline: (task: string, repo: string, options: Record<string, unknown>) => Promise<PipelineLike>;
    }).pipeline;
    return pipeline("text-generation", model.source.kind === "huggingface" ? model.source.repo : "", {
      device: provider,
      dtype: model.format.quantization,
      revision: model.source.kind === "huggingface" ? model.source.revision : "main"
    });
  }).catch((error) => {
    pipelineCache.delete(cacheKey);
    throw error;
  });
  pipelineCache.set(cacheKey, loading);
  return loading;
}

function resolveProvider(model: ModelManifest): ModelProvider {
  const capabilities = getRuntimeCapabilities();
  if (capabilities.webgpu && model.providers.includes("webgpu")) return "webgpu";
  if (capabilities.wasm && model.providers.includes("wasm")) return "wasm";
  throw new Error(`${model.label} requires ${model.providers.join(" or ")}, but this browser exposes neither compatible provider.`);
}

function failure(error: unknown, log: (event: OnnxLogEvent) => void, label: string): OnnxRunResponse {
  const message = error instanceof Error ? error.message : `${label} failed to run.`;
  log({ level: "error", message: "Inference failed", detail: message, phase: "runtime" });
  return { ok: false, code: message.includes("WebGPU") || message.includes("webgpu") ? "WEBGPU_UNAVAILABLE" : "REQUEST_FAILED", message };
}

function readGeneratedText(output: unknown) {
  if (!Array.isArray(output) || output.length === 0) return "";
  const first = output[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "generated_text" in first) {
    const value = (first as { generated_text?: unknown }).generated_text;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function padIds(ids: number[], length: number, padId: number) {
  return Array.from({ length }, (_, index) => ids[index] ?? padId);
}

function toBigInt64(values: number[]) {
  return BigInt64Array.from(values.map((value) => BigInt(value)));
}

function sampleNextToken(logits: TensorLike, sequenceIndex: number, temperature: number, topK: number) {
  const vocabSize = logits.dims.at(-1) ?? 0;
  if (!vocabSize) throw new Error("The logits output has no vocabulary dimension.");
  const start = sequenceIndex * vocabSize;
  const candidates = Array.from({ length: vocabSize }, (_, index) => ({ index, value: Number(logits.data[start + index] ?? -Infinity) }));
  candidates.sort((left, right) => right.value - left.value);
  const topCandidates = candidates.slice(0, Math.min(topK, candidates.length));
  if (temperature <= 0.1 || topCandidates.length === 1) return topCandidates[0]?.index ?? 0;
  const maxValue = topCandidates[0]?.value ?? 0;
  const weights = topCandidates.map((candidate) => Math.exp((candidate.value - maxValue) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = Math.random() * total;
  for (let index = 0; index < topCandidates.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor <= 0) return topCandidates[index]?.index ?? 0;
  }
  return topCandidates[0]?.index ?? 0;
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
