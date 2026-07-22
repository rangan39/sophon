import type { PreTrainedTokenizer, ProgressInfo, TextGenerationPipeline } from "@huggingface/transformers";
import { requireModelDefinition, resolveModelProvider, type ModelManifest, type ModelProvider } from "@/lib/onnx-models";
import { calculateGenerationTiming, createGenerationTelemetryGate } from "@/lib/generation-metrics";
import {
  deleteModelCache,
  getModelCacheStatus,
  prepareModelDelivery,
  type DeliveryProgress
} from "@/lib/model-delivery/index";
import { decodeTokenPieces, markActiveContext, sliceTokenPiecesByTextRange } from "@/lib/token-display";
import type {
  ChatTurn,
  GenerationTelemetryEvent,
  OnnxInputToken,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  OnnxRunResult,
  OnnxToken,
  RuntimeCapabilities
} from "@/lib/onnx-types";

type PipelineLike = TextGenerationPipeline;
type PreparedGenerationInput = ChatTurn[];

const pipelineCache = new Map<string, Promise<PipelineLike>>();
let runtimeCapabilitiesPromise: Promise<RuntimeCapabilities> | null = null;

export function getRuntimeCapabilities() {
  runtimeCapabilitiesPromise ??= detectRuntimeCapabilities();
  return runtimeCapabilitiesPromise;
}

export function prepareGenerationInput(messages: readonly ChatTurn[]): PreparedGenerationInput {
  return messages.flatMap((message) => {
    const content = message.content.trim();
    return content ? [{ role: message.role, content }] : [];
  });
}

