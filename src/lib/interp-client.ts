import { PromptRun } from "@/lib/prompt-run";

export const MAX_PROMPT_CHARS = 280;
export const MAX_PROMPT_TOKENS = 64;
const WEBGPU_MODEL_ID = process.env.NEXT_PUBLIC_SOPHON_WEBGPU_MODEL ?? "Xenova/gpt2";

export type RunPromptResult =
  | { ok: true; run: PromptRun }
  | {
      ok: false;
      code: "PROMPT_TOO_LONG" | "SERVICE_UNAVAILABLE" | "REQUEST_FAILED";
      message: string;
      tokenCount?: number;
      maxTokens?: number;
    };

export type RuntimeLogLevel = "info" | "success" | "warning" | "error";

export type RuntimeLogEvent = {
  level: RuntimeLogLevel;
  message: string;
  detail?: string;
};

export type RunPromptOptions = {
  onLog?: (event: RuntimeLogEvent) => void;
};

type BrowserTraceRuntime = {
  model: CallableModel;
  tokenizer: CallableTokenizer;
};

type CallableModel = (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;

type CallableTokenizer = {
  (text: string, options?: Record<string, unknown>): Record<string, unknown>;
  decode(tokenIds: number[] | bigint[], options?: Record<string, unknown>): string;
  encode(text: string, options?: Record<string, unknown>): number[];
};

type TensorLike = {
  data: ArrayLike<number | bigint>;
  dims: number[];
  tolist?: () => unknown[];
};

let runtimePromise: Promise<BrowserTraceRuntime> | null = null;

export async function runPrompt(prompt: string, options: RunPromptOptions = {}): Promise<RunPromptResult> {
  const log = options.onLog ?? (() => undefined);

  try {
    log({ level: "info", message: "Starting browser WebGPU trace", detail: WEBGPU_MODEL_ID });

    if (typeof window === "undefined") {
      log({ level: "error", message: "Run rejected before browser execution", detail: "window is unavailable" });
      return {
        ok: false,
        code: "REQUEST_FAILED",
        message: "Browser WebGPU runs are only available in the client."
      };
    }

    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    if (!gpu) {
      log({ level: "error", message: "WebGPU unavailable", detail: "navigator.gpu is not present" });
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        message: "This browser does not expose WebGPU. Sophon is configured to hard-fail instead of using a server fallback."
      };
    }
    log({ level: "success", message: "WebGPU detected", detail: "navigator.gpu available" });

    const runtime = await getBrowserTraceRuntime(log);
    const run = await extractBrowserPromptRun(runtime, prompt, log);
    log({ level: "success", message: "Trace complete", detail: `${run.layers.length} hidden-state layers / ${run.tokens.length} tokens` });
    return { ok: true, run };
  } catch (error) {
    if (error instanceof PromptTooLongError) {
      log({ level: "error", message: "Prompt exceeds token cap", detail: `${error.tokenCount} / ${error.maxTokens} tokens` });
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
      detail: error instanceof Error ? error.message : "Unknown runtime error"
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
    log({ level: "info", message: "Using cached browser runtime", detail: WEBGPU_MODEL_ID });
    return runtimePromise;
  }

  log({ level: "info", message: "Loading tokenizer and ONNX model", detail: WEBGPU_MODEL_ID });
  runtimePromise = loadBrowserTraceRuntime(log);
  return runtimePromise;
}

async function loadBrowserTraceRuntime(log: (event: RuntimeLogEvent) => void): Promise<BrowserTraceRuntime> {
  const { AutoModelForCausalLM, AutoTokenizer, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;

  const progressByFile = new Map<string, number>();
  const progressCallback = (progress: unknown) => {
    if (!progress || typeof progress !== "object") return;
    const event = progress as { status?: string; file?: string; progress?: number; loaded?: number; total?: number };
    if (event.status !== "progress" || !event.file || typeof event.progress !== "number") return;

    const rounded = Math.floor(event.progress);
    const previous = progressByFile.get(event.file) ?? -1;
    if (rounded < 100 && rounded - previous < 20) return;
    progressByFile.set(event.file, rounded);
    log({ level: "info", message: "Downloading model asset", detail: `${event.file} ${rounded}%` });
  };

  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(WEBGPU_MODEL_ID, {
      progress_callback: progressCallback
    }),
    AutoModelForCausalLM.from_pretrained(WEBGPU_MODEL_ID, {
      device: "webgpu",
      progress_callback: progressCallback
    })
  ]);

  log({ level: "success", message: "Browser runtime loaded", detail: "tokenizer + ONNX WebGPU session ready" });

  return {
    model: model as unknown as CallableModel,
    tokenizer: tokenizer as unknown as CallableTokenizer
  };
}

async function extractBrowserPromptRun(
  { model, tokenizer }: BrowserTraceRuntime,
  prompt: string,
  log: (event: RuntimeLogEvent) => void
): Promise<PromptRun> {
  const tokenIds = tokenizer.encode(prompt, { add_special_tokens: false });
  log({ level: "info", message: "Prompt tokenized", detail: `${tokenIds.length} tokens` });

  if (tokenIds.length > MAX_PROMPT_TOKENS) {
    throw new PromptTooLongError(tokenIds.length, MAX_PROMPT_TOKENS);
  }

  const inputs = tokenizer(prompt, {
    add_special_tokens: false,
    return_tensor: true
  });
  log({ level: "info", message: "Running ONNX inference", detail: "device=webgpu" });

  const outputs = await model(inputs);
  log({ level: "info", message: "Inference returned outputs", detail: Object.keys(outputs).join(", ") || "no output keys" });

  const logits = asTensor(outputs.logits, "logits");
  const hiddenStates = tensorArray(outputs.hidden_states ?? outputs.hiddenStates);

  if (hiddenStates.length === 0) {
    log({ level: "error", message: "Missing hidden states", detail: "Model must export hidden_states for Sophon traces" });
    throw new Error(
      `The configured ONNX WebGPU model (${WEBGPU_MODEL_ID}) did not expose hidden_states. ` +
      "Sophon is configured with no server fallback, so use a browser ONNX export that returns layer hidden states."
    );
  }
  log({ level: "success", message: "Hidden states received", detail: `${hiddenStates.length} tensors` });

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

  return {
    id: `webgpu-${Date.now()}`,
    title: prompt,
    prompt,
    model: `${WEBGPU_MODEL_ID} / ONNX Runtime WebGPU`,
    source: "onnx-webgpu",
    featuresAvailable: false,
    expectedNextToken: topPredictions(tokenizer, logits, tokenIds.length, 1)[0]?.token,
    tokens,
    layers,
    finalPredictions: topPredictions(tokenizer, logits, tokenIds.length, 5)
  };
}

function asTensor(value: unknown, label: string): TensorLike {
  if (!value || typeof value !== "object" || !("data" in value) || !("dims" in value)) {
    throw new Error(`The browser ONNX model did not return ${label}.`);
  }
  return value as TensorLike;
}

function tensorArray(value: unknown): TensorLike[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => asTensor(item, `hidden_states[${index}]`));
}

function sequenceVectors(tensor: TensorLike, expectedTokens: number): number[][] {
  const [batch, sequenceLength, hiddenSize] = tensor.dims;
  if (batch !== 1 || !sequenceLength || !hiddenSize) {
    throw new Error(`Expected hidden state shape [1, tokens, hidden], received [${tensor.dims.join(", ")}].`);
  }
  if (sequenceLength !== expectedTokens) {
    throw new Error(`Hidden state token count ${sequenceLength} does not match tokenizer count ${expectedTokens}.`);
  }

  const vectors: number[][] = [];
  for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
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
