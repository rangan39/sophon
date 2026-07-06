"use client";

import { Activity, Braces, Eye, Network, SlidersHorizontal, Sparkles, Spline, SquareSigma } from "lucide-react";
import { Dispatch, SetStateAction } from "react";
import { HelpIcon } from "@/components/help-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { displayPredictionToken, displayTokenText, MetricMode, PromptRun } from "@/lib/prompt-run";
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
  const featuresAvailable = run?.featuresAvailable === true;
  const visibleDetailTabs = featuresAvailable ? detailTabs : detailTabs.filter((tab) => tab.value !== "feature");
  const activeDetailMode = featuresAvailable || detailMode !== "feature" ? detailMode : "prediction";

  return (
    <div className="flex flex-col p-4 text-[13px]">
      <div className="flex min-h-12 items-center gap-3 pb-4 max-[1024px]:hidden">
        <div className={cn(sophonBrandMark, "grid size-9 place-items-center rounded-md border")}>
          <SquareSigma className="size-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold">Sophon</h1>
          <p className="text-[11px] uppercase text-muted-foreground">Mechanistic trace console</p>
        </div>
      </div>

      <Card className="border-[#a6acb2]/60 bg-white shadow-[inset_0_1px_0_rgb(255_255_255/.85),0_14px_34px_rgb(166_172_178/.16)]" variant="default">
        <div className="p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase text-muted-foreground">Signal controls</span>
                <HelpIcon label="Choose which scalar signal controls the height and color of each layer-token block. Residual is representation magnitude, Attr estimates contribution to the final prediction, and Logit lens shows layer-level next-token confidence." />
              </div>
              <h2 className="mt-1 truncate font-serif text-lg font-semibold">Activation view</h2>
            </div>
          </div>

          <div className="mt-2 rounded-md border border-[#a6acb2]/45 bg-[#f7f8f8] p-1">
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

          <div className="mt-3 rounded-md border border-[#a6acb2]/50 bg-white px-3 py-2 shadow-[inset_0_1px_0_rgb(255_255_255/.9)]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  Attention overlay
                  <HelpIcon label="Attention arcs show which key/source tokens in the selected layer are attended to. Use the dropdown to inspect all heads or one head." />
                </span>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_40px] gap-2">
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
              <Button
                aria-pressed={showAttention}
                className="size-10"
                data-active={showAttention}
                onClick={() => setShowAttention((visible) => !visible)}
                title={showAttention ? "Hide attention arcs" : "Show attention arcs"}
                type="button"
                variant="sophon"
              >
                <Spline className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {run && selectedLayer && selectedToken ? (
          <>
            <Separator className="bg-[#d5d9dd]" />

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  Measurement
                  <HelpIcon label="Compact readout for the selected token-layer coordinate: token text, layer index, active signal value, and run metadata." />
                </span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  L{selectedLayer.layer}:T{selectedToken.index}
                </span>
              </div>
              <div className="rounded-md border border-[#d5d9dd] bg-[#fbfbfb] text-xs shadow-[inset_0_1px_0_rgb(255_255_255/.85)]">
                <div className="grid grid-cols-[minmax(0,1fr)_56px_76px] divide-x divide-[#d5d9dd]">
                  <div className="min-w-0 px-3 py-2">
                    <span className="block text-[10px] uppercase text-muted-foreground">Token</span>
                    <strong className="mt-0.5 block truncate font-mono text-base leading-5">{displayTokenText(selectedToken)}</strong>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <span className="block text-[10px] uppercase text-muted-foreground">L</span>
                    <strong className="mt-0.5 block font-mono text-base leading-5">{selectedLayer.layer}</strong>
                  </div>
                  <div className="px-2 py-2 text-right">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      {metric === "attribution" ? "Attr" : metric === "residual" ? "Res" : "Logit"}
                    </span>
                    <strong className="mt-0.5 block font-mono text-base leading-5">{value.toFixed(3)}</strong>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-x-3 border-t border-[#d5d9dd] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  <div className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2">
                    <span className="uppercase">Model</span>
                    <strong className="block truncate font-medium text-foreground">{run.model}</strong>
                  </div>
                  <div className="grid grid-cols-[24px_1fr] items-center gap-1 text-right">
                    <span className="uppercase">Tok</span>
                    <strong className="font-mono text-foreground">{run.tokens.length}</strong>
                  </div>
                  <div className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2">
                    <span className="uppercase">{featuresAvailable && feature ? "Feature" : "Source"}</span>
                    <strong className="block truncate font-medium text-foreground">{featuresAvailable && feature ? feature.id : run.source}</strong>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="bg-[#d5d9dd]" />

            <div className="p-3">
              <div className="rounded-md border border-[#a6acb2]/45 bg-[#f7f8f8] p-1">
                <ToggleGroup
                  className={cn("grid gap-1", visibleDetailTabs.length === 2 ? "grid-cols-2" : "grid-cols-3")}
                  onValueChange={(nextMode) => {
                    if (nextMode) setDetailMode(nextMode as DetailMode);
                  }}
                  type="single"
                  value={activeDetailMode}
                >
                  {visibleDetailTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <ToggleGroupItem className="h-10 gap-2 px-2" key={tab.value} title={tab.label} value={tab.value} variant="sophon">
                        <Icon className="size-3.5" />
                        <span className="text-xs max-[420px]:sr-only">{tab.label}</span>
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
              </div>

              <Card className="mt-3 min-h-[220px] rounded-md p-3" variant="tile">
                {activeDetailMode === "prediction" ? (
                  <div className="space-y-3">
                    <div className="min-w-0">
                      <span className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
                        Prompt trace
                        <HelpIcon label="The prompt whose model activations, attention, and predictions are shown here." />
                      </span>
                      <p className="mt-1 line-clamp-3 text-sm leading-6">{run.prompt}</p>
                    </div>
                    <Separator className="bg-[#d5d9dd]" />
                    <div className="grid gap-3">
                      {run.finalPredictions.map((prediction, index) => (
                        <div className="grid grid-cols-[58px_minmax(0,1fr)_34px] items-center gap-2 text-xs" key={`${prediction.token}-${index}`}>
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-mono">{displayPredictionToken(prediction)}</span>
                            {prediction.kind === "special" ? <HelpIcon label="Special model token. For GPT-2 this can mean an end-of-text boundary." /> : null}
                          </span>
                          <Progress value={prediction.probability * 100} />
                          <strong className="text-right">{Math.round(prediction.probability * 100)}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {featuresAvailable && feature && activeDetailMode === "feature" ? (
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

                {activeDetailMode === "attention" ? (
                  <div className="grid gap-2">
                    {selectedLayer.attention.slice(0, 6).map((edge, index) => (
                      <Button
                        className={cn(
                          "grid h-auto w-full grid-cols-[34px_minmax(0,1fr)_36px] justify-normal gap-2 px-3 py-2 text-left",
                          selectedHead === edge.head && "border-primary bg-primary text-primary-foreground shadow-[0_0_18px_rgb(255_31_61/.24)] [&_em]:text-primary-foreground"
                        )}
                        key={`${edge.head}-${edge.from}-${edge.to}-${index}`}
                        onClick={() => setSelectedHead(edge.head)}
                        type="button"
                        variant="sophon"
                      >
                        <span className="text-xs">H{edge.head}</span>
                        <strong className="truncate text-xs font-semibold">
                          {displayTokenText(run.tokens[edge.query ?? edge.from])} attends to {displayTokenText(run.tokens[edge.key ?? edge.to])}
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
