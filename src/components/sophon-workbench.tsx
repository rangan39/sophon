"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import {
  Activity,
  Braces,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Eye,
  Network,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS, runPrompt } from "@/lib/interp-client";
import { LayerState, MetricMode, PromptRun, metricValue } from "@/lib/prompt-run";
import { cn } from "@/lib/utils";

type Selection = {
  layer: number;
  token: number;
};

type DetailMode = "prediction" | "feature" | "attention";

const cellFootprint = 0.48;

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

function lerpColor(low: string, high: string, value: number) {
  const color = new THREE.Color(low).lerp(new THREE.Color(high), Math.max(0, Math.min(1, value)));
  return `#${color.getHexString()}`;
}

function getCellPosition(layerIndex: number, tokenIndex: number, tokenCount: number, layerCount: number) {
  const x = tokenIndex - (tokenCount - 1) / 2;
  const z = layerIndex - (layerCount - 1) / 2;
  return [x * 0.95, z * 0.55] as const;
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
  const [x, z] = getCellPosition(layer.layer, tokenIndex, run.tokens.length, run.layers.length);
  const height = 0.08 + value * 0.72;
  const color = lerpColor(metricColors[metric].low, metricColors[metric].high, value);

  return (
    <group position={[x, height / 2, z]}>
      <mesh onClick={onSelect}>
        <boxGeometry args={[cellFootprint, height, cellFootprint]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.42 : 0.12 + value * 0.18}
          roughness={0.42}
          metalness={0.08}
        />
      </mesh>
      {selected ? (
        <mesh position={[0, height / 2 + 0.035, 0]}>
          <boxGeometry args={[cellFootprint + 0.08, 0.045, cellFootprint + 0.08]} />
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
        const [fromX, layerZ] = getCellPosition(layer.layer, edge.from, run.tokens.length, run.layers.length);
        const [toX] = getCellPosition(layer.layer, edge.to, run.tokens.length, run.layers.length);
        const midX = (fromX + toX) / 2;
        const lift = 1.05 + Math.abs(fromX - toX) * 0.18 + edge.weight * 0.85;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(fromX, 0.95, layerZ),
          new THREE.Vector3(midX, 0.95 + lift, layerZ),
          new THREE.Vector3(toX, 0.95, layerZ)
        );
        const points = curve.getPoints(36);

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

function SceneAxes({ run }: { run: PromptRun }) {
  const tokenCount = run.tokens.length;
  const layerCount = run.layers.length;
  const [minX, minZ] = getCellPosition(0, 0, tokenCount, layerCount);
  const [maxX, maxZ] = getCellPosition(layerCount - 1, tokenCount - 1, tokenCount, layerCount);
  const axisY = 0.02;
  const originX = minX - 0.58;
  const originZ = minZ - 0.48;
  const signalTicks = [0, 0.5, 1];

  return (
    <group>
      <Line
        points={[
          [originX, axisY, originZ],
          [maxX + 0.55, axisY, originZ]
        ]}
        color="#6f6860"
        lineWidth={1}
      />
      <Line
        points={[
          [originX, axisY, originZ],
          [originX, axisY, maxZ + 0.36]
        ]}
        color="#6f6860"
        lineWidth={1}
      />
      <Line
        points={[
          [originX, 0.08, originZ],
          [originX, 0.8, originZ]
        ]}
        color="#f7f1df"
        lineWidth={1}
      />
      {run.layers.map((layer) => {
        const [, z] = getCellPosition(layer.layer, 0, tokenCount, layerCount);
        return (
          <Line
            key={`layer-tick-${layer.layer}`}
            points={[
              [originX - 0.07, axisY, z],
              [originX + 0.07, axisY, z]
            ]}
            color="#6f6860"
            lineWidth={1}
          />
        );
      })}
      {run.tokens.map((token) => {
        const [x] = getCellPosition(0, token.index, tokenCount, layerCount);
        return (
          <Line
            key={`token-tick-${token.index}`}
            points={[
              [x, axisY, originZ - 0.07],
              [x, axisY, originZ + 0.07]
            ]}
            color="#6f6860"
            lineWidth={1}
          />
        );
      })}
      {signalTicks.map((tick) => {
        const y = 0.08 + tick * 0.72;
        return (
          <group key={`signal-tick-${tick}`}>
            <Line
              points={[
                [originX - 0.08, y, originZ],
                [originX + 0.08, y, originZ]
              ]}
              color="#f7f1df"
              lineWidth={1}
            />
            <Text
              position={[originX - 0.24, y, originZ]}
              fontSize={0.12}
              color="#f7f1df"
              anchorX="right"
              anchorY="middle"
            >
              {tick.toFixed(1)}
            </Text>
          </group>
        );
      })}
      <Text
        position={[(minX + maxX) / 2, axisY, originZ - 0.36]}
        fontSize={0.15}
        color="#d8d2c4"
        anchorX="center"
        anchorY="middle"
      >
        Tokens
      </Text>
      <Text
        position={[originX - 0.32, axisY, (minZ + maxZ) / 2]}
        fontSize={0.15}
        color="#d8d2c4"
        anchorX="center"
        anchorY="middle"
      >
        Layers
      </Text>
      <Text
        position={[originX - 0.3, 0.94, originZ]}
        fontSize={0.13}
        color="#f7f1df"
        anchorX="right"
        anchorY="middle"
      >
        Signal
      </Text>
    </group>
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
    <Canvas camera={{ position: [0, 4.7, 7.1], fov: 42 }} dpr={[1, 2]}>
      <color attach="background" args={["#11100f"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, -6, 8]} intensity={1.4} />
      <pointLight position={[-5, 3, 7]} intensity={1.2} color="#5ee0ff" />
      <group>
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
        <SceneAxes run={run} />
        {run.tokens.map((token) => {
          const [x] = getCellPosition(0, token.index, run.tokens.length, run.layers.length);
          const [, minZ] = getCellPosition(0, 0, run.tokens.length, run.layers.length);
          return (
            <Text
              key={token.index}
              position={[x, 0.08, minZ - 0.36]}
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
      <SceneControls />
    </Canvas>
  );
}

function SceneControls() {
  const { camera, size } = useThree();
  const isNarrow = size.width < 520;
  const isCompact = size.width < 900;
  const target = isNarrow ? [0.15, 0.48, 0] : [0, 0.52, 0];

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    if (isNarrow) {
      perspective.position.set(0.1, 5.8, 9.6);
      perspective.fov = 52;
    } else if (isCompact) {
      perspective.position.set(0.05, 5.2, 8.6);
      perspective.fov = 48;
    } else {
      perspective.position.set(0, 4.7, 7.1);
      perspective.fov = 42;
    }
    perspective.updateProjectionMatrix();
  }, [camera, isCompact, isNarrow]);

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxDistance={isNarrow ? 18 : 14}
      minDistance={isNarrow ? 4 : 3.2}
      target={target as [number, number, number]}
    />
  );
}

export function SophonWorkbench() {
  const [currentRun, setCurrentRun] = useState<PromptRun | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [metric, setMetric] = useState<MetricMode>("residual");
  const [showAttention, setShowAttention] = useState(true);
  const [selectedHead, setSelectedHead] = useState<number | "all">("all");
  const [selection, setSelection] = useState<Selection>({ layer: 0, token: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>("prediction");

  const run = currentRun;
  const selectedLayer = run ? run.layers[Math.min(selection.layer, run.layers.length - 1)] : null;
  const selectedToken = run ? run.tokens[Math.min(selection.token, run.tokens.length - 1)] : null;
  const feature = selectedLayer && selectedToken ? selectedLayer.topFeature[selectedToken.index] ?? {
    id: "n/a",
    activation: 0,
    label: "SAE unavailable"
  } : null;
  const value = selectedLayer && selectedToken ? metricValue(selectedLayer, selectedToken.index, metric) : 0;
  const promptCharsRemaining = MAX_PROMPT_CHARS - promptInput.length;
  const canRun = promptInput.trim().length > 0 && !isRunning;
  const statusLabel = run ? "Live TransformerLens run" : "Awaiting TransformerLens run";

  async function executeRun() {
    if (!canRun) return;

    setIsRunning(true);
    setRunMessage(null);

    const result = await runPrompt(promptInput.trim());

    if (result.ok) {
      setCurrentRun(result.run);
      setSelectedHead("all");
      setSelection({
        layer: Math.min(8, result.run.layers.length - 1),
        token: Math.max(0, result.run.tokens.length - 1)
      });
    } else if (result.code === "PROMPT_TOO_LONG" && result.tokenCount && result.maxTokens) {
      setRunMessage(`This prompt is ${result.tokenCount} tokens. Keep it under ${result.maxTokens} tokens.`);
    } else {
      setRunMessage(result.message);
    }

    setIsRunning(false);
  }

  const detailTabs: Array<{ value: DetailMode; label: string; icon: typeof Eye }> = [
    { value: "prediction", label: "Prediction", icon: Sparkles },
    { value: "feature", label: "Feature", icon: Braces },
    { value: "attention", label: "Attention", icon: Network }
  ];

  const controlPanel = (
    <div className="flex flex-col p-4">
      <div className="flex min-h-12 items-center gap-3 pb-4 max-[1024px]:hidden">
        <BrainCircuit className="size-7 text-primary" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal">Sophon</h1>
          <p className="text-xs text-muted-foreground">Mech-interp prompt workbench</p>
        </div>
      </div>

      <div className="rounded-lg border bg-background/45">
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              <span className="text-xs font-semibold uppercase text-muted-foreground">Controls</span>
            </div>
            <Badge variant="outline">{metricLabels[metric]}</Badge>
          </div>

          <ToggleGroup
            className="grid grid-cols-3 gap-1"
            onValueChange={(nextMetric) => {
              if (nextMetric) setMetric(nextMetric as MetricMode);
            }}
            type="single"
            value={metric}
          >
            <ToggleGroupItem className="h-9 px-2" title="Residual stream signal" value="residual">
              <Activity className="size-4" />
              <span className="text-xs">Res</span>
            </ToggleGroupItem>
            <ToggleGroupItem className="h-9 px-2" title="Attribution signal" value="attribution">
              <Network className="size-4" />
              <span className="text-xs">Attr</span>
            </ToggleGroupItem>
            <ToggleGroupItem className="h-9 px-2" title="Logit lens confidence" value="logit">
              <Eye className="size-4" />
              <span className="text-xs">Logit</span>
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-card/45 px-3 py-2">
              <Label htmlFor="attention-arcs" className="text-xs text-muted-foreground">
                Arcs
              </Label>
              <Switch id="attention-arcs" checked={showAttention} onCheckedChange={setShowAttention} />
            </div>
            <Select
              onValueChange={(value) => setSelectedHead(value === "all" ? "all" : Number(value))}
              value={String(selectedHead)}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {Array.from({ length: 12 }, (_, index) => (
                  <SelectItem value={String(index)} key={index}>
                    H{index}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="p-3">
          {run && selectedLayer && selectedToken && feature ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                <div className="min-w-0 rounded-md border bg-card/45 px-3 py-2">
                  <span className="text-[10px] uppercase text-muted-foreground">Selected token</span>
                  <strong className="block truncate text-base">{selectedToken.text.trim() || "space"}</strong>
                </div>
                <div className="rounded-md border bg-card/45 px-3 py-2 text-right">
                  <span className="text-[10px] uppercase text-muted-foreground">Layer</span>
                  <strong className="block text-base">{selectedLayer.layer}</strong>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border bg-card/45 px-3 py-2">
                  <span className="block text-muted-foreground">{metricLabels[metric]}</span>
                  <strong>{value.toFixed(3)}</strong>
                </div>
                <div className="rounded-md border bg-card/45 px-3 py-2">
                  <span className="block text-muted-foreground">Feature</span>
                  <strong className="block truncate">{feature.id}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-card/45 px-3 py-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Context</span>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Run a prompt to inspect tokens, layers, attention heads, and features.</p>
            </div>
          )}
        </div>

        <Separator />

        <div className="p-3">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted/30 p-1">
            {detailTabs.map((tab) => {
              const Icon = tab.icon;
              const selected = detailMode === tab.value;
              return (
                <button
                  aria-pressed={detailMode === tab.value}
                  className={cn(
                    "inline-flex h-8 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  key={tab.value}
                  onClick={(event) => {
                    setDetailMode(tab.value);
                    event.currentTarget.blur();
                  }}
                  type="button"
                >
                  <Icon className="size-3.5" />
                  <span className="max-[420px]:sr-only">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 min-h-[220px] rounded-md border bg-card/35 p-3">
            {run && selectedLayer && selectedToken && feature ? (
              <>
                {detailMode === "prediction" ? (
                  <div className="space-y-3">
                    <div className="min-w-0">
                      <span className="text-xs uppercase text-muted-foreground">Prompt</span>
                      <p className="mt-1 line-clamp-3 text-sm leading-6">{run.prompt}</p>
                    </div>
                    <Separator />
                    <div className="grid gap-3">
                      {run.finalPredictions.map((prediction) => (
                        <div className="grid grid-cols-[58px_minmax(0,1fr)_34px] items-center gap-2 text-xs" key={prediction.token}>
                          <span className="truncate">{prediction.token}</span>
                          <Progress value={prediction.probability * 100} />
                          <strong className="text-right">{Math.round(prediction.probability * 100)}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {detailMode === "feature" ? (
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs uppercase text-muted-foreground">Top SAE feature</span>
                      <strong className="mt-1 block text-sm">{feature.label}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border bg-background/60 px-3 py-2">
                        <span className="block text-muted-foreground">Activation</span>
                        <strong>{feature.activation}</strong>
                      </div>
                      <div className="min-w-0 rounded-md border bg-background/60 px-3 py-2">
                        <span className="block text-muted-foreground">Feature ID</span>
                        <strong className="block truncate">{feature.id}</strong>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      SAE feature labels are placeholders until the live path is connected to SAE data.
                    </p>
                  </div>
                ) : null}

                {detailMode === "attention" ? (
                  <div className="grid gap-2">
                    {selectedLayer.attention.slice(0, 6).map((edge, index) => (
                      <Button
                        className={cn(
                          "grid h-auto w-full grid-cols-[34px_minmax(0,1fr)_36px] justify-normal gap-2 px-3 py-2 text-left",
                          selectedHead === edge.head && "border-primary bg-primary/15 text-primary"
                        )}
                        key={`${edge.head}-${edge.from}-${edge.to}-${index}`}
                        onClick={() => setSelectedHead(edge.head)}
                        type="button"
                        variant="outline"
                      >
                        <span className="text-xs">H{edge.head}</span>
                        <strong className="truncate text-xs font-semibold">
                          {run.tokens[edge.from]?.text.trim() || "space"} {"->"} {run.tokens[edge.to]?.text.trim() || "space"}
                        </strong>
                        <em className="text-right text-xs not-italic text-primary">{edge.weight.toFixed(2)}</em>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center text-center text-muted-foreground">
                <Eye className="mb-3 size-5 text-primary" />
                <p className="text-sm leading-6">Details appear after a real model run.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className={cn(
      "grid h-svh overflow-hidden bg-background text-foreground",
      "grid-cols-[380px_minmax(0,1fr)]",
      controlsOpen
        ? "max-[1024px]:grid-cols-1 max-[1024px]:grid-rows-[minmax(0,1fr)_minmax(260px,42svh)]"
        : "max-[1024px]:grid-cols-1 max-[1024px]:grid-rows-[minmax(0,1fr)_76px]"
    )}>
      <aside className="order-1 min-h-0 min-w-0 overflow-hidden border-r bg-card/45 max-[1024px]:order-2 max-[1024px]:border-r-0 max-[1024px]:border-t">
        <div className="hidden h-[76px] items-center justify-between gap-3 px-4 max-[1024px]:flex">
          <div className="flex min-w-0 items-center gap-3">
            <BrainCircuit className="size-6 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold">Sophon</h1>
                <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                  {metricLabels[metric]}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {run ? `${run.tokens.length} tokens · layer ${selection.layer}` : "Controls and inspector"}
              </p>
            </div>
          </div>
          <Button
            aria-expanded={controlsOpen}
            className="shrink-0"
            onClick={() => setControlsOpen((open) => !open)}
            type="button"
            variant="outline"
          >
            <SlidersHorizontal className="size-4" />
            <span>Controls</span>
            {controlsOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
        <ScrollArea className={cn("h-full max-[1024px]:h-[calc(100%-76px)]", !controlsOpen && "max-[1024px]:hidden")}>
          {controlPanel}
        </ScrollArea>
      </aside>

      <section className="order-2 grid min-h-0 min-w-0 grid-rows-[82px_minmax(0,1fr)_auto_auto] bg-background max-[1024px]:order-1 max-[760px]:grid-rows-[64px_minmax(0,1fr)_auto_auto]">
        <header className="flex items-center justify-between gap-4 border-b px-5 py-4 max-[760px]:px-4 max-[760px]:py-3">
          <div className="min-w-0">
            <p className="mb-1 truncate text-xs uppercase text-muted-foreground">{run?.model ?? "gpt2-small / TransformerLens"}</p>
            <h2 className="truncate text-2xl font-semibold max-[760px]:text-lg">{run?.title ?? "Run a prompt"}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground max-[760px]:hidden">{statusLabel}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={!run}
              onClick={() => setSelection({ layer: 0, token: 0 })}
              size="icon"
              title="Reset selection"
              type="button"
              variant="outline"
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button className="max-[520px]:px-3" disabled={!canRun} onClick={executeRun} type="button">
              <Play className="size-4" />
              <span className="max-[520px]:sr-only">{isRunning ? "Running" : "Run"}</span>
            </Button>
          </div>
        </header>

        <div className="min-h-0">
          {run ? (
            <LayerScene
              run={run}
              metric={metric}
              selection={selection}
              setSelection={setSelection}
              showAttention={showAttention}
              selectedHead={selectedHead}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-7 text-center text-muted-foreground">
              <BrainCircuit className="size-11 text-primary" />
              <h2 className="mt-4 text-xl font-semibold text-foreground">No model run loaded</h2>
              <p className="mt-2 max-w-sm text-sm leading-6">
                Enter a short prompt and run the local or hosted TransformerLens service.
              </p>
            </div>
          )}
        </div>

        <div className="border-t bg-background/95 px-5 py-3 max-[760px]:px-3 max-[760px]:py-2">
          <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-card/70 p-2 shadow-2xl shadow-black/20 max-[520px]:rounded-xl">
            <div className="flex items-end gap-2">
              <Textarea
                className="min-h-12 resize-none border-0 bg-transparent px-3 py-3 shadow-none focus-visible:ring-0 max-[520px]:min-h-10 max-[520px]:py-2"
                maxLength={MAX_PROMPT_CHARS}
                onChange={(event) => setPromptInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void executeRun();
                  }
                }}
                placeholder="Run a prompt through the interpretability view"
                rows={1}
                value={promptInput}
              />
              <Button className="mb-1 size-10 shrink-0 rounded-full" disabled={!canRun} onClick={executeRun} size="icon" type="button">
                <Play className="size-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 pb-1 text-[11px] text-muted-foreground max-[520px]:pt-1 max-[520px]:text-[10px]">
              <span className="truncate">{isRunning ? "Running TransformerLens" : "Enter to run"}</span>
              <span className="shrink-0">
                {promptCharsRemaining} chars left · {MAX_PROMPT_TOKENS} token cap
              </span>
            </div>
            {runMessage ? (
              <div className="border-t px-3 py-2 text-xs leading-5 text-primary">{runMessage}</div>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center gap-2 overflow-x-auto border-t bg-card/45 px-5 py-3 max-[760px]:px-3 max-[760px]:py-2">
          {run ? (
            run.tokens.map((token) => (
              <Button
                className={cn("min-w-14 shrink-0", selection.token === token.index && "border-primary bg-primary/15 text-primary")}
                key={token.index}
                onClick={() => setSelection({ ...selection, token: token.index })}
                type="button"
                variant="outline"
              >
                {token.text.trim() || "space"}
              </Button>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Tokens appear after a real model run.</span>
          )}
        </footer>
      </section>
    </main>
  );
}
