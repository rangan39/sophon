import type {
  ChatTurn,
  GenerationCancelResult,
  GenerationTelemetryEvent,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  RuntimeCapabilities
} from "@/lib/onnx-types";

type WorkerRequestInputMap = {
  capabilities: { type: "capabilities" };
  generate: {
    type: "generate";
    messages: ChatTurn[];
    modelId: string;
    options: Pick<OnnxRunOptions, "maxNewTokens" | "temperature" | "topK">;
  };
  cancel: { type: "cancel"; targetRequestId: string };
  preload: { type: "preload"; modelId: string };
};

export type WorkerRequestType = keyof WorkerRequestInputMap;
export type WorkerRequestInput<T extends WorkerRequestType = WorkerRequestType> = WorkerRequestInputMap[T];
export type WorkerRequest = {
  [T in WorkerRequestType]: WorkerRequestInputMap[T] & { requestId: string };
}[WorkerRequestType];

export type WorkerResultMap = {
  capabilities: RuntimeCapabilities;
  generate: OnnxRunResponse;
  cancel: GenerationCancelResult;
  preload: { ok: true };
};

export type WorkerResponse =
  | { type: "log"; requestId: string; event: OnnxLogEvent }
  | { type: "telemetry"; requestId: string; telemetry: GenerationTelemetryEvent }
  | { type: "complete"; requestId: string; result: unknown }
  | { type: "error"; requestId: string; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;

  if (value.type === "capabilities") return true;
  if (value.type === "cancel") return typeof value.targetRequestId === "string" && value.targetRequestId.length > 0;
  if (value.type === "preload") return typeof value.modelId === "string" && value.modelId.length > 0;
  if (value.type === "generate") {
    return isChat(value.messages)
      && typeof value.modelId === "string"
      && isRecord(value.options)
      && isOptionalFiniteNumber(value.options.maxNewTokens)
      && isOptionalFiniteNumber(value.options.temperature)
      && isOptionalFiniteNumber(value.options.topK);
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
  if (type === "generate") {
    return value.ok === false
      ? isRunFailureCode(value.code) && typeof value.message === "string"
      : value.ok === true
        && isRecord(value.result)
        && typeof value.result.generatedText === "string"
        && Array.isArray(value.result.inputTokens)
        && Array.isArray(value.result.generatedTokens)
        && isRecord(value.result.metrics);
  }
  if (type === "cancel") {
    return typeof value.cancelled === "boolean"
      && (typeof value.targetRequestId === "string" || (value.cancelled === false && value.targetRequestId === null));
  }
  return value.ok === true;
}

function isChat(value: unknown): value is ChatTurn[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 100
    && value.every((message) => isRecord(message)
      && (message.role === "system" || message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.length <= 100_000);
}

function isRunFailureCode(value: unknown) {
  return value === "CANCELLED"
    || value === "WEBGPU_UNAVAILABLE"
    || value === "MODEL_NOT_VERIFIED"
    || value === "PROMPT_TOO_LONG"
    || value === "REQUEST_FAILED";
}

function isLogEvent(value: unknown): value is OnnxLogEvent {
  return isRecord(value)
    && (value.level === "info" || value.level === "success" || value.level === "warning" || value.level === "error")
    && typeof value.message === "string"
    && (value.detail === undefined || typeof value.detail === "string")
    && (value.phase === undefined || value.phase === "download" || value.phase === "tokenize" || value.phase === "inference" || value.phase === "generate" || value.phase === "runtime")
    && (value.progress === undefined || isDownloadProgress(value.progress))
    && (value.durationMs === undefined || isFiniteNonNegative(value.durationMs));
}

function isDownloadProgress(value: unknown) {
  if (!isRecord(value) || !isFiniteNonNegative(value.loaded) || !isFinitePositive(value.total) || Number(value.loaded) > Number(value.total)) return false;
  if (value.stage !== undefined && value.stage !== "download" && value.stage !== "resume" && value.stage !== "verify" && value.stage !== "cache") return false;
  if (value.resumedBytes !== undefined && (!isFiniteNonNegative(value.resumedBytes) || Number(value.resumedBytes) > Number(value.total))) return false;
  if (value.networkBytes !== undefined && !isFiniteNonNegative(value.networkBytes)) return false;
  return (value.bytesPerSecond === undefined || isFiniteNonNegative(value.bytesPerSecond))
    && (value.etaMs === undefined || isFiniteNonNegative(value.etaMs));
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

function isFinitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNullableFiniteNonNegative(value: unknown) {
  return value === null || isFiniteNonNegative(value);
}