export function readGeneratedText(output: unknown) {
  if (!Array.isArray(output) || output.length === 0) return "";
  const first = output[0];
  if (typeof first === "string") return first;
  if (!first || typeof first !== "object" || !("generated_text" in first)) return "";
  const generated = (first as { generated_text?: unknown }).generated_text;
  if (typeof generated === "string") return generated;
  if (!Array.isArray(generated)) return "";
  for (let index = generated.length - 1; index >= 0; index -= 1) {
    const message = generated[index];
    if (message && typeof message === "object" && "content" in message && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

export async function runOnnxTextModel(messages: readonly ChatTurn[], options: OnnxRunOptions): Promise<OnnxRunResponse> {
  const model = requireModelDefinition(options.modelId);
  if (options.signal?.aborted) return cancelled();
  const normalized = messages.filter((message) => message.content.trim());
  if (normalized.length === 0) {
    return { ok: false, code: "REQUEST_FAILED", message: "Enter a prompt before running the model." };
  }
  return runTransformersJsModel(normalized, model, options);
}

export async function preloadOnnxModel(modelId: string, onLog: (event: OnnxLogEvent) => void = () => undefined, signal?: AbortSignal) {
  const model = requireModelDefinition(modelId);
  await getPipeline(model, await resolveProvider(model), onLog, signal);
}

export async function getOnnxModelCacheStatus() {
  return { models: await getModelCacheStatus() };
}

export async function deleteOnnxModelCache(modelId: string, signal?: AbortSignal) {
  requireModelDefinition(modelId);
  const matching = [...pipelineCache.entries()].filter(([key]) => key.startsWith(`${modelId}:`));
  for (const [key] of matching) pipelineCache.delete(key);
  await Promise.all(matching.map(async ([, loading]) => {
    try {
      const loaded = await loading;
      await loaded.dispose();
    } catch {
      // A failed or cancelled pipeline has no live session left to dispose.
    }
  }));
  return deleteModelCache(modelId, signal);
}

async function runTransformersJsModel(
  messages: readonly ChatTurn[],
  model: ModelManifest,
  options: OnnxRunOptions
): Promise<OnnxRunResponse> {
  const log = options.onLog ?? (() => undefined);
  const maxNewTokens = clamp(options.maxNewTokens ?? 24, 1, 64);
  const temperature = clamp(options.temperature ?? 0.8, 0.05, 2);
  const topK = clamp(options.topK ?? 40, 1, 100);
  const loadStartedAt = performance.now();

  try {
    const provider = await resolveProvider(model);
    const generator = await getPipeline(model, provider, log, options.signal);
    throwIfCancelled(options.signal);
    const modelLoadMs = performance.now() - loadStartedAt;
    const generationStartedAt = performance.now();
    const originalInput = prepareGenerationInput(messages);
    const originalRenderedInput = renderGenerationInput(generator.tokenizer, originalInput);
    const promptTokenCount = generator.tokenizer.encode(originalRenderedInput, { add_special_tokens: false }).length;
    const contextLimit = readContextLimit(generator.tokenizer, model);
    const maxInputTokens = contextLimit === null ? null : Math.max(1, contextLimit - maxNewTokens);
    const fittedMessages = fitMessagesToContext(generator.tokenizer, messages, maxInputTokens);
    const input = prepareGenerationInput(fittedMessages);
    const renderedInput = renderGenerationInput(generator.tokenizer, input);
    const inputTokenIds = generator.tokenizer.encode(renderedInput, { add_special_tokens: false });
    (generator.tokenizer as PreTrainedTokenizer & { truncation_side: string }).truncation_side = "left";
    const contextTokenCount = maxInputTokens === null ? inputTokenIds.length : Math.min(inputTokenIds.length, maxInputTokens);
    const truncatedInputTokens = Math.max(0, promptTokenCount - contextTokenCount);
    const tokenTimestamps: number[] = [];
    const streamedTokenIds: number[] = [];
    const shouldPublishTelemetry = createGenerationTelemetryGate();
    const specialTokenIds = new Set((generator.tokenizer.all_special_ids ?? []).map(Number));
    const { InterruptableStoppingCriteria, TextStreamer } = await import("@huggingface/transformers");
    throwIfCancelled(options.signal);
    const stoppingCriteria = new InterruptableStoppingCriteria();
    const interrupt = () => stoppingCriteria.interrupt();
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: () => undefined,
      token_callback_function: (tokens) => {
        if (options.signal?.aborted) return;
        const emittedAt = performance.now();
        const previousTokenCount = streamedTokenIds.length;
        for (const token of tokens) {
          const tokenId = Number(token);
          if (specialTokenIds.has(tokenId)) continue;
          streamedTokenIds.push(tokenId);
          tokenTimestamps.push(emittedAt);
        }
        if (streamedTokenIds.length === previousTokenCount) return;
        emitTelemetry(options, shouldPublishTelemetry, "decode", generationStartedAt, tokenTimestamps, promptTokenCount, contextTokenCount, emittedAt);
      }
    });
    options.signal?.addEventListener("abort", interrupt, { once: true });
    let output: unknown;
    try {
      emitTelemetry(options, shouldPublishTelemetry, "prefill", generationStartedAt, tokenTimestamps, promptTokenCount, contextTokenCount);
      output = await generator(input, {
        max_new_tokens: maxNewTokens,
        do_sample: temperature > 0.1 && topK > 1,
        temperature,
        top_k: topK,
        return_full_text: false,
        stopping_criteria: stoppingCriteria,
        streamer,
        ...(maxInputTokens === null ? {} : { tokenizer_encode_kwargs: { max_length: maxInputTokens } })
      });
      throwIfCancelled(options.signal);
    } finally {
      options.signal?.removeEventListener("abort", interrupt);
    }
    const timing = emitTelemetry(options, shouldPublishTelemetry, "complete", generationStartedAt, tokenTimestamps, promptTokenCount, contextTokenCount);
    const generatedText = readGeneratedText(output);
    const outputTokenIds = streamedTokenIds.length > 0
      ? streamedTokenIds
      : generator.tokenizer.encode(generatedText, { add_special_tokens: false });
    const generatedTokens = decodeTokens(generator.tokenizer, outputTokenIds);
    const result: OnnxRunResult = {
      generatedText,
      inputTokens: getLatestUserTokens(generator.tokenizer, inputTokenIds, renderedInput, fittedMessages, contextTokenCount),
      generatedTokens,
      outputTokenCount: outputTokenIds.length,
      metrics: {
        provider,
        modelLoadMs,
        endToEndMs: timing.endToEndMs,
        ttftMs: timing.ttftMs,
        decodeMs: timing.decodeMs,
        decodeTokensPerSecond: timing.decodeTokensPerSecond,
        timePerOutputTokenMs: timing.timePerOutputTokenMs,
        p95InterTokenLatencyMs: timing.p95InterTokenLatencyMs,
        promptTokenCount,
        contextTokenCount,
        truncatedInputTokens,
        outputTokenCount: outputTokenIds.length
      }
    };
    log({ level: "success", message: "Generation complete", detail: `${result.outputTokenCount} tokens · ${formatRate(timing.decodeTokensPerSecond)}`, durationMs: Math.round(timing.endToEndMs), phase: "runtime" });
    return { ok: true, result };
  } catch (error) {
    return failure(options.signal?.aborted ? new GenerationCancelledError() : error, log, model.label);
  }
}

async function getPipeline(model: ModelManifest, provider: ModelProvider, log: (event: OnnxLogEvent) => void, signal?: AbortSignal) {
  throwIfCancelled(signal);
  const cacheKey = `${model.id}:${provider}`;
  const cached = pipelineCache.get(cacheKey);
  if (cached) {
    log({ level: "info", message: "Reusing loaded model", detail: `${model.label} · ${formatProvider(provider)}`, phase: "runtime" });
    return cached;
  }
  const source = model.source.kind === "local" ? model.source.baseUrl : model.source.repo;
  let lastProgress = -1;
  const progressCallback = (event: ProgressInfo) => {
    if (event.status !== "progress_total" || !Number.isFinite(event.loaded) || !Number.isFinite(event.total) || event.total <= 0) return;
    const loaded = Math.min(event.total, Math.max(0, event.loaded));
    const progress = Math.floor(loaded / event.total * 100);
    if (progress === lastProgress) return;
    lastProgress = progress;
    log({ level: "info", message: "Loading model", phase: "download", progress: { loaded, total: event.total } });
  };
  log({ level: "info", message: "Loading model", detail: `${model.label} · ${model.format.sizeLabel}`, phase: "download" });
  const loading = import("@huggingface/transformers").then(async ({ env, pipeline }) => {
    throwIfCancelled(signal);
    const allowLocalModels = env.allowLocalModels;
    const allowRemoteModels = env.allowRemoteModels;
    env.allowLocalModels = model.source.kind === "local";
    env.allowRemoteModels = model.source.kind === "huggingface";
    const remotePathTemplate = env.remotePathTemplate;
    if (model.source.kind === "huggingface") env.remotePathTemplate = `{model}/resolve/${model.source.revision}/`;
    try {
      const delivery = await prepareModelDelivery(model, (progress) => {
        log({ level: "info", message: deliveryProgressMessage(progress), phase: "download", progress });
      }, signal);
      throwIfCancelled(signal);
      if (delivery) {
        log({
          level: "info",
          message: "Loading downloaded model",
          detail: "Reading model data from browser storage",
          phase: "runtime",
          progress: { loaded: delivery.totalBytes, total: delivery.totalBytes, stage: "cache" }
        });
      }
      if (delivery) {
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
      }
      return await pipeline("text-generation", source, {
        device: provider,
        dtype: model.format.quantization,
        progress_callback: delivery ? undefined : progressCallback,
        ...(delivery ? {
          local_files_only: true,
          use_external_data_format: false,
          session_options: { externalData: delivery.externalData }
        } : {}),
        ...(model.source.kind === "huggingface" ? { revision: model.source.revision } : {})
      });
    } finally {
      env.allowLocalModels = allowLocalModels;
      env.allowRemoteModels = allowRemoteModels;
      env.remotePathTemplate = remotePathTemplate;
    }
  }).catch((error) => {
    pipelineCache.delete(cacheKey);
    throw error;
  });
  pipelineCache.set(cacheKey, loading);
  return loading;
}

function deliveryProgressMessage(progress: DeliveryProgress) {
  if (progress.stage === "resume") return "Resuming model download";
  if (progress.stage === "verify") return "Verifying model download";
  if (progress.stage === "cache") return "Model cached locally";
  return "Downloading model";
}

function renderGenerationInput(tokenizer: PreTrainedTokenizer, input: PreparedGenerationInput) {
  const rendered = tokenizer.apply_chat_template(input, { tokenize: false, add_generation_prompt: true });
  if (typeof rendered !== "string") throw new Error("The model chat template did not return text.");
  return rendered;
}

function fitMessagesToContext(
  tokenizer: PreTrainedTokenizer,
  messages: readonly ChatTurn[],
  maxInputTokens: number | null
) {
  const fitted = [...messages];
  if (maxInputTokens === null) return fitted;
  while (fitted.length > 1) {
    const rendered = renderGenerationInput(tokenizer, prepareGenerationInput(fitted));
    if (tokenizer.encode(rendered, { add_special_tokens: false }).length <= maxInputTokens) break;
    const removableIndex = fitted[0]?.role === "system" && fitted.length > 2 ? 1 : 0;
    const removePair = fitted[removableIndex]?.role === "user" && fitted[removableIndex + 1]?.role === "assistant";
    fitted.splice(removableIndex, removePair ? 2 : 1);
  }
  return fitted;
}

function readContextLimit(tokenizer: PreTrainedTokenizer, model: ModelManifest) {
  if (model.format.contextLength !== null) return model.format.contextLength;
  const configured = (tokenizer as PreTrainedTokenizer & { model_max_length?: unknown }).model_max_length;
  return typeof configured === "number" && Number.isSafeInteger(configured) && configured > 0 && configured < 1_000_000
    ? configured
    : null;
}

function getLatestUserTokens(
  tokenizer: PreTrainedTokenizer,
  inputTokenIds: readonly number[],
  renderedInput: string,
  messages: readonly ChatTurn[],
  contextTokenCount: number
): OnnxInputToken[] {
  const latestUser = messages.findLast((message) => message.role === "user" && message.content.trim());
  if (!latestUser) return [];
  const content = latestUser.content.trim();
  const contentStart = renderedInput.lastIndexOf(content);
  if (contentStart < 0) return [];
  const pieces = markActiveContext(decodeTokens(tokenizer, inputTokenIds), Math.max(0, inputTokenIds.length - contextTokenCount));
  return sliceTokenPiecesByTextRange(pieces, renderedInput, contentStart, contentStart + content.length)
    .map((token) => ({ ...token, inContext: token.inContext === true }));
}

async function resolveProvider(model: ModelManifest): Promise<ModelProvider> {
  const capabilities = await getRuntimeCapabilities();
  const provider = resolveModelProvider(model, capabilities);
  if (provider) return provider;
  throw new Error(`${model.label} needs browser GPU support, which is unavailable in this browser.`);
}

async function detectRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const scope = globalThis as typeof globalThis & {
    navigator?: Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } };
    crossOriginIsolated?: boolean;
  };
  let webgpu = false;
  try {
    webgpu = Boolean(await scope.navigator?.gpu?.requestAdapter?.());
  } catch {
    // A denied or unavailable adapter is equivalent to no WebGPU capability.
  }
  return {
    webgpu,
    wasm: typeof WebAssembly !== "undefined",
    crossOriginIsolated: Boolean(scope.crossOriginIsolated)
  };
}

