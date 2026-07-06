"use client";

import { Line, OrbitControls, Text } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { LayerState, MetricMode, PromptRun, metricValue } from "@/lib/prompt-run";
import { sophonGlassSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

export type Selection = {
  layer: number;
  token: number;
};

const cellFootprint = 0.48;

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

type ScenePalette = {
  background: string;
  ink: string;
  metal: string;
  metalSoft: string;
  orange: string;
  red: string;
  white: string;
  residualLow: string;
  attributionLow: string;
  logitLow: string;
};

const scenePalette: ScenePalette = {
  background: "#fafafa",
  ink: "#25282c",
  metal: "#4c5258",
  metalSoft: "#a6acb2",
  orange: "#ff6a00",
  red: "#d7192a",
  white: "#ffffff",
  residualLow: "#f4f5f6",
  attributionLow: "#fff1e6",
  logitLow: "#fff3f1"
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

function metricColorRange(metric: MetricMode, palette: ScenePalette) {
  return {
    residual: { low: palette.residualLow, high: palette.metal },
    attribution: { low: palette.attributionLow, high: palette.orange },
    logit: { low: palette.logitLow, high: palette.red }
  }[metric];
}

function ActivationCell({
  layer,
  tokenIndex,
  run,
  metric,
  palette,
  selected,
  onSelect
}: {
  layer: LayerState;
  tokenIndex: number;
  run: PromptRun;
  metric: MetricMode;
  palette: ScenePalette;
  selected: boolean;
  onSelect: () => void;
}) {
  const value = metricValue(layer, tokenIndex, metric);
  const [x, z] = getCellPosition(layer.layer, tokenIndex, run.tokens.length, run.layers.length);
  const height = 0.08 + value * 0.72;
  const range = metricColorRange(metric, palette);
  const color = lerpColor(range.low, range.high, value);

  return (
    <group position={[x, height / 2, z]}>
      <mesh onClick={onSelect}>
        <boxGeometry args={[cellFootprint, height, cellFootprint]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.7 : 0.18 + value * 0.3}
          roughness={0.28}
          metalness={0.18}
        />
      </mesh>
      {selected ? (
        <mesh position={[0, height / 2 + 0.035, 0]}>
          <boxGeometry args={[cellFootprint + 0.08, 0.045, cellFootprint + 0.08]} />
          <meshStandardMaterial color={palette.white} emissive={palette.orange} emissiveIntensity={0.5} />
        </mesh>
      ) : null}
    </group>
  );
}

function AttentionArcs({
  run,
  layer,
  selectedHead,
  palette
}: {
  run: PromptRun;
  layer: LayerState;
  selectedHead: number | "all";
  palette: ScenePalette;
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
            color={lerpColor(palette.orange, palette.red, edge.weight)}
            lineWidth={1.2 + edge.weight * 3.1}
            transparent
            opacity={0.34 + edge.weight * 0.54}
          />
        );
      })}
    </>
  );
}

function SceneAxes({ run, palette }: { run: PromptRun; palette: ScenePalette }) {
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
      <Line points={[[originX, axisY, originZ], [maxX + 0.55, axisY, originZ]]} color={palette.metal} lineWidth={1} />
      <Line points={[[originX, axisY, originZ], [originX, axisY, maxZ + 0.36]]} color={palette.metal} lineWidth={1} />
      <Line points={[[originX, 0.08, originZ], [originX, 0.8, originZ]]} color={palette.red} lineWidth={1} />
      {run.layers.map((layer) => {
        const [, z] = getCellPosition(layer.layer, 0, tokenCount, layerCount);
        return <Line key={`layer-tick-${layer.layer}`} points={[[originX - 0.07, axisY, z], [originX + 0.07, axisY, z]]} color={palette.metalSoft} lineWidth={1} />;
      })}
      {run.tokens.map((token) => {
        const [x] = getCellPosition(0, token.index, tokenCount, layerCount);
        return <Line key={`token-tick-${token.index}`} points={[[x, axisY, originZ - 0.07], [x, axisY, originZ + 0.07]]} color={palette.metalSoft} lineWidth={1} />;
      })}
      {signalTicks.map((tick) => {
        const y = 0.08 + tick * 0.72;
        return (
          <group key={`signal-tick-${tick}`}>
            <Line points={[[originX - 0.08, y, originZ], [originX + 0.08, y, originZ]]} color={palette.red} lineWidth={1} />
            <Text position={[originX - 0.24, y, originZ]} fontSize={0.12} color={palette.ink} anchorX="right" anchorY="middle">
              {tick.toFixed(1)}
            </Text>
          </group>
        );
      })}
      <Text position={[(minX + maxX) / 2, axisY, originZ - 0.36]} fontSize={0.15} color={palette.ink} anchorX="center" anchorY="middle">
        Tokens
      </Text>
      <Text position={[originX - 0.32, axisY, (minZ + maxZ) / 2]} fontSize={0.15} color={palette.ink} anchorX="center" anchorY="middle">
        Layers
      </Text>
      <Text position={[originX - 0.3, 0.94, originZ]} fontSize={0.13} color={palette.red} anchorX="right" anchorY="middle">
        Signal
      </Text>
    </group>
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

  return <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={isNarrow ? 18 : 14} minDistance={isNarrow ? 4 : 3.2} target={target as [number, number, number]} />;
}

