export type ModelProvider = "webgpu" | "wasm";
export type ModelVerification = "verified" | "experimental";
export type ModelFamily = "gpt2" | "smollm" | "qwen" | "llama";

type LocalModelSource = {
  kind: "local";
  baseUrl: string;
  metadataUrl: string;
  modelPath: string;
  revision: "bundled";
};

type HuggingFaceModelSource = {
  kind: "huggingface";
  repo: string;
  revision: string;
};

export type ModelManifest = {
  id: string;
  label: string;
  family: ModelFamily;
  description: string;
  verification: ModelVerification;
  source: LocalModelSource | HuggingFaceModelSource;
  format: {
    weights: "onnx";
    quantization: "fp32" | "fp16" | "int8" | "q4";
    sizeLabel: string;
    sizeBytes: number | null;
    contextLength: number | null;
  };
  graph: {
    adapter: "full-context" | "transformers-js";
    generation: "full-context" | "with-past";
    inputNames: readonly string[];
    outputNames: readonly string[];
  };
  providers: readonly ModelProvider[];
};

export const MODEL_REGISTRY: readonly ModelManifest[] = [
  {
    id: "tiny-gpt2",
    label: "Tiny GPT-2",
    family: "gpt2",
    description: "Bundled baseline used to verify Sophon's ONNX/WebGPU runtime.",
    verification: "verified",
    source: {
      kind: "local",
      baseUrl: "/models/sshleifer-tiny-gpt2-trace",
      metadataUrl: "/models/sshleifer-tiny-gpt2-trace/sophon-trace.json",
      modelPath: "/models/sshleifer-tiny-gpt2-trace/onnx/model.onnx",
      revision: "bundled"
    },
    format: {
      weights: "onnx",
      quantization: "fp32",
      sizeLabel: "15 MB",
      sizeBytes: 15_000_000,
      contextLength: 128
    },
    graph: {
      adapter: "full-context",
      generation: "full-context",
      inputNames: ["input_ids", "attention_mask"],
      outputNames: ["logits"]
    },
    providers: ["webgpu"]
  },
  {
    id: "smollm2-135m",
    label: "SmolLM2 135M Instruct",
    family: "smollm",
    description: "Small instruction model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/SmolLM2-135M-Instruct-ONNX", revision: "main" },
    format: { weights: "onnx", quantization: "q4", sizeLabel: "~140 MB", sizeBytes: null, contextLength: null },
    graph: { adapter: "transformers-js", generation: "with-past", inputNames: [], outputNames: [] },
    providers: ["webgpu", "wasm"]
  },
  {
    id: "smollm2-360m",
    label: "SmolLM2 360M Instruct",
    family: "smollm",
    description: "Larger SmolLM2 variant; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "HuggingFaceTB/SmolLM2-360M-Instruct", revision: "main" },
    format: { weights: "onnx", quantization: "q4", sizeLabel: "~360 MB", sizeBytes: null, contextLength: null },
    graph: { adapter: "transformers-js", generation: "with-past", inputNames: [], outputNames: [] },
    providers: ["webgpu", "wasm"]
  },
  {
    id: "qwen25-coder-0.5b",
    label: "Qwen2.5 Coder 0.5B",
    family: "qwen",
    description: "Coding-focused model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Qwen2.5-Coder-0.5B-Instruct", revision: "main" },
    format: { weights: "onnx", quantization: "q4", sizeLabel: "~500 MB", sizeBytes: null, contextLength: null },
    graph: { adapter: "transformers-js", generation: "with-past", inputNames: [], outputNames: [] },
    providers: ["webgpu"]
  },
  {
    id: "llama32-1b",
    label: "Llama 3.2 1B Instruct",
    family: "llama",
    description: "Desktop-class model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Llama-3.2-1B-Instruct-ONNX", revision: "main" },
    format: { weights: "onnx", quantization: "q4", sizeLabel: "~1 GB", sizeBytes: null, contextLength: null },
    graph: { adapter: "transformers-js", generation: "with-past", inputNames: [], outputNames: [] },
    providers: ["webgpu"]
  },
  {
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B",
    family: "qwen",
    description: "Large experimental model intended for high-memory desktop GPUs.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Qwen3-1.7B-ONNX", revision: "main" },
    format: { weights: "onnx", quantization: "q4", sizeLabel: "~1.7 GB", sizeBytes: null, contextLength: null },
    graph: { adapter: "transformers-js", generation: "with-past", inputNames: [], outputNames: [] },
    providers: ["webgpu"]
  }
] as const;

export const DEFAULT_ONNX_MODEL = MODEL_REGISTRY[0];

export function getModelDefinition(id = DEFAULT_ONNX_MODEL.id) {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? DEFAULT_ONNX_MODEL;
}

export function getModelRepo(model: ModelManifest) {
  return model.source.kind === "huggingface" ? model.source.repo : "sshleifer/tiny-gpt2";
}
