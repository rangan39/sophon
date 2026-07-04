"use client";

import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import {
  Activity,
  Braces,
  BrainCircuit,
  CircleHelp,
  Eye,
  Layers3,
  Network,
  Play,
  RotateCcw,
  Sparkles
} from "lucide-react";
import { useMemo, useState } from "react";
import * as THREE from "three";
import {
  LayerState,
  MetricMode,
  PromptKind,
  PromptRun,
  metricValue,
  promptRuns
} from "@/lib/sample-data";

type Selection = {
  layer: number;
  token: number;
};

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

const metricColors: Record<MetricMode, { low: string; high: string }> = {
  residual: { low: "#2b3440", high: "#4dd7ff" },
  attribution: { low: "#332b3f", high: "#ff6fb1" },
  logit: { low: "#343021", high: "#ffcc4d" }
};

const promptHelp: Record<PromptKind, string> = {
  factual: "Shows how a model retrieves a known association, such as France leading toward Paris.",
  induction: "Shows repeated-pattern completion, the classic setup for studying induction heads.",
  code: "Shows syntax and structure tracking across code tokens like def, return, and punctuation.",
  ambiguity: "Shows how surrounding context can resolve a token with multiple possible meanings.",
  safety: "Shows instruction-boundary framing and how refusal-like context can become salient."
};

function lerpColor(low: string, high: string, value: number) {
  const color = new THREE.Color(low).lerp(new THREE.Color(high), Math.max(0, Math.min(1, value)));
  return `#${color.getHexString()}`;
}

function getCellPosition(layerIndex: number, tokenIndex: number, tokenCount: number, layerCount: number) {
  const x = tokenIndex - (tokenCount - 1) / 2;
  const y = layerIndex - (layerCount - 1) / 2;
  return [x * 0.95, y * 0.55, 0] as const;
}

