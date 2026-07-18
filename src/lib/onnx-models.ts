export type ModelProvider = "webgpu" | "wasm";
export type ModelVerification = "verified" | "experimental";
export type ModelFamily = "gpt2" | "smollm" | "qwen" | "llama";

const BUNDLED_MODEL_BASE_URL = "/models/v-196cb8befc7d/sshleifer-tiny-gpt2-trace";

type LocalModelSource = {
  kind: "local";
  baseUrl: string;
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
    quantization: "fp32" | "fp16" | "int8" | "q4";
    sizeLabel: string;
    sizeBytes: number | null;
    contextLength: number | null;
  };
  providers: readonly ModelProvider[];
};

export function resolveModelProvider(
  model: Pick<ModelManifest, "providers">,
  capabilities: Readonly<Record<ModelProvider, boolean>>
): ModelProvider | null {
  for (const provider of model.providers) {
    if (capabilities[provider]) return provider;
  }
  return null;
}

export const MODEL_REGISTRY = [
  {
    id: "tiny-gpt2",
    label: "Tiny GPT-2",
    family: "gpt2",
    description: "Bundled cached-decoder baseline used to verify Sophon's local runtime.",
    verification: "verified",
    source: {
      kind: "local",
      baseUrl: BUNDLED_MODEL_BASE_URL,
      revision: "bundled"
    },
    format: {
      quantization: "fp32",
      sizeLabel: "4.1 MB",
      sizeBytes: 4_051_176,
      contextLength: 1024
    },
    providers: ["wasm", "webgpu"]
  },
  {
    id: "smollm2-135m",
    label: "SmolLM2 135M Instruct",
    family: "smollm",
    description: "Small instruction model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/SmolLM2-135M-Instruct-ONNX", revision: "b8a5c0f183b78c55955a5364f610c36668b5e681" },
    format: { quantization: "q4", sizeLabel: "~140 MB", sizeBytes: null, contextLength: null },
    providers: ["webgpu", "wasm"]
  },
  {
    id: "smollm2-360m",
    label: "SmolLM2 360M Instruct",
    family: "smollm",
    description: "Larger SmolLM2 variant; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "HuggingFaceTB/SmolLM2-360M-Instruct", revision: "a10cc1512eabd3dde888204e902eca88bddb4951" },
    format: { quantization: "q4", sizeLabel: "~360 MB", sizeBytes: null, contextLength: null },
    providers: ["webgpu", "wasm"]
  },
  {
    id: "qwen25-coder-0.5b",
    label: "Qwen2.5 Coder 0.5B",
    family: "qwen",
    description: "Coding-focused model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Qwen2.5-Coder-0.5B-Instruct", revision: "f0292f665fd307846ff3c318a91a1bc29d091492" },
    format: { quantization: "q4", sizeLabel: "~500 MB", sizeBytes: null, contextLength: null },
    providers: ["webgpu"]
  },
  {
    id: "llama32-1b",
    label: "Llama 3.2 1B Instruct",
    family: "llama",
    description: "Desktop-class model; repository compatibility is not yet certified by Sophon.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Llama-3.2-1B-Instruct-ONNX", revision: "14007543b6dc92de88daf96a9aa85d2f95ace6ef" },
    format: { quantization: "q4", sizeLabel: "~1 GB", sizeBytes: null, contextLength: null },
    providers: ["webgpu"]
  },
  {
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B",
    family: "qwen",
    description: "Large experimental model intended for high-memory desktop GPUs.",
    verification: "experimental",
    source: { kind: "huggingface", repo: "onnx-community/Qwen3-1.7B-ONNX", revision: "cc6a06a21d614e9b8e92a6adfab1074d4e7d2438" },
    format: { quantization: "q4", sizeLabel: "~1.7 GB", sizeBytes: null, contextLength: null },
    providers: ["webgpu"]
  }
] as const satisfies readonly [ModelManifest, ...ModelManifest[]];

export const DEFAULT_ONNX_MODEL = MODEL_REGISTRY[0];

export function getModelDefinition(id: string = DEFAULT_ONNX_MODEL.id) {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? DEFAULT_ONNX_MODEL;
}

export function requireModelDefinition(id: string = DEFAULT_ONNX_MODEL.id) {
  const model = MODEL_REGISTRY.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown model identifier: ${id}`);
  return model;
}
