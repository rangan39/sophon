import type { ModelProvider, ModelVerification } from "@/lib/onnx-models";

export type OnnxRuntimePhase = "download" | "tokenize" | "inference" | "generate" | "benchmark" | "runtime";
export type OnnxLogLevel = "info" | "success" | "warning" | "error";

export type OnnxLogEvent = {
  level: OnnxLogLevel;
  message: string;
  detail?: string;
  phase?: OnnxRuntimePhase;
  durationMs?: number;
};

export type OnnxRunOptions = {
  modelId?: string;
  maxNewTokens?: number;
  temperature?: number;
  topK?: number;
  onLog?: (event: OnnxLogEvent) => void;
};

export type OnnxToken = { id: number; text: string };

export type RuntimeCapabilities = {
  webgpu: boolean;
  wasm: boolean;
  crossOriginIsolated: boolean;
};

export type ModelLoadResult = {
  modelId: string;
  label: string;
  provider: ModelProvider;
  verification: ModelVerification;
  loadMs: number;
  reused: boolean;
};

export type GenerationMetrics = {
  provider: ModelProvider;
  modelLoadMs: number;
  generationMs: number;
  firstTokenMs: number | null;
  inputTokenCount: number;
  outputTokenCount: number;
  tokensPerSecond: number;
};

export type OnnxRunResult = {
  model: {
    id: string;
    label: string;
    baseModel: string;
    modelPath: string;
    sequenceLength: number;
    verification: ModelVerification;
  };
  prompt: string;
  generatedText: string;
  fullText: string;
  generatedTokens: OnnxToken[];
  inputTokenCount: number;
  outputTokenCount: number;
  elapsedMs: number;
  tokensPerSecond: number;
  metrics: GenerationMetrics;
  inputNames: string[];
  outputNames: string[];
  outputShapes: Record<string, number[]>;
};

export type OnnxRunFailure = {
  ok: false;
  code: "WEBGPU_UNAVAILABLE" | "MODEL_NOT_VERIFIED" | "PROMPT_TOO_LONG" | "REQUEST_FAILED";
  message: string;
  tokenCount?: number;
  maxTokens?: number;
};

export type OnnxRunResponse = { ok: true; result: OnnxRunResult } | OnnxRunFailure;

export type BenchmarkPrompt = { id: string; prompt: string; maxNewTokens: number };
export type BenchmarkSuite = { id: string; label: string; prompts: readonly BenchmarkPrompt[] };

export type BenchmarkRun = {
  promptId: string;
  iteration: number;
  ok: boolean;
  generationMs: number | null;
  firstTokenMs: number | null;
  tokensPerSecond: number | null;
  outputTokenCount: number | null;
  error?: string;
};

export type BenchmarkResult = {
  modelId: string;
  suiteId: string;
  provider: ModelProvider | null;
  warmupRuns: number;
  measuredRuns: number;
  runs: BenchmarkRun[];
  summary: {
    successfulRuns: number;
    failedRuns: number;
    medianGenerationMs: number | null;
    medianTokensPerSecond: number | null;
    medianFirstTokenMs: number | null;
  };
};
