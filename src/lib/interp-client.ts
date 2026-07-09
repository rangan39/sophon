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

export async function runPrompt(prompt: string): Promise<RunPromptResult> {
  try {
    if (typeof window === "undefined") {
      return {
        ok: false,
        code: "REQUEST_FAILED",
        message: "Browser WebGPU runs are only available in the client."
      };
    }

    if (!("gpu" in navigator)) {
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        message: "This browser does not expose WebGPU. Sophon is configured to hard-fail instead of using a server fallback."
      };
    }

    const runtime = await getBrowserTraceRuntime();
    const run = await extractBrowserPromptRun(runtime, prompt);
    return { ok: true, run };
  } catch (error) {
    if (error instanceof PromptTooLongError) {
      return {
        ok: false,
        code: "PROMPT_TOO_LONG",
        message: "Prompt exceeds the browser model token cap.",
        tokenCount: error.tokenCount,
        maxTokens: error.maxTokens
      };
    }

    return {
      ok: false,
      code: "REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Browser WebGPU trace failed."
    };
  }
}

async function getBrowserTraceRuntime(): Promise<BrowserTraceRuntime> {
  runtimePromise ??= loadBrowserTraceRuntime();
  return runtimePromise;
}

async function loadBrowserTraceRuntime(): Promise<BrowserTraceRuntime> {
  const { AutoModelForCausalLM, AutoTokenizer, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;

  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(WEBGPU_MODEL_ID),
    AutoModelForCausalLM.from_pretrained(WEBGPU_MODEL_ID, {
      device: "webgpu"
    })
  ]);

  return {
    model: model as unknown as CallableModel,
    tokenizer: tokenizer as unknown as CallableTokenizer
  };
}

async function extractBrowserPromptRun({ model, tokenizer }: BrowserTraceRuntime, prompt: string): Promise<PromptRun> {
  const tokenIds = tokenizer.encode(prompt, { add_special_tokens: false });
  if (tokenIds.length > MAX_PROMPT_TOKENS) {
    throw new PromptTooLongError(tokenIds.length, MAX_PROMPT_TOKENS);
  }

  const inputs = tokenizer(prompt, {
    add_special_tokens: false,
    return_tensor: true
  });
  const outputs = await model(inputs);
  const logits = asTensor(outputs.logits, "logits");
  const hiddenStates = tensorArray(outputs.hidden_states ?? outputs.hiddenStates);

  if (hiddenStates.length === 0) {
    throw new Error(
      `The configured ONNX WebGPU model (${WEBGPU_MODEL_ID}) did not expose hidden_states. ` +
      "Sophon is configured with no server fallback, so use a browser ONNX export that returns layer hidden states."
    );
  }

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
