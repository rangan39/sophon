export const MODEL_SEGMENT_SIZE = 64 * 1024 * 1024;

export type ModelDeliveryArtifact = {
  path: string;
  externalPath: string;
  size: number;
  sha256: string;
};

export type ModelDeliveryManifest = {
  modelId: string;
  repo: string;
  revision: string;
  externalData: readonly ModelDeliveryArtifact[];
};

const manifests = [
  manifest("tiny-aya-global", "onnx-community/tiny-aya-global-ONNX", "7fff1be9627e40f0d89c33f406882bdafb56ec90", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "136c11c8985b57f58e4565b90b0aa63ab209cd250e1769a8c28f2781f550b1c4"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "987f114e76909c265ee4ac80382bf2a6d508fbe99c892b030ac9c2a077b53373"]
  ]),
  manifest("tiny-aya-earth", "onnx-community/tiny-aya-earth-ONNX", "24a24ee8b8483762575fe734e57bad21ca36d8c6", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "06934e8fe4b1cb3652c26cb75b4adddf51e5bfca3db236c37a73d5633c74104f"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "7878d7ba2d83c1f9a2439deadc5b36a54de3b1c0a403a44847ac8aa9a1097a9e"]
  ]),
  manifest("tiny-aya-fire", "onnx-community/tiny-aya-fire-ONNX", "70f6b7edf79955855d7939342d2a39ab644d3ed6", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "9abe27c21a14864773a0d9a3314c513fb771f4468e84b921b0298bdf0b3e8087"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "702c83998ccab013a93735759a9e2e8d1c3318a7c6fadb2a50a0418fb0d6726d"]
  ]),
  manifest("tiny-aya-water", "onnx-community/tiny-aya-water-ONNX", "e1109b664b476b709d13bf40dc105efb147caa09", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "a6bb9723276b6c7f0fa17532f0d1b5bd5595092444a30ff84ed3797bb62b7fba"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "6c832d12d54831dd35df6f566fd200c6ec40965063bac54a9122b8c0b0d18943"]
  ])
] as const satisfies readonly ModelDeliveryManifest[];

export const MODEL_DELIVERY_MANIFESTS: readonly ModelDeliveryManifest[] = manifests;

export function getModelDeliveryManifest(modelId: string) {
  return MODEL_DELIVERY_MANIFESTS.find((candidate) => candidate.modelId === modelId) ?? null;
}

export function getArtifactUrl(model: ModelDeliveryManifest, artifact: ModelDeliveryArtifact) {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${artifact.path}`;
}

export function getArtifactKey(model: ModelDeliveryManifest, artifact: ModelDeliveryArtifact) {
  return `${model.modelId}:${model.revision}:${artifact.path}`;
}

function manifest(
  modelId: string,
  repo: string,
  revision: string,
  artifacts: readonly (readonly [path: string, size: number, sha256: string])[]
): ModelDeliveryManifest {
  return {
    modelId,
    repo,
    revision,
    externalData: artifacts.map(([path, size, sha256]) => ({
      path,
      externalPath: path.slice(path.lastIndexOf("/") + 1),
      size,
      sha256
    }))
  };
}
