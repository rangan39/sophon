import { QUICK_BENCHMARK } from "@/lib/benchmarks";
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
import {
  isWorkerResponse,
  isWorkerResult,
  type WorkerRequest,
  type WorkerRequestInput,
  type WorkerRequestType,
  type WorkerResultMap
} from "@/lib/onnx-worker-protocol";

export type { OnnxLogEvent as RuntimeLogEvent, OnnxRunResponse as RunPromptResult } from "@/lib/onnx-types";

type PendingRequest = {
  type: WorkerRequestType;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: number;
  onLog?: (event: OnnxLogEvent) => void;
  onTelemetry?: (event: GenerationTelemetryEvent) => void;
};

const WORKER_TIMEOUT_MS: Record<WorkerRequestType, number> = {
  capabilities: 10_000,
  load: 30 * 60_000,
  generate: 30 * 60_000,
  benchmark: 60 * 60_000,
  unload: 60_000
};

let runtimeWorker: Worker | null = null;
let requestCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();

export async function getCapabilities(): Promise<RuntimeCapabilities> {
  if (!canUseWorker()) {
    const { getRuntimeCapabilities } = await import("@/lib/onnx-runner");
    return getRuntimeCapabilities();
  }
  return requestWorker({ type: "capabilities" });
}

export async function loadModel(modelId: string, onLog?: (event: OnnxLogEvent) => void): Promise<ModelLoadResult> {
  if (!canUseWorker()) {
    const { loadOnnxModel } = await import("@/lib/onnx-runner");
    return loadOnnxModel(modelId, onLog);
  }
  return requestWorker({ type: "load", modelId }, onLog);
}

export async function runPrompt(prompt: string, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  if (!canUseWorker()) {
    const { runOnnxTextModel } = await import("@/lib/onnx-runner");
    return runOnnxTextModel(prompt, options);
  }
  return requestWorker({
    type: "generate",
    prompt,
    modelId: options.modelId ?? "tiny-gpt2",
    options: {
      maxNewTokens: options.maxNewTokens,
      temperature: options.temperature,
      topK: options.topK
    }
  }, options.onLog, options.onTelemetry);
}

export async function runBenchmark(
  modelId: string,
  options: { suite?: BenchmarkSuite; measuredRuns?: number; onLog?: (event: OnnxLogEvent) => void } = {}
): Promise<BenchmarkResult> {
  const suite = options.suite ?? QUICK_BENCHMARK;
  const measuredRuns = options.measuredRuns ?? 3;
  if (!canUseWorker()) {
    const { benchmarkOnnxModel } = await import("@/lib/onnx-runner");
    return benchmarkOnnxModel(modelId, suite, { measuredRuns, onLog: options.onLog });
  }
  return requestWorker({ type: "benchmark", modelId, suite, measuredRuns }, options.onLog);
}

export async function unloadModel(modelId?: string) {
  if (!canUseWorker()) {
    const { unloadOnnxModel } = await import("@/lib/onnx-runner");
    await unloadOnnxModel(modelId);
    return;
  }
  await requestWorker({ type: "unload", modelId });
}

export function terminateRuntimeWorker() {
  resetRuntimeWorker(new Error("The model worker was terminated."));
}