function ActivationCell({
  layer,
  tokenIndex,
  run,
  metric,
  selected,
  onSelect
}: {
  layer: LayerState;
  tokenIndex: number;
  run: PromptRun;
  metric: MetricMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const value = metricValue(layer, tokenIndex, metric);
  const [x, y, z] = getCellPosition(layer.layer, tokenIndex, run.tokens.length, run.layers.length);
  const height = 0.08 + value * 0.72;
  const color = lerpColor(metricColors[metric].low, metricColors[metric].high, value);

  return (
    <group position={[x, y, z + height / 2]}>
      <mesh onClick={onSelect}>
        <boxGeometry args={[0.66, 0.34, height]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.42 : 0.12 + value * 0.18}
          roughness={0.42}
          metalness={0.08}
        />
      </mesh>
      {selected ? (
        <mesh position={[0, 0, height / 2 + 0.035]}>
          <boxGeometry args={[0.74, 0.42, 0.045]} />
          <meshStandardMaterial color="#f7f1df" emissive="#f7f1df" emissiveIntensity={0.25} />
        </mesh>
      ) : null}
    </group>
  );
}

function AttentionArcs({
  run,
  layer,
  selectedHead
}: {
  run: PromptRun;
  layer: LayerState;
  selectedHead: number | "all";
}) {
  const edges = layer.attention.filter((edge) => selectedHead === "all" || edge.head === selectedHead);

  return (
    <>
      {edges.map((edge, index) => {
        const [fromX, fromY] = getCellPosition(layer.layer, edge.from, run.tokens.length, run.layers.length);
        const [toX, toY] = getCellPosition(layer.layer, edge.to, run.tokens.length, run.layers.length);
        const midX = (fromX + toX) / 2;
        const lift = 0.7 + Math.abs(fromX - toX) * 0.14 + edge.weight * 0.7;
        const points: [number, number, number][] = [
          [fromX, fromY, 0.95],
          [midX, fromY + lift, 1.45],
          [toX, toY, 0.95]
        ];
        return (
          <Line
            key={`${edge.from}-${edge.to}-${edge.head}-${index}`}
            points={points}
            color={lerpColor("#f6a04d", "#f04f7f", edge.weight)}
            lineWidth={1 + edge.weight * 3}
            transparent
            opacity={0.36 + edge.weight * 0.5}
          />
        );
      })}
    </>
  );
}

function LayerScene({
  run,
  metric,
  selection,
  setSelection,
  showAttention,
  selectedHead
}: {
  run: PromptRun;
  metric: MetricMode;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  showAttention: boolean;
  selectedHead: number | "all";
}) {
  const selectedLayer = run.layers[selection.layer] ?? run.layers[0];

  return (
    <Canvas camera={{ position: [0, -8, 8.5], fov: 48 }} dpr={[1, 2]}>
      <color attach="background" args={["#11100f"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, -6, 8]} intensity={1.4} />
      <pointLight position={[-5, 3, 7]} intensity={1.2} color="#5ee0ff" />
      <group rotation={[-0.62, 0, 0]}>
        {run.layers.map((layer) =>
          run.tokens.map((token) => (
            <ActivationCell
              key={`${layer.layer}-${token.index}`}
              layer={layer}
              tokenIndex={token.index}
              run={run}
              metric={metric}
              selected={selection.layer === layer.layer && selection.token === token.index}
              onSelect={() => setSelection({ layer: layer.layer, token: token.index })}
            />
          ))
        )}
        {showAttention ? <AttentionArcs run={run} layer={selectedLayer} selectedHead={selectedHead} /> : null}
        {run.tokens.map((token) => {
          const [x] = getCellPosition(0, token.index, run.tokens.length, run.layers.length);
          return (
            <Text
              key={token.index}
              position={[x, -run.layers.length * 0.31 - 0.35, 0.08]}
              rotation={[0, 0, 0]}
              fontSize={0.16}
              color="#d8d2c4"
              anchorX="center"
              anchorY="middle"
              maxWidth={0.85}
            >
              {token.text.trim() || "space"}
            </Text>
          );
        })}
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxDistance={18}
        minDistance={4}
        target={[0, 0, 0.5]}
      />
    </Canvas>
  );
}

function MetricToggle({
  metric,
  current,
  onClick
}: {
  metric: MetricMode;
  current: MetricMode;
  onClick: () => void;
}) {
  return (
    <button className={current === metric ? "segmented active" : "segmented"} onClick={onClick} type="button">
      {metric === "residual" ? <Activity size={16} /> : metric === "attribution" ? <Network size={16} /> : <Eye size={16} />}
      <span>{metricLabels[metric]}</span>
    </button>
  );
}

function PromptButton({
  run,
  active,
  onClick
}: {
  run: PromptRun;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "prompt-button active" : "prompt-button"} type="button" onClick={onClick}>
      <span className="prompt-title-row">
        <span className="prompt-title">{run.title}</span>
        <span className="help-anchor" aria-label={`${run.title} help`}>
          <CircleHelp size={15} aria-hidden="true" />
          <span className="tooltip" role="tooltip">
            {promptHelp[run.id]}
          </span>
        </span>
      </span>
      <span className="prompt-text">{run.prompt}</span>
    </button>
  );
}

