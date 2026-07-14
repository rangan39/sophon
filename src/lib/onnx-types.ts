export type OnnxRuntimePhase = "download" | "tokenize" | "inference" | "generate" | "runtime";

export type OnnxLogLevel = "info" | "success" | "warning" | "error";

export type OnnxLogEvent = {
  level: OnnxLogLevel;
  message: string;
  detail?: string;
  phase?: OnnxRuntimePhase;
  durationMs?: number;
};

export type OnnxRunOptions = {
  modelId?: string;
  maxNewTokens?: number;
  temperature?: number;
  onLog?: (event: OnnxLogEvent) => void;
};

export type OnnxToken = {
  id: number;
  text: string;
};

export type OnnxRunResult = {
  model: {
    label: string;
    baseModel: string;
    modelPath: string;
    sequenceLength: number;
  };
  prompt: string;
  generatedText: string;
  fullText: string;
  generatedTokens: OnnxToken[];
  inputTokenCount: number;
  outputTokenCount: number;
  elapsedMs: number;
  tokensPerSecond: number;
  inputNames: string[];
  outputNames: string[];
  outputShapes: Record<string, number[]>;
};

export type OnnxRunFailure = {
  ok: false;
  code: "WEBGPU_UNAVAILABLE" | "PROMPT_TOO_LONG" | "REQUEST_FAILED";
  message: string;
  tokenCount?: number;
  maxTokens?: number;
};

export type OnnxRunResponse = { ok: true; result: OnnxRunResult } | OnnxRunFailure;
