"use client";

import { Line, OrbitControls, Text } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { HelpIcon } from "@/components/help-icon";
import { displayTokenText, LayerState, MetricMode, PromptRun, metricValue } from "@/lib/prompt-run";
import type { Selection } from "@/lib/selection";
import { sophonGlassSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

const cellFootprint = 0.48;
const signalBaseY = 0;
const signalHeight = 0.8;
const tokenLabelAxisPadding = 0.22;

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

type ScenePalette = {
  background: string;
  grid: string;
  gridMajor: string;
  ink: string;
  metal: string;
  metalSoft: string;
  redSoft: string;
  red: string;
  white: string;
  residualLow: string;
  attributionLow: string;
  logitLow: string;
};

const scenePalette: ScenePalette = {
  background: "#ffffff",
  grid: "#e7eaee",
  gridMajor: "#cfd5db",
  ink: "#25282c",
  metal: "#4c5258",
  metalSoft: "#a6acb2",
  redSoft: "#ff6b7d",
  red: "#ff1f3d",
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
    attribution: { low: palette.attributionLow, high: palette.redSoft },
    logit: { low: palette.logitLow, high: palette.red }
  }[metric];
}

function signalValueHeight(value: number) {
  return Math.max(0, Math.min(1, value)) * signalHeight;
}

