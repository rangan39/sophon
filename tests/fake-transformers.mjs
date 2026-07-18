export const env = { remotePathTemplate: "{model}/resolve/{revision}/" };
export const pipelineCalls = [];
export const pipelineRemotePathTemplates = [];

export async function pipeline(...args) {
  pipelineCalls.push(args);
  pipelineRemotePathTemplates.push(env.remotePathTemplate);
  return { dispose: async () => undefined };
}
