import { QUICK_BENCHMARK } from "@/lib/benchmarks";
import type {
  BenchmarkResult,
  BenchmarkSuite,
  ModelLoadResult,
  OnnxLogEvent,
  OnnxRunOptions,
  OnnxRunResponse,
  RuntimeCapabilities
} from "@/lib/onnx-types";

export { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS } from "@/lib/trace-config";
export type { OnnxLogEvent as RuntimeLogEvent, OnnxRunResponse as RunPromptResult } from "@/lib/onnx-types";

type WorkerRequest =
  | { type: "capabilities"; requestId: string }
  | { type: "load"; requestId: string; modelId: string }
  | { type: "generate"; requestId: string; prompt: string; modelId: string; options: Pick<OnnxRunOptions, "maxNewTokens" | "temperature" | "topK"> }
  | { type: "benchmark"; requestId: string; modelId: string; suite: BenchmarkSuite; measuredRuns: number }
  | { type: "unload"; requestId: string; modelId?: string };

type WorkerRequestInput = WorkerRequest extends infer Request
  ? Request extends { requestId: string }
    ? Omit<Request, "requestId">
    : never
  : never;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onLog?: (event: OnnxLogEvent) => void;
};

let runtimeWorker: Worker | null = null;
let requestCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();

export async function getCapabilities(): Promise<RuntimeCapabilities> {
  if (!canUseWorker()) {
    const { getRuntimeCapabilities } = await import("@/lib/onnx-runner");
    return getRuntimeCapabilities();
  }
  return requestWorker<RuntimeCapabilities>({ type: "capabilities" });
}

export async function loadModel(modelId: string, onLog?: (event: OnnxLogEvent) => void): Promise<ModelLoadResult> {
  if (!canUseWorker()) {
    const { loadOnnxModel } = await import("@/lib/onnx-runner");
    return loadOnnxModel(modelId, onLog);
  }
  return requestWorker<ModelLoadResult>({ type: "load", modelId }, onLog);
}

export async function runPrompt(prompt: string, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  if (!canUseWorker()) {
    const { runOnnxTextModel } = await import("@/lib/onnx-runner");
    return runOnnxTextModel(prompt, options);
  }
  return requestWorker<OnnxRunResponse>({
    type: "generate",
    prompt,
    modelId: options.modelId ?? "tiny-gpt2",
    options: {
      maxNewTokens: options.maxNewTokens,
      temperature: options.temperature,
      topK: options.topK
    }
  }, options.onLog);
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
  return requestWorker<BenchmarkResult>({ type: "benchmark", modelId, suite, measuredRuns }, options.onLog);
}

export async function unloadModel(modelId?: string) {
  if (!canUseWorker()) {
    const { unloadOnnxModel } = await import("@/lib/onnx-runner");
    await unloadOnnxModel(modelId);
    return;
  }
  await requestWorker<{ ok: true }>({ type: "unload", modelId });
}

export function terminateRuntimeWorker() {
  runtimeWorker?.terminate();
  runtimeWorker = null;
  const error = new Error("The model worker was terminated.");
  for (const request of pendingRequests.values()) request.reject(error);
  pendingRequests.clear();
}

function canUseWorker() {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function getWorker() {
  if (runtimeWorker) return runtimeWorker;
  runtimeWorker = new Worker(new URL("../workers/onnx-worker.ts", import.meta.url), { type: "module" });
  runtimeWorker.onmessage = (message: MessageEvent<{ type: "log" | "complete" | "error"; requestId: string; event?: OnnxLogEvent; result?: unknown; message?: string }>) => {
    const response = message.data;
    const pending = pendingRequests.get(response.requestId);
    if (!pending) return;
    if (response.type === "log") {
      if (response.event) pending.onLog?.(response.event);
      return;
    }
    pendingRequests.delete(response.requestId);
    if (response.type === "error") pending.reject(new Error(response.message || "The model worker failed."));
    else pending.resolve(response.result);
  };
  runtimeWorker.onerror = (event) => {
    const error = new Error(event.message || "The model worker failed.");
    for (const request of pendingRequests.values()) request.reject(error);
    pendingRequests.clear();
    runtimeWorker?.terminate();
    runtimeWorker = null;
  };
  return runtimeWorker;
}

function requestWorker<T>(request: WorkerRequestInput, onLog?: (event: OnnxLogEvent) => void) {
  const requestId = `sophon-${Date.now()}-${requestCounter += 1}`;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      onLog
    });
    getWorker().postMessage({ ...request, requestId } satisfies WorkerRequest);
  });
}