export function SophonWorkbench() {
  const [promptKind, setPromptKind] = useState<PromptKind>("factual");
  const [metric, setMetric] = useState<MetricMode>("residual");
  const [showAttention, setShowAttention] = useState(true);
  const [selectedHead, setSelectedHead] = useState<number | "all">("all");
  const [selection, setSelection] = useState<Selection>({ layer: 8, token: 3 });

  const run = useMemo(() => promptRuns.find((item) => item.id === promptKind) ?? promptRuns[0], [promptKind]);
  const selectedLayer = run.layers[Math.min(selection.layer, run.layers.length - 1)];
  const selectedToken = run.tokens[Math.min(selection.token, run.tokens.length - 1)];
  const feature = selectedLayer.topFeature[selectedToken.index];
  const value = metricValue(selectedLayer, selectedToken.index, metric);

  function choosePrompt(next: PromptKind) {
    const nextRun = promptRuns.find((item) => item.id === next) ?? promptRuns[0];
    setPromptKind(next);
    setSelection({
      layer: Math.min(8, nextRun.layers.length - 1),
      token: Math.max(0, nextRun.tokens.length - 1)
    });
  }

  return (
    <main className="workbench">
      <aside className="sidebar">
        <div className="brand">
          <BrainCircuit size={26} />
          <div>
            <h1>Sophon</h1>
            <p>Mech-interp prompt workbench</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <Layers3 size={16} />
            <h2>Prompts</h2>
          </div>
          <div className="prompt-list">
            {promptRuns.map((item) => (
              <PromptButton key={item.id} run={item} active={item.id === run.id} onClick={() => choosePrompt(item.id)} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Sparkles size={16} />
            <h2>Signal</h2>
          </div>
          <div className="segmented-row">
            <MetricToggle metric="residual" current={metric} onClick={() => setMetric("residual")} />
            <MetricToggle metric="attribution" current={metric} onClick={() => setMetric("attribution")} />
            <MetricToggle metric="logit" current={metric} onClick={() => setMetric("logit")} />
          </div>
          <label className="switch-row">
            <input checked={showAttention} onChange={(event) => setShowAttention(event.target.checked)} type="checkbox" />
            <span>Attention arcs</span>
          </label>
          <label className="select-row">
            <span>Head</span>
            <select
              value={selectedHead}
              onChange={(event) => setSelectedHead(event.target.value === "all" ? "all" : Number(event.target.value))}
            >
              <option value="all">All</option>
              {Array.from({ length: 12 }, (_, index) => (
                <option value={index} key={index}>
                  H{index}
                </option>
              ))}
            </select>
          </label>
        </section>
      </aside>

      <section className="stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">{run.model}</p>
            <h2>{run.title}</h2>
          </div>
          <div className="top-actions">
            <button type="button" className="icon-button" onClick={() => setSelection({ layer: 0, token: 0 })} title="Reset selection">
              <RotateCcw size={18} />
            </button>
            <button type="button" className="run-button">
              <Play size={16} />
              <span>Demo run</span>
            </button>
          </div>
        </header>

        <div className="scene-wrap">
          <LayerScene
            run={run}
            metric={metric}
            selection={selection}
            setSelection={setSelection}
            showAttention={showAttention}
            selectedHead={selectedHead}
          />
        </div>

        <footer className="token-strip">
          {run.tokens.map((token) => (
            <button
              className={selection.token === token.index ? "token active" : "token"}
              key={token.index}
              onClick={() => setSelection({ ...selection, token: token.index })}
              type="button"
            >
              {token.text.trim() || "space"}
            </button>
          ))}
        </footer>
      </section>

      <aside className="inspector">
        <section className="panel hero-panel">
          <div className="panel-heading">
            <Braces size={16} />
            <h2>Prompt</h2>
          </div>
          <p className="prompt-display">{run.prompt}</p>
          <div className="prediction-list">
            {run.finalPredictions.map((prediction) => (
              <div className="prediction" key={prediction.token}>
                <span>{prediction.token}</span>
                <meter min={0} max={1} value={prediction.probability} />
                <strong>{Math.round(prediction.probability * 100)}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Eye size={16} />
            <h2>Selection</h2>
          </div>
          <dl className="stats">
            <div>
              <dt>Layer</dt>
              <dd>{selectedLayer.layer}</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{selectedToken.text.trim() || "space"}</dd>
            </div>
            <div>
              <dt>{metricLabels[metric]}</dt>
              <dd>{value.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Feature</dt>
              <dd>{feature.id}</dd>
            </div>
          </dl>
          <div className="feature-block">
            <span>Top SAE feature</span>
            <strong>{feature.label}</strong>
            <p>Activation {feature.activation}</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <Network size={16} />
            <h2>Selected Layer Heads</h2>
          </div>
          <div className="head-list">
            {selectedLayer.attention.slice(0, 6).map((edge, index) => (
              <button
                type="button"
                key={`${edge.head}-${edge.from}-${edge.to}-${index}`}
                onClick={() => setSelectedHead(edge.head)}
                className={selectedHead === edge.head ? "head-row active" : "head-row"}
              >
                <span>H{edge.head}</span>
                <strong>
                  {run.tokens[edge.from]?.text.trim() || "space"} {"->"} {run.tokens[edge.to]?.text.trim() || "space"}
                </strong>
                <em>{edge.weight.toFixed(2)}</em>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
