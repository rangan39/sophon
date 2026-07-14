export type ModelDefinition = {
  id: string;
  label: string;
  family: string;
  source: "local" | "huggingface";
  repo: string;
  sizeLabel: string;
  description: string;
  supports: {
    webgpu: boolean;
    wasm: boolean;
  };
  baseUrl?: string;
  metadataUrl?: string;
  modelPath?: string;
};

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  {
    id: "tiny-gpt2",
    label: "Tiny GPT-2",
    family: "GPT-2",
    source: "local",
    repo: "sshleifer/tiny-gpt2",
    sizeLabel: "15 MB",
    description: "Local starter model for testing the runtime.",
    supports: { webgpu: true, wasm: false },
    baseUrl: "/models/sshleifer-tiny-gpt2-trace",
    metadataUrl: "/models/sshleifer-tiny-gpt2-trace/sophon-trace.json",
    modelPath: "/models/sshleifer-tiny-gpt2-trace/onnx/model.onnx"
  },
  {
    id: "smollm2-135m",
    label: "SmolLM2 135M Instruct",
    family: "SmolLM2",
    source: "huggingface",
    repo: "onnx-community/SmolLM2-135M-Instruct-ONNX",
    sizeLabel: "~140 MB",
    description: "Small instruction-tuned model for local chat.",
    supports: { webgpu: true, wasm: true }
  },
  {
    id: "smollm2-360m",
    label: "SmolLM2 360M Instruct",
    family: "SmolLM2",
    source: "huggingface",
    repo: "HuggingFaceTB/SmolLM2-360M-Instruct",
    sizeLabel: "~360 MB",
    description: "A stronger small model for local text generation.",
    supports: { webgpu: true, wasm: true }
  },
  {
    id: "qwen25-coder-0.5b",
    label: "Qwen2.5 Coder 0.5B",
    family: "Qwen",
    source: "huggingface",
    repo: "onnx-community/Qwen2.5-Coder-0.5B-Instruct",
    sizeLabel: "~500 MB",
    description: "Compact instruction model tuned for coding.",
    supports: { webgpu: true, wasm: false }
  },
  {
    id: "llama32-1b",
    label: "Llama 3.2 1B Instruct",
    family: "Llama",
    source: "huggingface",
    repo: "onnx-community/Llama-3.2-1B-Instruct-ONNX",
    sizeLabel: "~1 GB",
    description: "A capable general-purpose model for stronger hardware.",
    supports: { webgpu: true, wasm: false }
  },
  {
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B",
    family: "Qwen",
    source: "huggingface",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    sizeLabel: "~1.7 GB",
    description: "Higher-quality chat model for desktop-class GPUs.",
    supports: { webgpu: true, wasm: false }
  }
] as const;

export const DEFAULT_ONNX_MODEL = MODEL_REGISTRY[0];

export function getModelDefinition(id = DEFAULT_ONNX_MODEL.id) {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? DEFAULT_ONNX_MODEL;
}
