import type { PromptRun } from "@/lib/prompt-run";
import { MAX_PROMPT_TOKENS, TRACE_MODEL_BASE_URL } from "@/lib/trace-config";
import type { RunPromptOptions, RunPromptResult, RuntimeLogEvent } from "@/lib/trace-types";

type BrowserTraceRuntime = {
  session: OrtSession;
  tensor: OrtTensorConstructor;
  tokenizer: CallableTokenizer;
  metadata: TraceModelMetadata;
};

type CallableTokenizer = {
  (text: string, options?: Record<string, unknown>): Record<string, unknown>;
  decode(tokenIds: number[] | bigint[], options?: Record<string, unknown>): string;
  encode(text: string, options?: Record<string, unknown>): number[];
  pad_token_id?: number | null;
  eos_token_id?: number | null;
};

type TensorLike = {
  data: ArrayLike<number | bigint>;
  dims: readonly number[];
  tolist?: () => unknown[];
};

type OrtSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, TensorLike>>;
};

type OrtTensorConstructor = new (type: "int64", data: BigInt64Array, dims: number[]) => unknown;

type TraceModelMetadata = {
  base_model: string;
  sequence_length: number;
  output_names: string[];
  outputs: {
    logits: number[];
    hidden_states: number[][];
  };
};

let runtimePromise: Promise<BrowserTraceRuntime> | null = null;

export async function runPromptDirect(prompt: string, options: RunPromptOptions = {}): Promise<RunPromptResult> {
  const log = options.onLog ?? (() => undefined);

  try {
    log({ level: "info", message: "Starting browser WebGPU trace", detail: TRACE_MODEL_BASE_URL, phase: "runtime" });

    const browserNavigator = globalThis.navigator as Navigator & { gpu?: unknown };
    const gpu = browserNavigator.gpu;
    if (!gpu) {
      log({ level: "error", message: "WebGPU unavailable", detail: "navigator.gpu is not present", phase: "gpu" });
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        message: "This browser does not expose WebGPU. Sophon is configured to hard-fail instead of using a server fallback."
      };
    }
    log({ level: "success", message: "WebGPU detected", detail: "navigator.gpu available", phase: "gpu" });

    const runtime = await getBrowserTraceRuntime(log);
    const run = await extractBrowserPromptRun(runtime, prompt, log);
    log({
      level: "success",
      message: "Trace complete",
      detail: `${run.layers.length} hidden-state layers / ${run.tokens.length} tokens`,
      phase: "runtime"
    });
    return { ok: true, run };
  } catch (error) {
    if (error instanceof PromptTooLongError) {
      log({
        level: "error",
        message: "Prompt exceeds token cap",
        detail: `${error.tokenCount} / ${error.maxTokens} tokens`,
        phase: "tokenize"
      });
      return {
        ok: false,
        code: "PROMPT_TOO_LONG",
        message: "Prompt exceeds the browser model token cap.",
        tokenCount: error.tokenCount,
        maxTokens: error.maxTokens
      };
    }

    log({
      level: "error",
      message: "Browser WebGPU trace failed",
      detail: error instanceof Error ? error.message : "Unknown runtime error",
      phase: "runtime"
    });

    return {
      ok: false,
      code: "REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Browser WebGPU trace failed."
    };
  }
}

async function getBrowserTraceRuntime(log: (event: RuntimeLogEvent) => void): Promise<BrowserTraceRuntime> {
  if (runtimePromise) {
    log({ level: "info", message: "Using cached browser runtime", detail: TRACE_MODEL_BASE_URL, phase: "runtime" });
    return runtimePromise;
  }

  log({ level: "info", message: "Loading tokenizer and ONNX trace model", detail: TRACE_MODEL_BASE_URL, phase: "runtime" });
  runtimePromise = loadBrowserTraceRuntime(log);
  return runtimePromise;
}

