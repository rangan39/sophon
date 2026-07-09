import { runPromptDirect } from "@/lib/trace-runtime";
import type { RuntimeLogEvent } from "@/lib/trace-types";

type TraceWorkerRequest = {
  type: "run";
  id: number;
  prompt: string;
};

function postLog(id: number, event: RuntimeLogEvent) {
  self.postMessage({
    type: "log",
    id,
    event
  });
}

self.onmessage = (message: MessageEvent<TraceWorkerRequest>) => {
  const data = message.data;
  if (!data || data.type !== "run") return;

  void runPromptDirect(data.prompt, {
    onLog: (event) => postLog(data.id, event)
  }).then((result) => {
    self.postMessage({
      type: "complete",
      id: data.id,
      result
    });
  });
};
