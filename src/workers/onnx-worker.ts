import { benchmarkOnnxModel, getRuntimeCapabilities, loadOnnxModel, runOnnxTextModel, unloadOnnxModel } from "@/lib/onnx-runner";
import type { BenchmarkSuite, OnnxLogEvent, OnnxRunOptions } from "@/lib/onnx-types";

type WorkerRequest =
  | { type: "capabilities"; requestId: string }
  | { type: "load"; requestId: string; modelId: string }
  | { type: "generate"; requestId: string; prompt: string; modelId: string; options: Pick<OnnxRunOptions, "maxNewTokens" | "temperature" | "topK"> }
  | { type: "benchmark"; requestId: string; modelId: string; suite: BenchmarkSuite; measuredRuns: number }
  | { type: "unload"; requestId: string; modelId?: string };

let taskQueue = Promise.resolve();

function postLog(requestId: string, event: OnnxLogEvent) {
  self.postMessage({ type: "log", requestId, event });
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

self.onmessage = (message: MessageEvent<WorkerRequest>) => {
  const request = message.data;
  if (!request?.requestId) return;

  if (request.type === "capabilities") {
    complete(request.requestId, getRuntimeCapabilities());
    return;
  }

  taskQueue = taskQueue.then(async () => {
    try {
      if (request.type === "load") {
        complete(request.requestId, await loadOnnxModel(request.modelId, (event) => postLog(request.requestId, event)));
        return;
      }
      if (request.type === "generate") {
        complete(request.requestId, await runOnnxTextModel(request.prompt, {
          modelId: request.modelId,
          ...request.options,
          onLog: (event) => postLog(request.requestId, event)
        }));
        return;
      }
      if (request.type === "benchmark") {
        complete(request.requestId, await benchmarkOnnxModel(request.modelId, request.suite, {
          measuredRuns: request.measuredRuns,
          onLog: (event) => postLog(request.requestId, event)
        }));
        return;
      }
      await unloadOnnxModel(request.modelId);
      complete(request.requestId, { ok: true });
    } catch (error) {
      fail(request.requestId, error);
    }
  });
};
