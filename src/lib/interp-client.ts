import type {
  ChatTurn,
  GenerationCancelResult,
  GenerationTelemetryEvent,
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
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: number;
  onLog?: (event: OnnxLogEvent) => void;
  onTelemetry?: (event: GenerationTelemetryEvent) => void;
};

const WORKER_TIMEOUT_MS: Record<WorkerRequestType, number> = {
  capabilities: 10_000,
  generate: 30 * 60_000,
  cancel: 10_000,
  preload: 30 * 60_000
};

let runtimeWorker: Worker | null = null;
let activeGenerationRequestId: string | null = null;
let requestCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();

export function getCapabilities(): Promise<RuntimeCapabilities> {
  return dispatchWorkerRequest({ type: "capabilities" }).promise;
}

export async function runPrompt(messages: readonly ChatTurn[], options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  const request = dispatchWorkerRequest({
    type: "generate",
    messages: [...messages],
    modelId: options.modelId ?? "tiny-gpt2",
    options: {
      maxNewTokens: options.maxNewTokens,
      temperature: options.temperature,
      topK: options.topK
    }
  }, options.onLog, options.onTelemetry);
  activeGenerationRequestId = request.requestId;
  const cancel = () => {
    void cancelGeneration(request.requestId).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();

  try {
    return await request.promise;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    if (activeGenerationRequestId === request.requestId) activeGenerationRequestId = null;
  }
}

export async function cancelGeneration(targetRequestId = activeGenerationRequestId): Promise<GenerationCancelResult> {
  if (!targetRequestId) return { cancelled: false, targetRequestId: null };
  return dispatchWorkerRequest({ type: "cancel", targetRequestId }).promise;
}

export async function preloadModel(modelId: string, onLog?: (event: OnnxLogEvent) => void) {
  await dispatchWorkerRequest({ type: "preload", modelId }, onLog).promise;
}

export function terminateRuntimeWorker() {
  resetRuntimeWorker(new Error("The model worker was terminated."));
}

function getWorker() {
  if (runtimeWorker) return runtimeWorker;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Sophon requires Web Worker support for local inference.");
  }
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

function dispatchWorkerRequest<R extends WorkerRequestInput>(
  request: R,
  onLog?: (event: OnnxLogEvent) => void,
  onTelemetry?: (event: GenerationTelemetryEvent) => void
): { requestId: string; promise: Promise<WorkerResultMap[R["type"]]> } {
  const requestId = `sophon-${Date.now()}-${requestCounter += 1}`;
  const promise = new Promise<WorkerResultMap[R["type"]]>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      resetRuntimeWorker(new Error(`The ${request.type} operation timed out. The model worker was restarted.`));
    }, WORKER_TIMEOUT_MS[request.type]);
    pendingRequests.set(requestId, {
      resolve: (value) => {
        if (isWorkerResult(request.type, value)) resolve(value as WorkerResultMap[R["type"]]);
        else reject(new Error(`The model worker returned an invalid ${request.type} result.`));
      },
      reject,
      timeoutId,
      onLog,
      onTelemetry
    });
    try {
      getWorker().postMessage({ ...request, requestId } satisfies WorkerRequest);
    } catch (error) {
      settlePendingRequest(requestId);
      reject(error instanceof Error ? error : new Error("The model worker request could not be sent."));
    }
  });
  return { requestId, promise };
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
  activeGenerationRequestId = null;
  worker?.terminate();
  for (const request of pendingRequests.values()) {
    window.clearTimeout(request.timeoutId);
    request.reject(error);
  }
  pendingRequests.clear();
}
