import { DEFAULT_ONNX_MODEL, getModelDefinition, type ModelDefinition } from "@/lib/onnx-models";
import type { OnnxLogEvent, OnnxRunOptions, OnnxRunResponse, OnnxRunResult, OnnxToken } from "@/lib/onnx-types";

type TensorLike = {
  data: ArrayLike<number | bigint>;
  dims: readonly number[];
};

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
};

type Runtime = {
  tokenizer: TokenizerLike;
  session: SessionLike;
  tensor: new (type: "int64", data: BigInt64Array, dims: number[]) => unknown;
  sequenceLength: number;
};

type Metadata = {
  base_model: string;
  sequence_length: number;
  output_names: string[];
};

let runtimePromise: Promise<Runtime> | null = null;

export async function runOnnxTextModel(prompt: string, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  const model = getModelDefinition(options.modelId);
  if (model.source === "huggingface") return runTransformersJsModel(prompt, model, options);
  return runLocalOnnxTextModel(prompt, model, options);
}

async function runLocalOnnxTextModel(prompt: string, model: ModelDefinition, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  const log = options.onLog ?? (() => undefined);
  const maxNewTokens = Math.max(1, Math.min(64, options.maxNewTokens ?? 24));
  const temperature = Math.max(0.05, Math.min(2, options.temperature ?? 0.8));

  try {
    const navigatorWithGpu = globalThis.navigator as Navigator & { gpu?: unknown };
    if (!navigatorWithGpu.gpu) {
      log({ level: "error", message: "WebGPU unavailable", detail: "navigator.gpu is not present", phase: "runtime" });
      return {
        ok: false,
        code: "WEBGPU_UNAVAILABLE",
        message: "This browser does not expose WebGPU. Try a recent Chromium-based browser or enable WebGPU in your browser settings."
      };
    }

    const runtime = await getRuntime(log, model);
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

    const startedAt = performance.now();
    const allTokenIds = [...promptTokenIds];
    const generatedTokens: OnnxToken[] = [];
    let lastOutputs: Record<string, TensorLike> = {};
    const eosTokenId = runtime.tokenizer.eos_token_id ?? null;

    for (let step = 0; step < maxNewTokens; step += 1) {
      const context = allTokenIds.slice(-runtime.sequenceLength);
      const inputIds = padIds(context, runtime.sequenceLength, runtime.tokenizer.pad_token_id ?? eosTokenId ?? 0);
      const attentionMask = Array.from({ length: runtime.sequenceLength }, (_, index) => index < context.length ? 1 : 0);

      lastOutputs = await runtime.session.run({
        attention_mask: new runtime.tensor("int64", BigInt64Array.from(attentionMask.map((value) => BigInt(value))), [1, attentionMask.length]),
        input_ids: new runtime.tensor("int64", BigInt64Array.from(inputIds.map((value) => BigInt(value))), [1, inputIds.length])
      });

      const logits = lastOutputs.logits ?? lastOutputs[Object.keys(lastOutputs)[0]];
      if (!logits) throw new Error("The ONNX model did not return a logits output.");
      const nextTokenId = sampleNextToken(logits, context.length - 1, temperature);
      const tokenText = runtime.tokenizer.decode([nextTokenId], {
        clean_up_tokenization_spaces: false,
        skip_special_tokens: false
      });
      allTokenIds.push(nextTokenId);
      generatedTokens.push({ id: nextTokenId, text: tokenText });

      if (step === 0 || (step + 1) % 4 === 0) {
        log({ level: "info", message: `Generated ${step + 1} token${step === 0 ? "" : "s"}`, detail: tokenText.trim() || "space", phase: "generate" });
      }
      if (eosTokenId !== null && nextTokenId === eosTokenId) break;
    }

    const elapsedMs = performance.now() - startedAt;
    const generatedText = runtime.tokenizer.decode(generatedTokens.map((token) => token.id), {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: true
    });
    const fullText = runtime.tokenizer.decode(allTokenIds, {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: true
    });
    const outputShapes = Object.fromEntries(
      Object.entries(lastOutputs).map(([name, tensor]) => [name, [...tensor.dims]])
    );
    const result: OnnxRunResult = {
      model: {
        label: model.label,
        baseModel: model.repo,
        modelPath: model.modelPath ?? "",
        sequenceLength: runtime.sequenceLength
      },
      prompt,
      generatedText,
      fullText,
      generatedTokens,
      inputTokenCount: promptTokenIds.length,
      outputTokenCount: generatedTokens.length,
      elapsedMs,
      tokensPerSecond: generatedTokens.length > 0 ? generatedTokens.length / (elapsedMs / 1000) : 0,
      inputNames: runtime.session.inputNames ?? ["input_ids", "attention_mask"],
      outputNames: runtime.session.outputNames ?? Object.keys(lastOutputs),
      outputShapes
    };

    log({
      level: "success",
      message: "Generation complete",
      detail: `${result.outputTokenCount} output tokens at ${result.tokensPerSecond.toFixed(1)} tokens/sec`,
      durationMs: Math.round(elapsedMs),
      phase: "runtime"
    });
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ONNX WebGPU inference failed.";
    log({ level: "error", message: "Inference failed", detail: message, phase: "runtime" });
    return { ok: false, code: "REQUEST_FAILED", message };
  }
}

