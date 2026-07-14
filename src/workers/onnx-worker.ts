import { runOnnxTextModel } from "@/lib/onnx-runner";
import type { OnnxLogEvent, OnnxRunOptions } from "@/lib/onnx-types";

type OnnxWorkerRequest = {
  type: "run";
  id: number;
  prompt: string;
  modelId?: string;
  options?: Pick<OnnxRunOptions, "maxNewTokens" | "temperature">;
};

function postLog(id: number, event: OnnxLogEvent) {
  self.postMessage({ type: "log", id, event });
}

self.onmessage = (message: MessageEvent<OnnxWorkerRequest>) => {
  const data = message.data;
  if (!data || data.type !== "run") return;

  void runOnnxTextModel(data.prompt, {
    modelId: data.modelId,
    ...data.options,
    onLog: (event) => postLog(data.id, event)
  }).then((response) => {
    self.postMessage({ type: "complete", id: data.id, result: response });
  });
};
