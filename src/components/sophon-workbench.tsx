"use client";

import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Cpu,
  Play,
  RotateCcw,
  SlidersHorizontal
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailMode, SophonControlPanel } from "@/components/sophon-control-panel";
import { Selection, SophonScene } from "@/components/sophon-scene";
import { PromptDock } from "@/components/prompt-dock";
import { TokenFooter } from "@/components/token-footer";
import { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS, runPrompt } from "@/lib/interp-client";
import { MetricMode, PromptRun, metricValue } from "@/lib/prompt-run";
import { sophonBrandMark, sophonChromeSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

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
  const statusLabel = isRunning ? "Reconstructing activations" : run ? "Trace locked" : "Awaiting prompt trace";
  const syncValue = isRunning ? 58 : run ? 100 : 0;

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
    <main className={cn(
      sophonGridSurface,
      "grid h-svh overflow-hidden bg-background text-foreground",
      "grid-cols-[380px_minmax(0,1fr)]",
      controlsOpen
        ? "max-[1024px]:grid-cols-1 max-[1024px]:grid-rows-[minmax(0,1fr)_minmax(260px,42svh)]"
        : "max-[1024px]:grid-cols-1 max-[1024px]:grid-rows-[minmax(0,1fr)_76px]"
    )}>
      <aside className={cn(sophonChromeSurface, "order-1 min-h-0 min-w-0 overflow-hidden border-r max-[1024px]:order-2 max-[1024px]:border-r-0 max-[1024px]:border-t")}>
        <div className="hidden h-[76px] items-center justify-between gap-3 px-4 max-[1024px]:flex">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn(sophonBrandMark, "grid size-9 shrink-0 place-items-center rounded-md border")}>
              <BrainCircuit className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-serif text-base font-semibold">Sophon</h1>
                <Badge variant="sophon" className="hidden shrink-0 sm:inline-flex">
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
            variant="sophon"
          >
            <SlidersHorizontal className="size-4" />
            <span>Controls</span>
            {controlsOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
        <ScrollArea className={cn("h-full max-[1024px]:h-[calc(100%-76px)]", !controlsOpen && "max-[1024px]:hidden")}>
          <SophonControlPanel
            run={run}
            selectedLayer={selectedLayer}
            selectedToken={selectedToken}
            feature={feature}
            value={value}
            metric={metric}
            setMetric={setMetric}
            showAttention={showAttention}
            setShowAttention={setShowAttention}
            selectedHead={selectedHead}
            setSelectedHead={setSelectedHead}
            detailMode={detailMode}
            setDetailMode={setDetailMode}
          />
        </ScrollArea>
      </aside>

      <section className="order-2 grid min-h-0 min-w-0 grid-rows-[82px_minmax(0,1fr)_auto_auto] bg-background max-[1024px]:order-1 max-[760px]:grid-rows-[64px_minmax(0,1fr)_auto_auto]">
        <header className={cn(sophonChromeSurface, "relative flex items-center justify-between gap-4 border-b px-5 py-4 max-[760px]:px-4 max-[760px]:py-3")}>
          <div className="min-w-0">
            <p className="mb-1 flex items-center gap-2 truncate text-xs uppercase text-muted-foreground">
              <Cpu className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{run?.model ?? "gpt2-small / TransformerLens"}</span>
            </p>
            <h2 className="truncate font-serif text-2xl font-semibold max-[760px]:text-lg">{run?.title ?? "Run a prompt"}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground max-[760px]:hidden">{statusLabel}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={!run}
              onClick={() => setSelection({ layer: 0, token: 0 })}
              size="icon"
              title="Reset selection"
              type="button"
              variant="sophon"
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button className="max-[520px]:px-3" disabled={!canRun} onClick={executeRun} type="button" variant="sophon-primary">
              <Play className="size-4" />
              <span className="max-[520px]:sr-only">{isRunning ? "Running" : "Run"}</span>
            </Button>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-px bg-primary/10">
            <div
              className={cn("h-px bg-primary transition-all duration-500", isRunning && "animate-pulse shadow-[0_0_24px_rgb(215_25_42/.54),0_0_38px_rgb(255_106_0/.32)]")}
              style={{ width: `${syncValue}%` }}
            />
          </div>
        </header>

        <div className="min-h-0 overflow-hidden">
          {run ? (
            <SophonScene
              run={run}
              metric={metric}
              selection={selection}
              setSelection={setSelection}
              showAttention={showAttention}
              selectedHead={selectedHead}
              isRunning={isRunning}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center overflow-hidden px-7 text-center text-muted-foreground">
              <div className={cn(sophonBrandMark, "grid size-16 place-items-center rounded-md border")}>
                <BrainCircuit className="size-9 text-primary" />
              </div>
              <h2 className="mt-4 font-serif text-xl font-semibold text-foreground">No model run loaded</h2>
              <p className="mt-2 max-w-sm text-sm leading-6">
                Enter a short prompt and run the local or hosted TransformerLens service.
              </p>
            </div>
          )}
        </div>

        <PromptDock
          promptInput={promptInput}
          setPromptInput={setPromptInput}
          promptCharsRemaining={promptCharsRemaining}
          canRun={canRun}
          isRunning={isRunning}
          runMessage={runMessage}
          executeRun={() => void executeRun()}
          maxPromptChars={MAX_PROMPT_CHARS}
          maxPromptTokens={MAX_PROMPT_TOKENS}
        />

        <TokenFooter run={run} selection={selection} setSelection={setSelection} />
      </section>
    </main>
  );
}
