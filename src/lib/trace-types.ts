import type { PromptRun } from "@/lib/prompt-run";

export type RunPromptResult =
  | { ok: true; run: PromptRun }
  | {
      ok: false;
      code: "PROMPT_TOO_LONG" | "SERVICE_UNAVAILABLE" | "REQUEST_FAILED";
      message: string;
      tokenCount?: number;
      maxTokens?: number;
    };

export type RuntimeLogLevel = "info" | "success" | "warning" | "error";

export type RuntimeLogEvent = {
  level: RuntimeLogLevel;
  message: string;
  detail?: string;
  phase?: "gpu" | "download" | "tokenize" | "inference" | "postprocess" | "runtime";
  durationMs?: number;
};

export type RunPromptOptions = {
  onLog?: (event: RuntimeLogEvent) => void;
};