function canUseWorker() {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function getWorker() {
  if (runtimeWorker) return runtimeWorker;
  runtimeWorker = new Worker(new URL("../workers/onnx-worker.ts", import.meta.url), { type: "module" });
  runtimeWorker.onmessage = (message: MessageEvent<unknown>) => {
    const response = message.data;
    if (!isWorkerResponse(response)) {
      resetRuntimeWorker(new Error("The model worker returned an invalid message."));
      return;
    }
    const pending = pendingRequests.get(response.requestId);
    if (!pending) return;
    if (response.type === "log") {
      pending.onLog?.(response.event);
      return;
    }
    if (response.type === "telemetry") {
      pending.onTelemetry?.(response.telemetry);
      return;
    }
    settlePendingRequest(response.requestId);
    if (response.type === "error") {
      pending.reject(new Error(response.message || "The model worker failed."));
      return;
    }
    pending.resolve(response.result);
  };
  runtimeWorker.onerror = (event) => {
    event.preventDefault();
    resetRuntimeWorker(new Error(event.message || "The model worker failed."));
  };
  runtimeWorker.onmessageerror = () => resetRuntimeWorker(new Error("The browser could not decode a model worker response."));
  return runtimeWorker;
}

function requestWorker(request: WorkerRequestInput<"capabilities">, onLog?: (event: OnnxLogEvent) => void, onTelemetry?: (event: GenerationTelemetryEvent) => void): Promise<WorkerResultMap["capabilities"]>;
function requestWorker(request: WorkerRequestInput<"load">, onLog?: (event: OnnxLogEvent) => void, onTelemetry?: (event: GenerationTelemetryEvent) => void): Promise<WorkerResultMap["load"]>;
function requestWorker(request: WorkerRequestInput<"generate">, onLog?: (event: OnnxLogEvent) => void, onTelemetry?: (event: GenerationTelemetryEvent) => void): Promise<WorkerResultMap["generate"]>;
function requestWorker(request: WorkerRequestInput<"benchmark">, onLog?: (event: OnnxLogEvent) => void, onTelemetry?: (event: GenerationTelemetryEvent) => void): Promise<WorkerResultMap["benchmark"]>;
function requestWorker(request: WorkerRequestInput<"unload">, onLog?: (event: OnnxLogEvent) => void, onTelemetry?: (event: GenerationTelemetryEvent) => void): Promise<WorkerResultMap["unload"]>;
function requestWorker(
  request: WorkerRequestInput,
  onLog?: (event: OnnxLogEvent) => void,
  onTelemetry?: (event: GenerationTelemetryEvent) => void
): Promise<WorkerResultMap[WorkerRequestType]> {
  const requestId = `sophon-${Date.now()}-${requestCounter += 1}`;
  return new Promise<WorkerResultMap[WorkerRequestType]>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      resetRuntimeWorker(new Error(`The ${request.type} operation timed out. The model worker was restarted.`));
    }, WORKER_TIMEOUT_MS[request.type]);
    pendingRequests.set(requestId, {
      type: request.type,
      resolve: (value) => {
        if (isWorkerResult(request.type, value)) resolve(value);
        else reject(new Error(`The model worker returned an invalid ${request.type} result.`));
      },
      reject,
      timeoutId,
      onLog,
      onTelemetry
    });
    try {
      getWorker().postMessage(withRequestId(request, requestId));
    } catch (error) {
      settlePendingRequest(requestId);
      reject(error instanceof Error ? error : new Error("The model worker request could not be sent."));
    }
  });
}

function withRequestId(request: WorkerRequestInput, requestId: string): WorkerRequest {
  switch (request.type) {
    case "capabilities":
      return { type: request.type, requestId };
    case "load":
      return { type: request.type, requestId, modelId: request.modelId };
    case "generate":
      return {
        type: request.type,
        requestId,
        prompt: request.prompt,
        modelId: request.modelId,
        options: request.options
      };
    case "benchmark":
      return {
        type: request.type,
        requestId,
        modelId: request.modelId,
        suite: request.suite,
        measuredRuns: request.measuredRuns
      };
    case "unload":
      return { type: request.type, requestId, modelId: request.modelId };
  }
}

function settlePendingRequest(requestId: string) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  window.clearTimeout(pending.timeoutId);
  pendingRequests.delete(requestId);
}

function resetRuntimeWorker(error: Error) {
  const worker = runtimeWorker;
  runtimeWorker = null;
  worker?.terminate();
  for (const request of pendingRequests.values()) {
    window.clearTimeout(request.timeoutId);
    request.reject(error);
  }
  pendingRequests.clear();
}