export function SophonScene({
  run,
  metric,
  selection,
  setSelection,
  showAttention,
  selectedHead,
  isRunning
}: {
  run: PromptRun;
  metric: MetricMode;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  showAttention: boolean;
  selectedHead: number | "all";
  isRunning: boolean;
}) {
  const palette = scenePalette;
  const selectedLayer = run.layers[selection.layer] ?? run.layers[0];
  const selectedToken = run.tokens[selection.token] ?? run.tokens[0];
  const traceStatus = isRunning ? "Reconstructing" : "Trace locked";

  return (
    <div className={cn(sophonGridSurface, "relative h-full overflow-hidden bg-background")}>
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3 text-[11px] uppercase text-primary/85 max-[640px]:inset-x-3 max-[640px]:top-3">
        <div className={cn(sophonGlassSurface, "rounded-md border px-3 py-2")}>
          <span className="block text-[10px] text-muted-foreground">Layer trace</span>
          <strong className="mt-1 block font-medium text-foreground">{traceStatus}</strong>
        </div>
        <div className={cn(sophonGlassSurface, "flex flex-wrap justify-end gap-2 rounded-md border px-3 py-2 text-right")}>
          <span>{metricLabels[metric]}</span>
          <span className="text-muted-foreground">H{selectedHead === "all" ? "*" : selectedHead}</span>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex items-end justify-between gap-3 text-xs text-muted-foreground max-[640px]:inset-x-3 max-[640px]:bottom-3">
        <div className={cn(sophonGlassSurface, "min-w-0 rounded-md border px-3 py-2")}>
          <span className="block text-[10px] uppercase">Selected trace</span>
          <strong className="mt-1 block truncate text-sm text-foreground">
            {selectedToken?.text.trim() || "space"} / layer {selectedLayer.layer}
          </strong>
        </div>
        <div className={cn("h-2 w-24 rounded-full bg-primary/40", isRunning && "animate-pulse shadow-[0_0_24px_rgb(215_25_42/.54),0_0_38px_rgb(255_106_0/.32)]")} />
      </div>
      <Canvas camera={{ position: [0, 4.7, 7.1], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={[palette.background]} />
        <ambientLight intensity={0.86} />
        <directionalLight position={[4, -6, 8]} intensity={1.2} />
        <pointLight position={[-5, 3, 7]} intensity={1.0} color={palette.orange} />
        <pointLight position={[5, 3, -5]} intensity={0.95} color={palette.red} />
        <pointLight position={[0, 6, 0]} intensity={0.45} color={palette.residualLow} />
        <group>
          {run.layers.map((layer) =>
            run.tokens.map((token) => (
              <ActivationCell
                key={`${layer.layer}-${token.index}`}
                layer={layer}
                tokenIndex={token.index}
                run={run}
                metric={metric}
                palette={palette}
                selected={selection.layer === layer.layer && selection.token === token.index}
                onSelect={() => setSelection({ layer: layer.layer, token: token.index })}
              />
            ))
          )}
          {showAttention ? <AttentionArcs run={run} layer={selectedLayer} selectedHead={selectedHead} palette={palette} /> : null}
          <SceneAxes run={run} palette={palette} />
          {run.tokens.map((token) => {
            const [x] = getCellPosition(0, token.index, run.tokens.length, run.layers.length);
            const [, minZ] = getCellPosition(0, 0, run.tokens.length, run.layers.length);
            return (
              <Text key={token.index} position={[x, 0.08, minZ - 0.36]} fontSize={0.16} color={palette.ink} anchorX="center" anchorY="middle" maxWidth={0.85}>
                {token.text.trim() || "space"}
              </Text>
            );
          })}
        </group>
        <SceneControls />
      </Canvas>
    </div>
  );
}
