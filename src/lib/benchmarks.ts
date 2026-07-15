import type { BenchmarkSuite } from "@/lib/onnx-types";

export const QUICK_BENCHMARK: BenchmarkSuite = {
  id: "quick-causal-lm-v1",
  label: "Quick causal LM",
  prompts: [
    { id: "continuation", prompt: "The signal arrived just after midnight", maxNewTokens: 12 },
    { id: "instruction", prompt: "Describe a brass key in one sentence:", maxNewTokens: 12 }
  ]
};