async function loadBrowserTraceRuntime(log: (event: RuntimeLogEvent) => void): Promise<BrowserTraceRuntime> {
  const start = performance.now();
  const [{ AutoTokenizer, env }, ort] = await Promise.all([
    import("@huggingface/transformers"),
    import("onnxruntime-web/webgpu")
  ]);
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  log({ level: "info", message: "Loading trace metadata", detail: `${TRACE_MODEL_BASE_URL}/sophon-trace.json`, phase: "download" });
  const metadata = await loadTraceMetadata();
  log({ level: "success", message: "Trace metadata loaded", detail: `${metadata.output_names.length} outputs`, phase: "download" });

  log({ level: "info", message: "Loading tokenizer", detail: TRACE_MODEL_BASE_URL, phase: "download" });
  const tokenizer = await AutoTokenizer.from_pretrained(TRACE_MODEL_BASE_URL);
  log({ level: "success", message: "Tokenizer loaded", detail: metadata.base_model, phase: "download" });

  const modelPath = `${TRACE_MODEL_BASE_URL}/onnx/model.onnx`;
  log({ level: "info", message: "Creating ONNX WebGPU session", detail: modelPath, phase: "runtime" });
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["webgpu"]
  });

  log({
    level: "success",
    message: "Browser runtime loaded",
    detail: "tokenizer + Sophon ONNX WebGPU session ready",
    phase: "runtime",
    durationMs: Math.round(performance.now() - start)
  });

  return {
    session: session as unknown as OrtSession,
    tensor: ort.Tensor as unknown as OrtTensorConstructor,
    tokenizer: tokenizer as unknown as CallableTokenizer,
    metadata
  };
}

async function extractBrowserPromptRun(
  { metadata, session, tensor, tokenizer }: BrowserTraceRuntime,
  prompt: string,
  log: (event: RuntimeLogEvent) => void
): Promise<PromptRun> {
  const tokenizeStart = performance.now();
  const tokenIds = tokenizer.encode(prompt, { add_special_tokens: false });
  log({
    level: "info",
    message: "Prompt tokenized",
    detail: `${tokenIds.length} tokens`,
    phase: "tokenize",
    durationMs: Math.round(performance.now() - tokenizeStart)
  });

  if (tokenIds.length > MAX_PROMPT_TOKENS) {
    throw new PromptTooLongError(tokenIds.length, MAX_PROMPT_TOKENS);
  }

  const paddedTokenIds = padTokenIds(tokenIds, tokenizer, metadata.sequence_length);
  const attentionMask = paddedTokenIds.map((_, index) => (index < tokenIds.length ? 1 : 0));

  log({ level: "info", message: "Running ONNX inference", detail: "device=webgpu", phase: "inference" });

  const inferenceStart = performance.now();
  const outputs = await session.run({
    input_ids: int64Tensor(tensor, paddedTokenIds, [1, metadata.sequence_length]),
    attention_mask: int64Tensor(tensor, attentionMask, [1, metadata.sequence_length])
  });
  log({
    level: "info",
    message: "Inference returned outputs",
    detail: Object.keys(outputs).join(", ") || "no output keys",
    phase: "inference",
    durationMs: Math.round(performance.now() - inferenceStart)
  });

  const postprocessStart = performance.now();
  const logits = asTensor(outputs.logits, "logits");
  const hiddenStates = metadata.output_names
    .filter((name) => name.startsWith("hidden_state_"))
    .sort((a, b) => Number(a.split("_").at(-1)) - Number(b.split("_").at(-1)))
    .map((name) => asTensor(outputs[name], name));

  if (hiddenStates.length === 0) {
    log({
      level: "error",
      message: "Missing hidden states",
      detail: "Model must export hidden_states for Sophon traces",
      phase: "postprocess"
    });
    throw new Error(
      `The configured ONNX WebGPU model (${TRACE_MODEL_BASE_URL}) did not expose hidden_states. ` +
      "Sophon is configured with no server fallback, so use a browser ONNX export that returns layer hidden states."
    );
  }
  log({ level: "success", message: "Hidden states received", detail: `${hiddenStates.length} tensors`, phase: "postprocess" });

  const tokens = tokenIds.map((tokenId, index) => {
    const text = tokenizer.decode([tokenId], {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: false
    });

    return {
      index,
      id: tokenId,
      text,
      displayText: text.trim() || "space",
      kind: "normal" as const
    };
  });

  const layers = hiddenStates.map((hiddenState, layerIndex) => {
    const vectors = sequenceVectors(hiddenState, tokenIds.length);
    const norms = vectors.map((vector) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)));
    const means = vectors.map((vector) => vector.reduce((sum, value) => sum + value, 0) / Math.max(1, vector.length));
    const peaks = vectors.map((vector) => vector.reduce((max, value) => Math.max(max, Math.abs(value)), 0));

    return {
      layer: layerIndex,
      residualNorm: positiveNormalize(norms),
      attribution: normalize(means),
      logitConfidence: positiveNormalize(peaks),
      attention: [],
      topFeature: tokens.map((token) => ({
        id: `onnx-webgpu-hidden-${layerIndex}-${token.index}`,
        activation: 0,
        label: "ONNX hidden state"
      }))
    };
  });

  const run = {
    id: `webgpu-${Date.now()}`,
    title: prompt,
    prompt,
    model: `${metadata.base_model} / Sophon ONNX WebGPU`,
    source: "onnx-webgpu",
    featuresAvailable: false,
    expectedNextToken: topPredictions(tokenizer, logits, tokenIds.length, 1)[0]?.token,
    tokens,
    layers,
    finalPredictions: topPredictions(tokenizer, logits, tokenIds.length, 5)
  };
  log({
    level: "success",
    message: "Measurement tensors prepared",
    detail: `${layers.length} layers normalized`,
    phase: "postprocess",
    durationMs: Math.round(performance.now() - postprocessStart)
  });

  return run;
}

