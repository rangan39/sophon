import type { ModelProvider } from "@/lib/onnx-models";
import type { GenerationTimingSnapshot } from "@/lib/generation-metrics";

export type OnnxRuntimePhase = "download" | "tokenize" | "inference" | "generate" | "runtime";
export type OnnxLogLevel = "info" | "success" | "warning" | "error";

export type OnnxLogEvent = {
  level: OnnxLogLevel;
  message: string;
  detail?: string;
  phase?: OnnxRuntimePhase;
  progress?: { loaded: number; total: number };
  durationMs?: number;
};

export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OnnxRunOptions = {
  modelId?: string;
  maxNewTokens?: number;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  onLog?: (event: OnnxLogEvent) => void;
  onTelemetry?: (event: GenerationTelemetryEvent) => void;
};

export type GenerationTelemetryEvent = GenerationTimingSnapshot & {
  phase: "prefill" | "decode" | "complete";
  promptTokenCount: number;
  contextTokenCount: number;
};

export type OnnxToken = { id: number; text: string };
export type OnnxInputToken = OnnxToken & { inContext: boolean };

export type RuntimeCapabilities = {
  webgpu: boolean;
  wasm: boolean;
  crossOriginIsolated: boolean;
};

export type GenerationMetrics = {
  provider: ModelProvider;
  modelLoadMs: number;
  endToEndMs: number;
  ttftMs: number | null;
  decodeMs: number;
  decodeTokensPerSecond: number | null;
  timePerOutputTokenMs: number | null;
  p95InterTokenLatencyMs: number | null;
  promptTokenCount: number;
  contextTokenCount: number;
  truncatedInputTokens: number;
  outputTokenCount: number;
};

export type OnnxRunResult = {
  generatedText: string;
  inputTokens: OnnxInputToken[];
  generatedTokens: OnnxToken[];
  outputTokenCount: number;
  metrics: GenerationMetrics;
};

export type OnnxRunFailure = {
  ok: false;
  code: "CANCELLED" | "WEBGPU_UNAVAILABLE" | "MODEL_NOT_VERIFIED" | "PROMPT_TOO_LONG" | "REQUEST_FAILED";
  message: string;
  tokenCount?: number;
  maxTokens?: number;
};

export type OnnxRunResponse = { ok: true; result: OnnxRunResult } | OnnxRunFailure;

export type GenerationCancelResult = {
  cancelled: boolean;
  targetRequestId: string | null;
};
