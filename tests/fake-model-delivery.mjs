export async function prepareModelDelivery() {
  return null;
}

export async function getModelCacheStatus() {
  return [];
}

export async function deleteModelCache(modelId) {
  return { modelId, deleted: true };
}