function MeasurementGrid({ run, palette }: { run: PromptRun; palette: ScenePalette }) {
  const tokenCount = run.tokens.length;
  const layerCount = run.layers.length;
  const [minX, minZ] = getCellPosition(0, 0, tokenCount, layerCount);
  const [maxX, maxZ] = getCellPosition(layerCount - 1, tokenCount - 1, tokenCount, layerCount);
  const gridY = signalBaseY - 0.006;
  const marginX = 0.82;
  const marginZ = 0.64;
  const left = minX - marginX;
  const right = maxX + marginX;
  const back = minZ - marginZ;
  const front = maxZ + marginZ;
  const width = right - left;
  const depth = front - back;
  const minorXCount = Math.max(1, (tokenCount - 1) * 2);
  const minorZCount = Math.max(1, (layerCount - 1) * 2);

  return (
    <group>
      <mesh position={[(left + right) / 2, gridY - 0.004, (back + front) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color={palette.white} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {Array.from({ length: minorXCount + 1 }, (_, index) => {
        const x = left + (width * index) / minorXCount;
        const isMajor = run.tokens.some((token) => {
          const [tokenX] = getCellPosition(0, token.index, tokenCount, layerCount);
          return Math.abs(tokenX - x) < 0.03;
        });

        return (
          <Line
            key={`grid-x-${index}`}
            points={[[x, gridY, back], [x, gridY, front]]}
            color={isMajor ? palette.gridMajor : palette.grid}
            lineWidth={isMajor ? 0.8 : 0.45}
            transparent
            opacity={isMajor ? 0.82 : 0.66}
          />
        );
      })}
      {Array.from({ length: minorZCount + 1 }, (_, index) => {
        const z = back + (depth * index) / minorZCount;
        const isMajor = run.layers.some((layer) => {
          const [, layerZ] = getCellPosition(layer.layer, 0, tokenCount, layerCount);
          return Math.abs(layerZ - z) < 0.03;
        });

        return (
          <Line
            key={`grid-z-${index}`}
            points={[[left, gridY, z], [right, gridY, z]]}
            color={isMajor ? palette.gridMajor : palette.grid}
            lineWidth={isMajor ? 0.8 : 0.45}
            transparent
            opacity={isMajor ? 0.82 : 0.66}
          />
        );
      })}
    </group>
  );
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
  const height = signalValueHeight(value);
  const renderHeight = Math.max(height, 0.001);
  const range = metricColorRange(metric, palette);
  const color = lerpColor(range.low, range.high, value);

  return (
    <group position={[x, signalBaseY + renderHeight / 2, z]}>
      <mesh onClick={onSelect}>
        <boxGeometry args={[cellFootprint, renderHeight, cellFootprint]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.7 : 0.18 + value * 0.3}
          roughness={0.28}
          metalness={0.18}
        />
      </mesh>
      {selected ? (
        <lineSegments position={[0, 0.04, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(cellFootprint + 0.08, renderHeight + 0.08, cellFootprint + 0.08)]} />
          <lineBasicMaterial color={palette.red} toneMapped={false} />
        </lineSegments>
      ) : null}
    </group>
  );
}

function AttentionArcs({
  run,
  layer,
  metric,
  selectedHead,
  palette
}: {
  run: PromptRun;
  layer: LayerState;
  metric: MetricMode;
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
        const fromHeight = signalValueHeight(metricValue(layer, edge.from, metric));
        const toHeight = signalValueHeight(metricValue(layer, edge.to, metric));
        const fromY = signalBaseY + fromHeight + 0.06;
        const toY = signalBaseY + toHeight + 0.06;
        const peakY = Math.max(fromY, toY) + 0.28 + Math.abs(fromX - toX) * 0.12 + edge.weight * 0.38;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(fromX, fromY, layerZ),
          new THREE.Vector3(midX, peakY, layerZ),
          new THREE.Vector3(toX, toY, layerZ)
        );
        const points = curve.getPoints(36);

        return (
          <Line
            key={`${edge.from}-${edge.to}-${edge.head}-${index}`}
            points={points}
            color={lerpColor(palette.redSoft, palette.red, edge.weight)}
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
  const axisY = signalBaseY;
  const originX = minX - 0.58;
  const frontZ = maxZ + 0.48;
  const backZ = minZ - 0.36;
  const signalTicks = [0, 0.5, 1];

  return (
    <group>
      <Line points={[[originX, axisY, frontZ], [maxX + 0.55, axisY, frontZ]]} color={palette.metal} lineWidth={1} />
      <Line points={[[originX, axisY, backZ], [originX, axisY, frontZ]]} color={palette.metal} lineWidth={1} />
      <Line points={[[originX, axisY, frontZ], [originX, signalBaseY + signalHeight, frontZ]]} color={palette.red} lineWidth={1} />
      {run.layers.map((layer) => {
        const [, z] = getCellPosition(layer.layer, 0, tokenCount, layerCount);
        return <Line key={`layer-tick-${layer.layer}`} points={[[originX - 0.07, axisY, z], [originX + 0.07, axisY, z]]} color={palette.metalSoft} lineWidth={1} />;
      })}
      {run.tokens.map((token) => {
        const [x] = getCellPosition(0, token.index, tokenCount, layerCount);
        return <Line key={`token-tick-${token.index}`} points={[[x, axisY, frontZ - 0.07], [x, axisY, frontZ + 0.07]]} color={palette.metalSoft} lineWidth={1} />;
      })}
      {signalTicks.map((tick) => {
        const y = signalBaseY + tick * signalHeight;
        return (
          <group key={`signal-tick-${tick}`}>
            <Line points={[[originX - 0.08, y, frontZ], [originX + 0.08, y, frontZ]]} color={palette.red} lineWidth={1} />
            <Text position={[originX - 0.24, y, frontZ]} fontSize={0.12} color={palette.ink} anchorX="right" anchorY="middle">
              {tick.toFixed(1)}
            </Text>
          </group>
        );
      })}
      <Text position={[originX - 0.32, axisY, (minZ + maxZ) / 2]} fontSize={0.15} color={palette.ink} anchorX="center" anchorY="middle">
        Layers
      </Text>
      <Text position={[originX - 0.3, signalBaseY + signalHeight + 0.14, frontZ]} fontSize={0.13} color={palette.red} anchorX="right" anchorY="middle">
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
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            Layer trace
            <HelpIcon
              className="pointer-events-auto"
              label="Shows whether the current model run is still reconstructing activations or ready for inspection."
            />
          </span>
          <strong className="mt-1 block font-medium text-foreground">{traceStatus}</strong>
        </div>
        <div className={cn(sophonGlassSurface, "flex flex-wrap justify-end gap-2 rounded-md border px-3 py-2 text-right")}>
          <span className="flex items-center gap-1">
            {metricLabels[metric]}
            <HelpIcon
              className="pointer-events-auto"
              label="The active signal used to scale and color the 3D activation blocks."
              side="bottom"
            />
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            H{selectedHead === "all" ? "*" : selectedHead}
            <HelpIcon
              className="pointer-events-auto"
              label="The attention head currently shown by the arcs. H* means all heads are included."
              side="bottom"
            />
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex items-end justify-between gap-3 text-xs text-muted-foreground max-[640px]:inset-x-3 max-[640px]:bottom-3">
        <div className={cn(sophonGlassSurface, "min-w-0 rounded-md border px-3 py-2")}>
          <span className="flex items-center gap-1 text-[10px] uppercase">
            Selected trace
            <HelpIcon
              className="pointer-events-auto"
              label="The selected token and transformer layer. Click another block to inspect its signal details."
              side="top"
            />
          </span>
          <strong className="mt-1 block truncate text-sm text-foreground">
            {displayTokenText(selectedToken)} / layer {selectedLayer.layer}
          </strong>
        </div>
        <div className={cn("h-2 w-24 rounded-full bg-primary/40", isRunning && "animate-pulse shadow-[0_0_24px_rgb(255_31_61/.48)]")} />
      </div>
      <Canvas camera={{ position: [0, 4.7, 7.1], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={[palette.background]} />
        <ambientLight intensity={0.86} />
        <directionalLight position={[4, -6, 8]} intensity={1.2} />
        <pointLight position={[-5, 3, 7]} intensity={0.82} color={palette.redSoft} />
        <pointLight position={[5, 3, -5]} intensity={0.95} color={palette.red} />
        <pointLight position={[0, 6, 0]} intensity={0.45} color={palette.residualLow} />
        <group>
          <MeasurementGrid run={run} palette={palette} />
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
          {showAttention ? <AttentionArcs run={run} layer={selectedLayer} metric={metric} selectedHead={selectedHead} palette={palette} /> : null}
          <SceneAxes run={run} palette={palette} />
          {run.tokens.map((token) => {
            const [x] = getCellPosition(0, token.index, run.tokens.length, run.layers.length);
            const [, maxZ] = getCellPosition(run.layers.length - 1, 0, run.tokens.length, run.layers.length);
            const tokenAxisZ = maxZ + 0.48;
            return (
              <Text key={token.index} position={[x, signalBaseY, tokenAxisZ + tokenLabelAxisPadding]} fontSize={0.16} color={palette.ink} anchorX="center" anchorY="middle" maxWidth={0.85}>
                {displayTokenText(token)}
              </Text>
            );
          })}
        </group>
        <SceneControls />
      </Canvas>
    </div>
  );
}
