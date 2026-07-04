"use client";

import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import {
  Activity,
  Braces,
  BrainCircuit,
  Eye,
  Network,
  Play,
  RotateCcw,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import * as THREE from "three";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        const lift = 0.7 + Math.abs(fromX - toX) * 0.14 + edge.weight * 0.7;
        const points: [number, number, number][] = [
          [fromX, 0.95, layerZ],
          [midX, 0.95 + lift, layerZ],
          [toX, 0.95, layerZ]
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
    <Canvas camera={{ position: [0, 5.6, 8.4], fov: 48 }} dpr={[1, 2]}>
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
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxDistance={18}
        minDistance={4}
        target={[0, 0.45, 0]}
      />
    </Canvas>
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

  return (
    <main className="grid h-svh grid-cols-[300px_minmax(0,1fr)_340px] overflow-hidden bg-background text-foreground max-[1100px]:grid-cols-[260px_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
      <aside className="min-w-0 border-r bg-card/45 max-[760px]:max-h-[38vh] max-[760px]:border-b max-[760px]:border-r-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4">
            <div className="flex min-h-14 items-center gap-3">
              <BrainCircuit className="size-7 text-primary" />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-normal">Sophon</h1>
                <p className="text-xs text-muted-foreground">Mech-interp prompt workbench</p>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 uppercase">
                  <Braces className="size-4 text-primary" />
                  Run Prompt
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  maxLength={MAX_PROMPT_CHARS}
                  onChange={(event) => setPromptInput(event.target.value)}
                  value={promptInput}
                />
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{promptCharsRemaining} chars left</span>
                  <Badge variant="secondary">{MAX_PROMPT_TOKENS} token cap</Badge>
                </div>
                {runMessage ? (
                  <div className="border-l-2 border-primary pl-3 text-xs leading-5 text-primary">{runMessage}</div>
                ) : null}
                <Button className="w-full" disabled={!canRun} onClick={executeRun} type="button">
                  <Play className="size-4" />
                  <span>{isRunning ? "Running" : "Run real model"}</span>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 uppercase">
                  <Sparkles className="size-4 text-primary" />
                  Signal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleGroup
                  className="grid grid-cols-1"
                  onValueChange={(nextMetric) => {
                    if (nextMetric) setMetric(nextMetric as MetricMode);
                  }}
                  type="single"
                  value={metric}
                >
                  <ToggleGroupItem className="justify-start" value="residual">
                    <Activity className="size-4" />
                    Residual
                  </ToggleGroupItem>
                  <ToggleGroupItem className="justify-start" value="attribution">
                    <Network className="size-4" />
                    Attribution
                  </ToggleGroupItem>
                  <ToggleGroupItem className="justify-start" value="logit">
                    <Eye className="size-4" />
                    Logit lens
                  </ToggleGroupItem>
                </ToggleGroup>

                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="attention-arcs" className="text-muted-foreground">
                    Attention arcs
                  </Label>
                  <Switch id="attention-arcs" checked={showAttention} onCheckedChange={setShowAttention} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label className="text-muted-foreground">Head</Label>
                  <Select
                    onValueChange={(value) => setSelectedHead(value === "all" ? "all" : Number(value))}
                    value={String(selectedHead)}
                  >
                    <SelectTrigger className="w-24">
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
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </aside>

      <section className="grid min-w-0 grid-rows-[92px_minmax(0,1fr)_74px] bg-background max-[760px]:grid-rows-[82px_minmax(0,1fr)_66px]">
        <header className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="mb-1 text-xs uppercase text-muted-foreground">{run?.model ?? "gpt2-small / TransformerLens"}</p>
            <h2 className="truncate text-2xl font-semibold max-[760px]:text-lg">{run?.title ?? "Run a prompt"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{statusLabel}</p>
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
            <Button disabled={!canRun} onClick={executeRun} type="button">
              <Play className="size-4" />
              <span>{isRunning ? "Running" : "Run"}</span>
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

        <footer className="flex items-center gap-2 overflow-x-auto border-t bg-card/45 px-5 py-3">
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

      <aside className="min-w-0 border-l bg-card/45 max-[1100px]:hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4">
            {run && selectedLayer && selectedToken && feature ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 uppercase">
                      <Braces className="size-4 text-primary" />
                      Prompt
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-base leading-7 text-foreground">{run.prompt}</p>
                    <div className="grid gap-3">
                      {run.finalPredictions.map((prediction) => (
                        <div className="grid grid-cols-[74px_minmax(0,1fr)_42px] items-center gap-3 text-sm" key={prediction.token}>
                          <span className="truncate">{prediction.token}</span>
                          <Progress value={prediction.probability * 100} />
                          <strong className="text-right text-xs">{Math.round(prediction.probability * 100)}%</strong>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 uppercase">
                      <Eye className="size-4 text-primary" />
                      Selection
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid grid-cols-2 gap-3">
                      <div className="min-w-0 rounded-md border bg-background/60 p-3">
                        <dt className="mb-1 text-xs uppercase text-muted-foreground">Layer</dt>
                        <dd className="truncate text-sm">{selectedLayer.layer}</dd>
                      </div>
                      <div className="min-w-0 rounded-md border bg-background/60 p-3">
                        <dt className="mb-1 text-xs uppercase text-muted-foreground">Token</dt>
                        <dd className="truncate text-sm">{selectedToken.text.trim() || "space"}</dd>
                      </div>
                      <div className="min-w-0 rounded-md border bg-background/60 p-3">
                        <dt className="mb-1 text-xs uppercase text-muted-foreground">{metricLabels[metric]}</dt>
                        <dd className="truncate text-sm">{value.toFixed(3)}</dd>
                      </div>
                      <div className="min-w-0 rounded-md border bg-background/60 p-3">
                        <dt className="mb-1 text-xs uppercase text-muted-foreground">Feature</dt>
                        <dd className="truncate text-sm">{feature.id}</dd>
                      </div>
                    </dl>
                    <div className="border-l-2 border-primary pl-3">
                      <span className="text-xs text-muted-foreground">Top SAE feature</span>
                      <strong className="my-1 block text-sm">{feature.label}</strong>
                      <p className="text-xs text-muted-foreground">Activation {feature.activation}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 uppercase">
                      <Network className="size-4 text-primary" />
                      Selected Layer Heads
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2">
                      {selectedLayer.attention.slice(0, 6).map((edge, index) => (
                        <Button
                          className={cn(
                            "grid h-auto w-full grid-cols-[38px_minmax(0,1fr)_40px] justify-normal gap-2 px-3 py-2 text-left",
                            selectedHead === edge.head && "border-primary bg-primary/15 text-primary"
                          )}
                          key={`${edge.head}-${edge.from}-${edge.to}-${index}`}
                          onClick={() => setSelectedHead(edge.head)}
                          type="button"
                          variant="outline"
                        >
                          <span>H{edge.head}</span>
                          <strong className="truncate text-xs font-semibold">
                            {run.tokens[edge.from]?.text.trim() || "space"} {"->"} {run.tokens[edge.to]?.text.trim() || "space"}
                          </strong>
                          <em className="text-right text-xs not-italic text-primary">{edge.weight.toFixed(2)}</em>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 uppercase">
                    <Eye className="size-4 text-primary" />
                    Inspector
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">No TransformerLens run is loaded.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </aside>
    </main>
  );
}
