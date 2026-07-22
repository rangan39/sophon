import {
  deleteOnnxModelCache,
  getOnnxModelCacheStatus,
  getRuntimeCapabilities,
  preloadOnnxModel,
  runOnnxTextModel
} from "@/lib/onnx-runner";
import type { GenerationTelemetryEvent, OnnxLogEvent } from "@/lib/onnx-types";
import { isWorkerRequest, type WorkerRequest } from "@/lib/onnx-worker-protocol";

let taskQueue = Promise.resolve();
const requestControllers = new Map<string, AbortController>();

function postLog(requestId: string, event: OnnxLogEvent) {
  self.postMessage({ type: "log", requestId, event });
}

function postTelemetry(requestId: string, telemetry: GenerationTelemetryEvent) {
  self.postMessage({ type: "telemetry", requestId, telemetry });
}

function complete(requestId: string, result: unknown) {
  self.postMessage({ type: "complete", requestId, result });
}

function fail(requestId: string, error: unknown) {
  self.postMessage({
    type: "error",
    requestId,
    message: error instanceof Error ? error.message : "The model worker failed."
  });
}

self.onmessage = (message: MessageEvent<unknown>) => {
  const request = message.data;
  if (!isWorkerRequest(request)) {
    const requestId = readRequestId(request);
    if (requestId) fail(requestId, new Error("The model worker received an invalid request."));
    return;
  }

  if (request.type === "capabilities") {
    void getRuntimeCapabilities()
      .then((capabilities) => complete(request.requestId, capabilities))
      .catch((error) => fail(request.requestId, error));
    return;
  }

  if (request.type === "cancel") {
    const controller = requestControllers.get(request.targetRequestId);
    const cancelled = Boolean(controller && !controller.signal.aborted);
    controller?.abort();
    complete(request.requestId, { cancelled, targetRequestId: request.targetRequestId });
    return;
  }

  if (request.type === "generate" || request.type === "preload" || request.type === "delete-cache") {
    requestControllers.set(request.requestId, new AbortController());
  }

  taskQueue = taskQueue.then(() => runQueuedRequest(request));
};

async function runQueuedRequest(request: Exclude<WorkerRequest, { type: "capabilities" | "cancel" }>) {
  try {
    if (request.type === "generate") {
      const controller = requestControllers.get(request.requestId);
      complete(request.requestId, await runOnnxTextModel(request.messages, {
        modelId: request.modelId,
        ...request.options,
        signal: controller?.signal,
        onLog: (event) => postLog(request.requestId, event),
        onTelemetry: (telemetry) => postTelemetry(request.requestId, telemetry)
      }));
      return;
    }
    if (request.type === "preload") {
      await preloadOnnxModel(
        request.modelId,
        (event) => postLog(request.requestId, event),
        requestControllers.get(request.requestId)?.signal
      );
      complete(request.requestId, { ok: true });
      return;
    }
    if (request.type === "cache-status") {
      complete(request.requestId, await getOnnxModelCacheStatus());
      return;
    }
    complete(request.requestId, await deleteOnnxModelCache(
      request.modelId,
      requestControllers.get(request.requestId)?.signal
    ));
  } catch (error) {
    fail(request.requestId, error);
  } finally {
    requestControllers.delete(request.requestId);
  }
}

function readRequestId(value: unknown) {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return null;
  return typeof value.requestId === "string" ? value.requestId : null;
}