async function loadTraceMetadata(): Promise<TraceModelMetadata> {
  const response = await fetch(`${TRACE_MODEL_BASE_URL}/sophon-trace.json`);
  if (!response.ok) {
    throw new Error(`Could not load Sophon trace metadata: ${response.status} ${response.statusText}`);
  }
  return await response.json() as TraceModelMetadata;
}

function padTokenIds(tokenIds: number[], tokenizer: CallableTokenizer, sequenceLength: number) {
  const padTokenId = tokenizer.pad_token_id ?? tokenizer.eos_token_id ?? 0;
  return Array.from({ length: sequenceLength }, (_, index) => tokenIds[index] ?? padTokenId);
}

function int64Tensor(tensor: OrtTensorConstructor, values: number[], dims: number[]) {
  return new tensor("int64", BigInt64Array.from(values.map((value) => BigInt(value))), dims);
}

function asTensor(value: unknown, label: string): TensorLike {
  if (!value || typeof value !== "object" || !("data" in value) || !("dims" in value)) {
    throw new Error(`The browser ONNX model did not return ${label}.`);
  }
  return value as TensorLike;
}

function sequenceVectors(tensor: TensorLike, tokenCount: number): number[][] {
  const [batch, sequenceLength, hiddenSize] = tensor.dims;
  if (batch !== 1 || !sequenceLength || !hiddenSize) {
    throw new Error(`Expected hidden state shape [1, tokens, hidden], received [${tensor.dims.join(", ")}].`);
  }
  if (sequenceLength < tokenCount) {
    throw new Error(`Hidden state token count ${sequenceLength} is shorter than tokenizer count ${tokenCount}.`);
  }

  const vectors: number[][] = [];
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
    const start = tokenIndex * hiddenSize;
    const values: number[] = [];
    for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
      values.push(Number(tensor.data[start + hiddenIndex] ?? 0));
    }
    vectors.push(values);
  }
  return vectors;
}

function topPredictions(tokenizer: CallableTokenizer, logits: TensorLike, tokenCount: number, topK: number) {
  const [batch, sequenceLength, vocabSize] = logits.dims;
  if (batch !== 1 || sequenceLength < tokenCount || !vocabSize) {
    throw new Error(`Expected logits shape [1, tokens, vocab], received [${logits.dims.join(", ")}].`);
  }

  const start = (tokenCount - 1) * vocabSize;
  let maxLogit = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vocabSize; index += 1) {
    maxLogit = Math.max(maxLogit, Number(logits.data[start + index] ?? Number.NEGATIVE_INFINITY));
  }

  let sum = 0;
  const scored: { tokenId: number; score: number }[] = [];
  for (let index = 0; index < vocabSize; index += 1) {
    const score = Math.exp(Number(logits.data[start + index] ?? Number.NEGATIVE_INFINITY) - maxLogit);
    sum += score;
    scored.push({ tokenId: index, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ tokenId, score }) => {
    const token = tokenizer.decode([tokenId], {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: false
    });

    return {
      token,
      displayToken: token.trim() || "space",
      kind: "normal" as const,
      probability: round(score / Math.max(sum, Number.EPSILON))
    };
  });
}

function normalize(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (Math.abs(span) < 1e-8) return values.map(() => 0);
  return values.map((value) => round((value - min) / span));
}

function positiveNormalize(values: number[]) {
  const max = Math.max(...values.map((value) => Math.max(0, value)));
  if (max < 1e-8) return values.map(() => 0);
  return values.map((value) => round(Math.max(0, value) / max));
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

class PromptTooLongError extends Error {
  constructor(
    readonly tokenCount: number,
    readonly maxTokens: number
  ) {
    super("Prompt exceeds the browser model token cap.");
  }
}
