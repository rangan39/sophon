export const env = { allowLocalModels: false, allowRemoteModels: true, remotePathTemplate: "{model}/resolve/{revision}/" };
export const pipelineCalls = [];
export const pipelineRemotePathTemplates = [];

export async function pipeline(...args) {
  pipelineCalls.push(args);
  pipelineRemotePathTemplates.push(env.remotePathTemplate);
  args[2].progress_callback?.({ status: "progress_total", name: args[1], progress: 25, loaded: 25, total: 100, files: {} });
  args[2].progress_callback?.({ status: "progress_total", name: args[1], progress: 25.5, loaded: 25.5, total: 100, files: {} });
  args[2].progress_callback?.({ status: "progress_total", name: args[1], progress: 100, loaded: 100, total: 100, files: {} });
  return { dispose: async () => undefined };
}
