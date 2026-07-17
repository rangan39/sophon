import type {
  BenchmarkResult,
  BenchmarkSuite,
  GenerationTelemetryEvent,
  ModelLoadResult,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  RuntimeCapabilities
} from "@/lib/onnx-types";

type WorkerRequestInputMap = {
  capabilities: { type: "capabilities" };
  load: { type: "load"; modelId: string };
  generate: {
    type: "generate";
    prompt: string;
    modelId: string;
    options: Pick<OnnxRunOptions, "maxNewTokens" | "temperature" | "topK">;
  };
  benchmark: { type: "benchmark"; modelId: string; suite: BenchmarkSuite; measuredRuns: number };
  unload: { type: "unload"; modelId?: string };
};

export type WorkerRequestType = keyof WorkerRequestInputMap;
export type WorkerRequestInput<T extends WorkerRequestType = WorkerRequestType> = WorkerRequestInputMap[T];
export type WorkerRequest = {
  [T in WorkerRequestType]: WorkerRequestInputMap[T] & { requestId: string };
}[WorkerRequestType];

export type WorkerResultMap = {
  capabilities: RuntimeCapabilities;
  load: ModelLoadResult;
  generate: OnnxRunResponse;
  benchmark: BenchmarkResult;
  unload: { ok: true };
};

export type WorkerResponse =
  | { type: "log"; requestId: string; event: OnnxLogEvent }
  | { type: "telemetry"; requestId: string; telemetry: GenerationTelemetryEvent }
  | { type: "complete"; requestId: string; result: unknown }
  | { type: "error"; requestId: string; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;

  if (value.type === "capabilities") return true;
  if (value.type === "load") return typeof value.modelId === "string";
  if (value.type === "unload") return value.modelId === undefined || typeof value.modelId === "string";
  if (value.type === "generate") {
    return typeof value.prompt === "string"
      && typeof value.modelId === "string"
      && isRecord(value.options)
      && isOptionalFiniteNumber(value.options.maxNewTokens)
      && isOptionalFiniteNumber(value.options.temperature)
      && isOptionalFiniteNumber(value.options.topK);
  }
  if (value.type === "benchmark") {
    return typeof value.modelId === "string"
      && Number.isInteger(value.measuredRuns)
      && Number(value.measuredRuns) >= 1
      && Number(value.measuredRuns) <= 10
      && isBenchmarkSuite(value.suite);
  }
  return false;
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;
  if (value.type === "complete") return "result" in value;
  if (value.type === "error") return typeof value.message === "string";
  if (value.type === "log") return isLogEvent(value.event);
  if (value.type === "telemetry") return isTelemetryEvent(value.telemetry);
  return false;
}

export function isWorkerResult(type: WorkerRequestType, value: unknown): value is WorkerResultMap[WorkerRequestType] {
  if (!isRecord(value)) return false;
  if (type === "capabilities") {
    return typeof value.webgpu === "boolean"
      && typeof value.wasm === "boolean"
      && typeof value.crossOriginIsolated === "boolean";
  }
  if (type === "load") {
    return typeof value.modelId === "string"
      && typeof value.label === "string"
      && (value.provider === "webgpu" || value.provider === "wasm")
      && (value.verification === "verified" || value.verification === "experimental")
      && typeof value.loadMs === "number"
      && typeof value.reused === "boolean";
  }
  if (type === "generate") {
    return value.ok === false
      ? typeof value.code === "string" && typeof value.message === "string"
      : value.ok === true
        && isRecord(value.result)
        && typeof value.result.generatedText === "string"
        && Array.isArray(value.result.inputTokens)
        && Array.isArray(value.result.generatedTokens)
        && isRecord(value.result.metrics);
  }
  if (type === "benchmark") {
    return typeof value.modelId === "string" && Array.isArray(value.runs) && isRecord(value.summary);
  }
  return value.ok === true;
}

function isBenchmarkSuite(value: unknown): value is BenchmarkSuite {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.label === "string"
    && Array.isArray(value.prompts)
    && value.prompts.length > 0
    && value.prompts.length <= 20
    && value.prompts.every((prompt) => isRecord(prompt)
      && typeof prompt.id === "string"
      && typeof prompt.prompt === "string"
      && prompt.prompt.length <= 100_000
      && Number.isInteger(prompt.maxNewTokens)
      && Number(prompt.maxNewTokens) >= 1
      && Number(prompt.maxNewTokens) <= 64);
}

function isLogEvent(value: unknown): value is OnnxLogEvent {
  return isRecord(value)
    && (value.level === "info" || value.level === "success" || value.level === "warning" || value.level === "error")
    && typeof value.message === "string"
    && (value.detail === undefined || typeof value.detail === "string")
    && (value.phase === undefined || value.phase === "download" || value.phase === "tokenize" || value.phase === "inference" || value.phase === "generate" || value.phase === "benchmark" || value.phase === "runtime")
    && (value.durationMs === undefined || isFiniteNonNegative(value.durationMs));
}

function isTelemetryEvent(value: unknown): value is GenerationTelemetryEvent {
  return isRecord(value)
    && (value.phase === "prefill" || value.phase === "decode" || value.phase === "complete")
    && Number.isSafeInteger(value.promptTokenCount)
    && Number(value.promptTokenCount) >= 0
    && Number.isSafeInteger(value.contextTokenCount)
    && Number(value.contextTokenCount) >= 0
    && Number.isSafeInteger(value.outputTokenCount)
    && Number(value.outputTokenCount) >= 0
    && isFiniteNonNegative(value.endToEndMs)
    && isNullableFiniteNonNegative(value.ttftMs)
    && isFiniteNonNegative(value.decodeMs)
    && isNullableFiniteNonNegative(value.decodeTokensPerSecond)
    && isNullableFiniteNonNegative(value.timePerOutputTokenMs)
    && isNullableFiniteNonNegative(value.latestInterTokenLatencyMs)
    && isNullableFiniteNonNegative(value.p95InterTokenLatencyMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalFiniteNumber(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableFiniteNonNegative(value: unknown) {
  return value === null || isFiniteNonNegative(value);
}
