import type { OnnxLogEvent, OnnxRunOptions, OnnxRunResponse } from "@/lib/onnx-types";

export { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS } from "@/lib/trace-config";
export type { OnnxLogEvent as RuntimeLogEvent, OnnxRunResponse as RunPromptResult } from "@/lib/onnx-types";

type TraceWorkerRequest = {
  type: "run";
  id: number;
  prompt: string;
  modelId?: string;
  options?: Pick<OnnxRunOptions, "maxNewTokens" | "temperature">;
};

type TraceWorkerResponse =
  | {
      type: "log";
      id: number;
      event: OnnxLogEvent;
    }
  | {
      type: "complete";
      id: number;
      result: OnnxRunResponse;
    };

let workerRunId = 0;

export async function runPrompt(prompt: string, options: OnnxRunOptions = {}): Promise<OnnxRunResponse> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    const { runOnnxTextModel } = await import("@/lib/onnx-runner");
    return runOnnxTextModel(prompt, options);
  }

  return runPromptInWorker(prompt, options);
}

function runPromptInWorker(prompt: string, options: OnnxRunOptions): Promise<OnnxRunResponse> {
  const id = workerRunId + 1;
  workerRunId = id;
  const worker = new Worker(new URL("../workers/onnx-worker.ts", import.meta.url), {
    type: "module"
  });

  return new Promise((resolve) => {
    let settled = false;

    function finish(result: OnnxRunResponse) {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    }

    worker.onmessage = (message: MessageEvent<TraceWorkerResponse>) => {
      const data = message.data;
      if (!data || data.id !== id) return;

      if (data.type === "log") {
        options.onLog?.(data.event);
        return;
      }

      finish(data.result);
    };

    worker.onerror = (error) => {
      options.onLog?.({
        level: "error",
        message: "Trace worker failed",
        detail: error.message,
        phase: "runtime"
      });
      finish({
        ok: false,
        code: "REQUEST_FAILED",
        message: error.message || "Trace worker failed."
      });
    };

    worker.postMessage({
      type: "run",
      id,
      prompt,
      modelId: options.modelId,
      options: {
        maxNewTokens: options.maxNewTokens,
        temperature: options.temperature
      }
    } satisfies TraceWorkerRequest);
  });
}
