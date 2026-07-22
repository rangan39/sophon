import { MODEL_SEGMENT_DIGESTS } from "@/lib/model-delivery/segment-digests";

export const MODEL_SEGMENT_SIZE = 64 * 1024 * 1024;

export type ModelDeliveryArtifact = {
  path: string;
  externalPath: string;
  size: number;
  sha256: string;
  segmentSha256: readonly string[];
};

export type ModelAuxiliaryArtifact = Omit<ModelDeliveryArtifact, "externalPath" | "segmentSha256">;

export type ModelDeliveryManifest = {
  modelId: string;
  repo: string;
  revision: string;
  externalData: readonly ModelDeliveryArtifact[];
  auxiliary: readonly ModelAuxiliaryArtifact[];
};

const manifests = [
  manifest("tiny-aya-global", "onnx-community/tiny-aya-global-ONNX", "7fff1be9627e40f0d89c33f406882bdafb56ec90", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "136c11c8985b57f58e4565b90b0aa63ab209cd250e1769a8c28f2781f550b1c4"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "987f114e76909c265ee4ac80382bf2a6d508fbe99c892b030ac9c2a077b53373"]
  ], [
    ["config.json", 2_318, "3da94717f60de9b404cca64311a3f0d50c6847974c5d7b61b178cc32f32cb621"],
    ["onnx/model_q4f16.onnx", 362_391, "0fd23a22d297e492b29cb58c2011374c6851fd2afdadd0d151859721b4faffa7"],
    ["generation_config.json", 136, "3a9136deba1bd98df479931c7dd92c141684994e65bfdfa97d9ddc7d9cab1319"],
    ["tokenizer.json", 21_077_804, "0b0eea0844526f017ce46eed1de63cbf754145115b716193a74263bb3c93c9e3"],
    ["tokenizer_config.json", 3_846, "94f0ef9258bbdb7c0b731e71036af816718c22a1a4f190a83b5028ebae4e040d"]
  ]),
  manifest("tiny-aya-earth", "onnx-community/tiny-aya-earth-ONNX", "24a24ee8b8483762575fe734e57bad21ca36d8c6", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "06934e8fe4b1cb3652c26cb75b4adddf51e5bfca3db236c37a73d5633c74104f"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "7878d7ba2d83c1f9a2439deadc5b36a54de3b1c0a403a44847ac8aa9a1097a9e"]
  ], [
    ["config.json", 2_313, "d85da832ee269666e8c57e19f620f77cee34bb449cb6d8bcce7dfd3bd921adb0"],
    ["onnx/model_q4f16.onnx", 362_391, "0fd23a22d297e492b29cb58c2011374c6851fd2afdadd0d151859721b4faffa7"],
    ["generation_config.json", 131, "b4886e47fa2a2b0ef6f17019655625e0acb86b60536d08e62da007dc6326164d"],
    ["tokenizer.json", 21_077_804, "0b0eea0844526f017ce46eed1de63cbf754145115b716193a74263bb3c93c9e3"],
    ["tokenizer_config.json", 3_846, "94f0ef9258bbdb7c0b731e71036af816718c22a1a4f190a83b5028ebae4e040d"]
  ]),
  manifest("tiny-aya-fire", "onnx-community/tiny-aya-fire-ONNX", "70f6b7edf79955855d7939342d2a39ab644d3ed6", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "9abe27c21a14864773a0d9a3314c513fb771f4468e84b921b0298bdf0b3e8087"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "702c83998ccab013a93735759a9e2e8d1c3318a7c6fadb2a50a0418fb0d6726d"]
  ], [
    ["config.json", 2_313, "d85da832ee269666e8c57e19f620f77cee34bb449cb6d8bcce7dfd3bd921adb0"],
    ["onnx/model_q4f16.onnx", 362_391, "0fd23a22d297e492b29cb58c2011374c6851fd2afdadd0d151859721b4faffa7"],
    ["generation_config.json", 131, "b4886e47fa2a2b0ef6f17019655625e0acb86b60536d08e62da007dc6326164d"],
    ["tokenizer.json", 21_077_804, "0b0eea0844526f017ce46eed1de63cbf754145115b716193a74263bb3c93c9e3"],
    ["tokenizer_config.json", 3_846, "94f0ef9258bbdb7c0b731e71036af816718c22a1a4f190a83b5028ebae4e040d"]
  ]),
  manifest("tiny-aya-water", "onnx-community/tiny-aya-water-ONNX", "e1109b664b476b709d13bf40dc105efb147caa09", [
    ["onnx/model_q4f16.onnx_data", 2_064_531_456, "a6bb9723276b6c7f0fa17532f0d1b5bd5595092444a30ff84ed3797bb62b7fba"],
    ["onnx/model_q4f16.onnx_data_1", 268_435_456, "6c832d12d54831dd35df6f566fd200c6ec40965063bac54a9122b8c0b0d18943"]
  ], [
    ["config.json", 2_313, "d85da832ee269666e8c57e19f620f77cee34bb449cb6d8bcce7dfd3bd921adb0"],
    ["onnx/model_q4f16.onnx", 362_391, "0fd23a22d297e492b29cb58c2011374c6851fd2afdadd0d151859721b4faffa7"],
    ["generation_config.json", 131, "b4886e47fa2a2b0ef6f17019655625e0acb86b60536d08e62da007dc6326164d"],
    ["tokenizer.json", 21_077_804, "0b0eea0844526f017ce46eed1de63cbf754145115b716193a74263bb3c93c9e3"],
    ["tokenizer_config.json", 3_846, "94f0ef9258bbdb7c0b731e71036af816718c22a1a4f190a83b5028ebae4e040d"]
  ])
] as const satisfies readonly ModelDeliveryManifest[];

export const MODEL_DELIVERY_MANIFESTS: readonly ModelDeliveryManifest[] = manifests;

export function getModelDeliveryManifest(modelId: string) {
  return MODEL_DELIVERY_MANIFESTS.find((candidate) => candidate.modelId === modelId) ?? null;
}

export function getArtifactUrl(model: ModelDeliveryManifest, artifact: Pick<ModelDeliveryArtifact, "path">) {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${artifact.path}`;
}

export function getArtifactKey(model: ModelDeliveryManifest, artifact: Pick<ModelDeliveryArtifact, "path">) {
  return `${model.modelId}:${model.revision}:${artifact.path}`;
}

function manifest(
  modelId: string,
  repo: string,
  revision: string,
  artifacts: readonly (readonly [path: string, size: number, sha256: string])[],
  auxiliary: readonly (readonly [path: string, size: number, sha256: string])[]
): ModelDeliveryManifest {
  return {
    modelId,
    repo,
    revision,
    externalData: artifacts.map(([path, size, sha256]) => ({
      path,
      externalPath: path.slice(path.lastIndexOf("/") + 1),
      size,
      sha256,
      segmentSha256: getSegmentDigests(path, size, sha256)
    })),
    auxiliary: auxiliary.map(([path, size, sha256]) => ({ path, size, sha256 }))
  };
}

function getSegmentDigests(path: string, size: number, sha256: string) {
  const digests = MODEL_SEGMENT_DIGESTS[sha256];
  const expected = Math.ceil(size / MODEL_SEGMENT_SIZE);
  if (!digests || digests.length !== expected || digests.some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error(`Missing valid ${expected}-segment integrity manifest for ${path}.`);
  }
  return digests;
}
