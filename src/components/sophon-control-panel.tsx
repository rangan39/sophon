"use client";

import { Activity, Braces, Eye, Network, SlidersHorizontal, Sparkles } from "lucide-react";
import { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MetricMode, PromptRun } from "@/lib/prompt-run";
import { sophonBrandMark } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

export type DetailMode = "prediction" | "feature" | "attention";

type TopFeature = PromptRun["layers"][number]["topFeature"][number];

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

const detailTabs: Array<{ value: DetailMode; label: string; icon: typeof Eye }> = [
  { value: "prediction", label: "Prediction", icon: Sparkles },
  { value: "feature", label: "Feature", icon: Braces },
  { value: "attention", label: "Attention", icon: Network }
];

const metricOptions: Array<{ value: MetricMode; shortLabel: string; label: string; icon: typeof Eye }> = [
  { value: "residual", shortLabel: "Res", label: "Residual stream", icon: Activity },
  { value: "attribution", shortLabel: "Attr", label: "Attribution", icon: Network },
  { value: "logit", shortLabel: "Logit", label: "Logit lens", icon: Eye }
];

export function SophonControlPanel({
  run,
  selectedLayer,
  selectedToken,
  feature,
  value,
  metric,
  setMetric,
  showAttention,
  setShowAttention,
  selectedHead,
  setSelectedHead,
  detailMode,
  setDetailMode
}: {
  run: PromptRun | null;
  selectedLayer: PromptRun["layers"][number] | null;
  selectedToken: PromptRun["tokens"][number] | null;
  feature: TopFeature | null;
  value: number;
  metric: MetricMode;
  setMetric: Dispatch<SetStateAction<MetricMode>>;
  showAttention: boolean;
  setShowAttention: Dispatch<SetStateAction<boolean>>;
  selectedHead: number | "all";
  setSelectedHead: Dispatch<SetStateAction<number | "all">>;
  detailMode: DetailMode;
  setDetailMode: Dispatch<SetStateAction<DetailMode>>;
}) {
  return (
    <div className="flex flex-col p-4 text-[13px]">
      <div className="flex min-h-12 items-center gap-3 pb-4 max-[1024px]:hidden">
        <div className={cn(sophonBrandMark, "grid size-9 place-items-center rounded-md border")}>
          <Sparkles className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold">Sophon</h1>
          <p className="text-[11px] uppercase text-muted-foreground">Mechanistic trace console</p>
        </div>
      </div>

      <Card className="border-[#a6acb2]/60 bg-white shadow-[inset_0_1px_0_rgb(255_255_255/.85),0_14px_34px_rgb(166_172_178/.16)]" variant="default">
        <div className="space-y-4 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase text-muted-foreground">Signal controls</span>
              </div>
              <h2 className="mt-1 truncate font-serif text-lg font-semibold">Activation view</h2>
            </div>
            <Badge variant="sophon">{metricLabels[metric]}</Badge>
          </div>

          <div className="rounded-md border border-[#a6acb2]/45 bg-[#f7f8f8] p-1">
            <ToggleGroup
              className="grid grid-cols-3 gap-1"
              onValueChange={(nextMetric) => {
                if (nextMetric) setMetric(nextMetric as MetricMode);
              }}
              type="single"
              value={metric}
            >
              {metricOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleGroupItem className="h-14 flex-col gap-1 px-2" key={option.value} title={option.label} value={option.value} variant="sophon">
                    <Icon className="size-4" />
                    <span className="text-xs">{option.shortLabel}</span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          <div className="rounded-md border border-[#a6acb2]/50 bg-white px-3 py-2 shadow-[inset_0_1px_0_rgb(255_255_255/.9)]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase text-muted-foreground">Attention overlay</span>
                <span className="block truncate text-xs text-muted-foreground">{selectedHead === "all" ? "All heads" : `Head ${selectedHead}`}</span>
              </div>
              <Button
                aria-pressed={showAttention}
                className="size-9 shrink-0"
                data-active={showAttention}
                onClick={() => setShowAttention((visible) => !visible)}
                title={showAttention ? "Hide attention arcs" : "Show attention arcs"}
                type="button"
                variant="sophon"
              >
                <Network className="size-4" />
              </Button>
            </div>
            <div className="mt-2">
              <Select
                onValueChange={(nextHead) => setSelectedHead(nextHead === "all" ? "all" : Number(nextHead))}
                value={String(selectedHead)}
              >
                <SelectTrigger className="h-10" variant="sophon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All heads</SelectItem>
                  {Array.from({ length: 12 }, (_, index) => (
                    <SelectItem value={String(index)} key={index}>
                      Head {index}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {run && selectedLayer && selectedToken && feature ? (
          <>
            <Separator className="bg-primary/20" />

            <div className="p-3">
            <div className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                <Card className="min-w-0 rounded-md px-3 py-2" variant="tile">
                  <span className="text-[10px] uppercase text-muted-foreground">Selected token</span>
                  <strong className="block truncate text-base">{selectedToken.text.trim() || "space"}</strong>
                </Card>
                <Card className="rounded-md px-3 py-2 text-right" variant="tile">
                  <span className="text-[10px] uppercase text-muted-foreground">Layer</span>
                  <strong className="block text-base">{selectedLayer.layer}</strong>
                </Card>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Card className="rounded-md px-3 py-2" variant="tile">
                  <span className="block text-muted-foreground">{metricLabels[metric]}</span>
                  <strong>{value.toFixed(3)}</strong>
                </Card>
                <Card className="rounded-md px-3 py-2" variant="tile">
                  <span className="block text-muted-foreground">Feature</span>
                  <strong className="block truncate">{feature.id}</strong>
                </Card>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Card className="rounded-md px-3 py-2" variant="tile">
                  <span className="block text-muted-foreground">Tokens</span>
                  <strong>{run.tokens.length}</strong>
                </Card>
                <Card className="rounded-md px-3 py-2" variant="tile">
                  <span className="block text-muted-foreground">Model</span>
                  <strong className="block truncate">{run.model}</strong>
                </Card>
              </div>
            </div>
            </div>

            <Separator className="bg-primary/20" />

            <div className="p-3">
              <div className="grid grid-cols-3 gap-1 border-b border-primary/20">
                {detailTabs.map((tab) => {
                  const Icon = tab.icon;
                  const selected = detailMode === tab.value;
                  return (
                    <button
                      aria-pressed={detailMode === tab.value}
                      className={cn(
                        "inline-flex h-9 items-center justify-center gap-2 border-b-2 px-2 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground"
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

              <Card className="mt-3 min-h-[220px] rounded-md p-3" variant="tile">
                {detailMode === "prediction" ? (
                  <div className="space-y-3">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase text-muted-foreground">Prompt trace</span>
                      <p className="mt-1 line-clamp-3 text-sm leading-6">{run.prompt}</p>
                    </div>
                    <Separator className="bg-primary/20" />
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
                      <span className="text-[10px] uppercase text-muted-foreground">Top SAE feature</span>
                      <strong className="mt-1 block text-sm">{feature.label}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Card className="rounded-md px-3 py-2" variant="tile">
                        <span className="block text-muted-foreground">Activation</span>
                        <strong>{feature.activation}</strong>
                      </Card>
                      <Card className="min-w-0 rounded-md px-3 py-2" variant="tile">
                        <span className="block text-muted-foreground">Feature ID</span>
                        <strong className="block truncate">{feature.id}</strong>
                      </Card>
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
                          selectedHead === edge.head && "border-[#d7192a]/70 bg-[linear-gradient(135deg,rgb(255_106_0/.26),rgb(215_25_42/.14)),rgb(255_255_255/.72)] text-primary shadow-[inset_0_1px_0_rgb(255_255_255/.8),0_0_18px_rgb(255_106_0/.24)]"
                        )}
                        key={`${edge.head}-${edge.from}-${edge.to}-${index}`}
                        onClick={() => setSelectedHead(edge.head)}
                        type="button"
                        variant="sophon"
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
              </Card>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
