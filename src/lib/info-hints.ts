export const INFO_HINTS = {
  modelSpecs: {
    label: "About model specifications",
    title: "Model specifications",
    description: "3.35B is the parameter count. 4-bit (q4f16) compresses the weights while using 16-bit activations. 8K is an 8,192-token context window."
  },
  browserStorage: {
    label: "About browser storage",
    title: "Browser storage",
    description: "The first value is Sophon’s current site usage; the second is the browser’s estimated quota, not reserved disk space. Persistent storage is protected from routine eviction; best effort data may be removed when space is low."
  },
  generationMetrics: {
    label: "About response metrics",
    title: "Response metrics",
    description: "Input → output shows tokens used and generated. tokens/s is generation speed; TTFT is the wait until the first generated token. A fraction means earlier input was omitted to fit the context."
  },
  webgpu: {
    label: "About WebGPU",
    title: "WebGPU",
    description: "WebGPU runs the model on this device’s GPU inside the browser. Prompts and responses are not sent to an inference server."
  },
  tokenLens: {
    label: "About token display",
    title: "Token display",
    description: "Text shows the rendered message. Tokens shows the model pieces and IDs; Words groups them. Outside context means a piece was not included in the active input."
  },
  modelLicense: {
    label: "About model usage",
    title: "Model usage",
    description: "Tiny Aya weights are available for non-commercial use under CC BY-NC 4.0 and remain subject to Cohere Labs’ Acceptable Use Policy."
  }
} as const;

export type InfoHintId = keyof typeof INFO_HINTS;
