import type { RunPromptOptions, RunPromptResult, RuntimeLogEvent } from "@/lib/trace-types";

export { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS } from "@/lib/trace-config";
export type { RunPromptOptions, RunPromptResult, RuntimeLogEvent, RuntimeLogLevel } from "@/lib/trace-types";

type TraceWorkerRequest = {
  type: "run";
  id: number;
  prompt: string;
};

type TraceWorkerResponse =
  | {
      type: "log";
      id: number;
      event: RuntimeLogEvent;
    }
  | {
      type: "complete";
      id: number;
      result: RunPromptResult;
    };

let workerRunId = 0;

export async function runPrompt(prompt: string, options: RunPromptOptions = {}): Promise<RunPromptResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    const { runPromptDirect } = await import("@/lib/trace-runtime");
    return runPromptDirect(prompt, options);
  }

  return runPromptInWorker(prompt, options);
}

function runPromptInWorker(prompt: string, options: RunPromptOptions): Promise<RunPromptResult> {
  const id = workerRunId + 1;
  workerRunId = id;
  const worker = new Worker(new URL("../workers/trace-worker.ts", import.meta.url), {
    type: "module"
  });

  return new Promise((resolve) => {
    let settled = false;

    function finish(result: RunPromptResult) {
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

    worker.postMessage({ type: "run", id, prompt } satisfies TraceWorkerRequest);
  });
}