async function getRuntime(log: (event: OnnxLogEvent) => void, model: ModelDefinition) {
  if (runtimePromise) {
    log({ level: "info", message: "Using cached model session", detail: model.label, phase: "runtime" });
    return runtimePromise;
  }

  runtimePromise = loadRuntime(log, model).catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function loadRuntime(log: (event: OnnxLogEvent) => void, model: ModelDefinition): Promise<Runtime> {
  const startedAt = performance.now();
  if (!model.baseUrl || !model.metadataUrl || !model.modelPath) throw new Error(`${model.label} is missing its local ONNX assets.`);
  log({ level: "info", message: "Loading ONNX model", detail: model.modelPath, phase: "download" });
  const [{ AutoTokenizer, env }, ort] = await Promise.all([
    import("@huggingface/transformers"),
    import("onnxruntime-web/webgpu")
  ]);
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  const metadataResponse = await fetch(model.metadataUrl);
  if (!metadataResponse.ok) throw new Error(`Could not load model metadata (${metadataResponse.status}).`);
  const metadata = await metadataResponse.json() as Metadata;
  const tokenizer = await AutoTokenizer.from_pretrained(model.baseUrl) as unknown as TokenizerLike;
  const session = await ort.InferenceSession.create(model.modelPath, {
    executionProviders: ["webgpu"]
  }) as unknown as SessionLike;
  log({
    level: "success",
    message: "ONNX WebGPU session ready",
    detail: `${model.repo} · ${metadata.sequence_length}-token context`,
    durationMs: Math.round(performance.now() - startedAt),
    phase: "runtime"
  });
  return { tokenizer, session, tensor: ort.Tensor as unknown as Runtime["tensor"], sequenceLength: metadata.sequence_length };
}

type TextGenerationPipeline = (prompt: string, options: Record<string, unknown>) => Promise<unknown>;
const pipelineCache = new Map<string, Promise<TextGenerationPipeline>>();

async function runTransformersJsModel(prompt: string, model: ModelDefinition, options: OnnxRunOptions): Promise<OnnxRunResponse> {
  const log = options.onLog ?? (() => undefined);
  const maxNewTokens = Math.max(1, Math.min(64, options.maxNewTokens ?? 24));
  const temperature = Math.max(0.05, Math.min(2, options.temperature ?? 0.8));
  const startedAt = performance.now();

  try {
    log({ level: "info", message: "Loading model", detail: `${model.repo} · cached after first use`, phase: "download" });
    const generator = await getPipeline(model, log);
    const output = await generator(prompt, {
      max_new_tokens: maxNewTokens,
      do_sample: temperature > 0.1,
      temperature,
      return_full_text: false
    });
    const generatedText = readGeneratedText(output);
    const elapsedMs = performance.now() - startedAt;
    const outputTokenCount = generatedText.trim() ? generatedText.trim().split(/\s+/).length : 0;
    log({ level: "success", message: "Generation complete", detail: `${model.label} · ${Math.round(elapsedMs)} ms`, durationMs: Math.round(elapsedMs), phase: "runtime" });
    return {
      ok: true,
      result: {
        model: { label: model.label, baseModel: model.repo, modelPath: model.repo, sequenceLength: 0 },
        prompt,
        generatedText,
        fullText: `${prompt}${generatedText}`,
        generatedTokens: [],
        inputTokenCount: prompt.trim() ? prompt.trim().split(/\s+/).length : 0,
        outputTokenCount,
        elapsedMs,
        tokensPerSecond: outputTokenCount > 0 ? outputTokenCount / (elapsedMs / 1000) : 0,
        inputNames: [],
        outputNames: [],
        outputShapes: {}
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${model.label} failed to run.`;
    log({ level: "error", message: "Inference failed", detail: message, phase: "runtime" });
    return { ok: false, code: "REQUEST_FAILED", message };
  }
}

async function getPipeline(model: ModelDefinition, log: (event: OnnxLogEvent) => void) {
  const cached = pipelineCache.get(model.id);
  if (cached) {
    log({ level: "info", message: "Using cached model", detail: model.label, phase: "runtime" });
    return cached;
  }

  const loading = import("@huggingface/transformers").then(async (transformers) => {
    const pipeline = (transformers as unknown as { pipeline: (task: string, repo: string, options: Record<string, unknown>) => Promise<TextGenerationPipeline> }).pipeline;
    return pipeline("text-generation", model.repo, { device: "webgpu", dtype: "q4" });
  });
  pipelineCache.set(model.id, loading);
  try {
    return await loading;
  } catch (error) {
    pipelineCache.delete(model.id);
    throw error;
  }
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

function sampleNextToken(logits: TensorLike, sequenceIndex: number, temperature: number) {
  const vocabSize = logits.dims.at(-1) ?? 0;
  if (!vocabSize) throw new Error("The logits output has no vocabulary dimension.");
  const start = sequenceIndex * vocabSize;
  const candidates: Array<{ index: number; value: number }> = [];
  for (let index = 0; index < vocabSize; index += 1) {
    candidates.push({ index, value: Number(logits.data[start + index] ?? -Infinity) });
  }
  candidates.sort((left, right) => right.value - left.value);
  const topCandidates = candidates.slice(0, Math.min(40, candidates.length));
  if (temperature <= 0.1) return topCandidates[0]?.index ?? 0;
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