function failure(error: unknown, log: (event: OnnxLogEvent) => void, label: string): OnnxRunResponse {
  if (error instanceof GenerationCancelledError) {
    log({ level: "info", message: "Generation cancelled", phase: "runtime" });
    return cancelled();
  }
  const message = error instanceof Error ? error.message : `${label} failed to run.`;
  log({ level: "error", message: "Inference failed", detail: message, phase: "runtime" });
  return { ok: false, code: message.includes("WebGPU") || message.includes("webgpu") ? "WEBGPU_UNAVAILABLE" : "REQUEST_FAILED", message };
}

function emitTelemetry(
  options: OnnxRunOptions,
  shouldPublish: (phase: GenerationTelemetryEvent["phase"], observedAtMs: number) => boolean,
  phase: GenerationTelemetryEvent["phase"],
  startedAtMs: number,
  tokenTimestampsMs: readonly number[],
  promptTokenCount: number,
  contextTokenCount: number,
  observedAtMs = performance.now()
) {
  const event: GenerationTelemetryEvent = {
    phase,
    promptTokenCount,
    contextTokenCount,
    ...calculateGenerationTiming(startedAtMs, tokenTimestampsMs, observedAtMs, {
      includePercentiles: phase === "complete"
    })
  };
  if (shouldPublish(phase, observedAtMs)) options.onTelemetry?.(event);
  return event;
}

function decodeTokens(tokenizer: PreTrainedTokenizer, tokenIds: readonly number[]): OnnxToken[] {
  return decodeTokenPieces(tokenIds, (ids) => tokenizer.decode(ids, {
    clean_up_tokenization_spaces: false,
    skip_special_tokens: false
  }));
}

function formatRate(tokensPerSecond: number | null) {
  return tokensPerSecond === null ? "Speed pending" : `${tokensPerSecond.toFixed(1)} tokens/s`;
}

function formatProvider(provider: ModelProvider) {
  return provider === "webgpu" ? "WebGPU" : "WASM";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

class GenerationCancelledError extends Error {
  constructor() {
    super("Generation cancelled.");
    this.name = "GenerationCancelledError";
  }
}

function throwIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new GenerationCancelledError();
}

function cancelled(): OnnxRunResponse {
  return { ok: false, code: "CANCELLED", message: "Generation cancelled." };
}
