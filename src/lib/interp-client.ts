import { parsePromptRun, PromptRun } from "@/lib/prompt-run";

export const MAX_PROMPT_CHARS = 280;
export const MAX_PROMPT_TOKENS = 64;

export type RunPromptResult =
  | { ok: true; run: PromptRun }
  | {
      ok: false;
      code: "PROMPT_TOO_LONG" | "SERVICE_UNAVAILABLE" | "REQUEST_FAILED";
      message: string;
      tokenCount?: number;
      maxTokens?: number;
    };

export async function runPrompt(prompt: string): Promise<RunPromptResult> {
  try {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        model: "gpt2-small",
        maxTokens: MAX_PROMPT_TOKENS,
        topKPredictions: 5,
        topKAttentionEdges: 8
      })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        code: payload?.code ?? "REQUEST_FAILED",
        message: payload?.message ?? "The interpretability service could not run this prompt.",
        tokenCount: payload?.tokenCount,
        maxTokens: payload?.maxTokens
      };
    }

    const run = parsePromptRun(payload);
    if (!run) {
      return {
        ok: false,
        code: "REQUEST_FAILED",
        message: "The interpretability service returned an invalid run payload."
      };
    }

    return { ok: true, run };
  } catch {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "The interpretability service is not reachable."
    };
  }
}
