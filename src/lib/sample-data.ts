export type PromptKind =
  | "factual"
  | "induction"
  | "code"
  | "ambiguity"
  | "safety";

export type Token = {
  index: number;
  text: string;
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
  id: PromptKind;
  title: string;
  prompt: string;
  model: string;
  source: string;
  expectedNextToken: string;
  tokens: Token[];
  layers: LayerState[];
  finalPredictions: {
    token: string;
    probability: number;
  }[];
};

const featureLabels = [
  "country-capital relation",
  "repeated-token copy pattern",
  "Python syntax structure",
  "polysemous noun context",
  "instruction boundary",
  "entity lookup",
  "delimiter continuation",
  "sentiment pivot",
  "numeric operator",
  "next-token scaffold"
];

const promptSeeds: Record<PromptKind, number> = {
  factual: 13,
  induction: 29,
  code: 47,
  ambiguity: 61,
  safety: 83
};

function tokenize(prompt: string): Token[] {
  return prompt.split(/(\s+)/).filter(Boolean).map((text, index) => ({
    index,
    text: text === " " ? " " : text
  }));
}

function wave(seed: number, layer: number, token: number, scale = 1) {
  const a = Math.sin((seed + layer * 3.1 + token * 1.7) * 0.43);
  const b = Math.cos((seed + token * 2.3 - layer * 0.9) * 0.29);
  return Math.max(0, Math.min(1, (a + b + 2) / 4)) * scale;
}

function buildLayers(kind: PromptKind, tokenCount: number): LayerState[] {
  const seed = promptSeeds[kind];

  return Array.from({ length: kind === "induction" ? 10 : 12 }, (_, layer) => {
    const residualNorm = Array.from({ length: tokenCount }, (_, token) => {
      const lateBoost = layer / 12;
      const targetBoost = token === tokenCount - 1 ? 0.25 + lateBoost * 0.3 : 0;
      const inductionBoost =
        kind === "induction" && token > 2 && token % 3 === layer % 3 ? 0.22 : 0;
      return Math.min(1, 0.18 + wave(seed, layer, token, 0.65) + targetBoost + inductionBoost);
    });

    const attribution = residualNorm.map((value, token) => {
      const focus =
        kind === "factual" && /France|capital/i.test(samplePrompts[kind].tokens[token]?.text ?? "")
          ? 0.32
          : kind === "code" && /def|return|:/i.test(samplePrompts[kind].tokens[token]?.text ?? "")
            ? 0.28
            : 0;
      return Math.min(1, value * (0.4 + layer / 18) + focus);
    });

    const logitConfidence = residualNorm.map((value, token) =>
      Math.min(1, value * 0.34 + (token === tokenCount - 1 ? layer / 14 : layer / 36))
    );

    const attention: AttentionEdge[] = Array.from({ length: Math.min(8, tokenCount) }, (_, i) => {
      const from = Math.min(tokenCount - 1, Math.max(1, tokenCount - 1 - (i % 4)));
      const to =
        kind === "induction"
          ? Math.max(0, from - 3)
          : kind === "factual"
            ? Math.max(0, tokenCount - 3)
            : Math.max(0, from - 1 - ((layer + i) % Math.max(1, tokenCount - 2)));
      return {
        from,
        to,
        head: (layer + i) % 12,
        weight: Math.min(1, 0.18 + wave(seed + 7, layer, i, 0.78))
      };
    }).filter((edge) => edge.from !== edge.to);

    return {
      layer,
      residualNorm,
      attribution,
      logitConfidence,
      attention,
      topFeature: residualNorm.map((value, token) => ({
        id: `${layer}.${(seed * 97 + token * 31 + layer * 11) % 24576}`,
        activation: Number((value * 21.8).toFixed(2)),
        label: featureLabels[(seed + token + layer) % featureLabels.length]
      }))
    };
  });
}

const promptDefs: Array<Omit<PromptRun, "tokens" | "layers"> & { prompt: string }> = [
  {
    id: "factual",
    title: "Factual Recall",
    prompt: "The capital of France is",
    model: "gpt2-small / normalized demo",
    source: "Neuronpedia-style layer-token sample",
    expectedNextToken: " Paris",
    finalPredictions: [
      { token: " Paris", probability: 0.42 },
      { token: " Lyon", probability: 0.11 },
      { token: " the", probability: 0.08 }
    ]
  },
  {
    id: "induction",
    title: "Induction Pattern",
    prompt: "A B C A B",
    model: "gpt2-small / normalized demo",
    source: "Attention-head sample",
    expectedNextToken: " C",
    finalPredictions: [
      { token: " C", probability: 0.49 },
      { token: " A", probability: 0.14 },
      { token: " D", probability: 0.09 }
    ]
  },
  {
    id: "code",
    title: "Code Completion",
    prompt: "def fibonacci(n): return",
    model: "gpt2-small / normalized demo",
    source: "SAE feature sample",
    expectedNextToken: " fibonacci",
    finalPredictions: [
      { token: " n", probability: 0.28 },
      { token: " fibonacci", probability: 0.18 },
      { token: " 1", probability: 0.12 }
    ]
  },
  {
    id: "ambiguity",
    title: "Ambiguous Context",
    prompt: "The bank was near the",
    model: "gpt2-small / normalized demo",
    source: "Residual stream sample",
    expectedNextToken: " river",
    finalPredictions: [
      { token: " river", probability: 0.31 },
      { token: " city", probability: 0.16 },
      { token: " road", probability: 0.1 }
    ]
  },
  {
    id: "safety",
    title: "Instruction Boundary",
    prompt: "Explain why this request should be refused:",
    model: "gpt2-small / normalized demo",
    source: "Policy-feature sample",
    expectedNextToken: " I",
    finalPredictions: [
      { token: " I", probability: 0.21 },
      { token: " This", probability: 0.19 },
      { token: " The", probability: 0.09 }
    ]
  }
];

const samplePrompts = Object.fromEntries(
  promptDefs.map((prompt) => [prompt.id, { tokens: tokenize(prompt.prompt) }])
) as Record<PromptKind, { tokens: Token[] }>;

export const promptRuns: PromptRun[] = promptDefs.map((prompt) => {
  const tokens = tokenize(prompt.prompt);
  return {
    ...prompt,
    tokens,
    layers: buildLayers(prompt.id, tokens.length)
  };
});

export function metricValue(layer: LayerState, tokenIndex: number, metric: MetricMode) {
  if (metric === "attribution") return layer.attribution[tokenIndex] ?? 0;
  if (metric === "logit") return layer.logitConfidence[tokenIndex] ?? 0;
  return layer.residualNorm[tokenIndex] ?? 0;
}

export type MetricMode = "residual" | "attribution" | "logit";
