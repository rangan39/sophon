export type Token = {
  index: number;
  text: string;
  id?: number;
  displayText?: string | null;
  kind?: "normal" | "bos" | "eos" | "special";
};

export type AttentionEdge = {
  from: number;
  to: number;
  query?: number;
  key?: number;
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
  featuresAvailable?: boolean;
  expectedNextToken?: string;
  tokens: Token[];
  layers: LayerState[];
  finalPredictions: {
    token: string;
    displayToken?: string | null;
    kind?: "normal" | "special";
    probability: number;
  }[];
};

export type MetricMode = "residual" | "attribution" | "logit";

export function metricValue(layer: LayerState, tokenIndex: number, metric: MetricMode) {
  if (metric === "attribution") return layer.attribution[tokenIndex] ?? 0;
  if (metric === "logit") return layer.logitConfidence[tokenIndex] ?? 0;
  return layer.residualNorm[tokenIndex] ?? 0;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isToken(value: unknown): value is Token {
  if (!value || typeof value !== "object") return false;
  const token = value as Token;
  return typeof token.index === "number" && typeof token.text === "string";
}

function isAttentionEdge(value: unknown): value is AttentionEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as AttentionEdge;
  return typeof edge.from === "number" && typeof edge.to === "number" && typeof edge.weight === "number" && typeof edge.head === "number";
}

function isLayerState(value: unknown): value is LayerState {
  if (!value || typeof value !== "object") return false;
  const layer = value as LayerState;
  return (
    typeof layer.layer === "number" &&
    isNumberArray(layer.residualNorm) &&
    isNumberArray(layer.attribution) &&
    isNumberArray(layer.logitConfidence) &&
    Array.isArray(layer.topFeature) &&
    Array.isArray(layer.attention) &&
    layer.attention.every(isAttentionEdge)
  );
}

function isPrediction(value: unknown): value is PromptRun["finalPredictions"][number] {
  if (!value || typeof value !== "object") return false;
  const prediction = value as PromptRun["finalPredictions"][number];
  return typeof prediction.token === "string" && typeof prediction.probability === "number";
}

export function parsePromptRun(value: unknown): PromptRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as PromptRun;
  if (
    typeof run.id !== "string" ||
    typeof run.title !== "string" ||
    typeof run.prompt !== "string" ||
    typeof run.model !== "string" ||
    typeof run.source !== "string" ||
    !Array.isArray(run.tokens) ||
    !run.tokens.every(isToken) ||
    !Array.isArray(run.layers) ||
    !run.layers.every(isLayerState) ||
    !Array.isArray(run.finalPredictions) ||
    !run.finalPredictions.every(isPrediction)
  ) {
    return null;
  }
  return run;
}

export function displayTokenText(token: Pick<Token, "text" | "displayText"> | null | undefined) {
  if (!token) return "unknown";
  return token.displayText || token.text.trim() || "space";
}

export function displayPredictionToken(prediction: PromptRun["finalPredictions"][number]) {
  return prediction.displayToken || prediction.token.trim() || "space";
}
