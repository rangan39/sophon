export type Token = {
  index: number;
  text: string;
  id?: number;
};

export type AttentionEdge = {
  from: number;
  to: number;
  weight: number;
  head: number;
};

export type LayerState = {
  layer: number;
  residualNorm: number[];
  attribution: number[];
  logitConfidence: number[];
  topFeature: {
    id: string;
    activation: number;
    label: string;
  }[];
  attention: AttentionEdge[];
};

export type PromptRun = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  source: string;
  expectedNextToken?: string;
  tokens: Token[];
  layers: LayerState[];
  finalPredictions: {
    token: string;
    probability: number;
  }[];
};

export type MetricMode = "residual" | "attribution" | "logit";

export function metricValue(layer: LayerState, tokenIndex: number, metric: MetricMode) {
  if (metric === "attribution") return layer.attribution[tokenIndex] ?? 0;
  if (metric === "logit") return layer.logitConfidence[tokenIndex] ?? 0;
  return layer.residualNorm[tokenIndex] ?? 0;
}
