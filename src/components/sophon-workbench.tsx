"use client";

import {
  ChevronDown,
  ChevronUp,
  Download,
  LocateFixed,
  Play,
  SquareSigma,
  SlidersHorizontal,
  Upload
} from "lucide-react";
import { ChangeEvent, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailMode, SophonControlPanel } from "@/components/sophon-control-panel";
import { Selection, SophonScene } from "@/components/sophon-scene";
import { PromptDock } from "@/components/prompt-dock";
import { TokenFooter } from "@/components/token-footer";
import { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS, runPrompt } from "@/lib/interp-client";
import { exportFilename, parseRunFile, serializeRun } from "@/lib/run-file";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function exportRun() {
    if (!run) return;
    const blob = new Blob([serializeRun(run)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(run);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (currentRun && !window.confirm("Loading a file replaces the current run. Continue?")) {
      return;
    }

    const text = await file.text();
    const result = parseRunFile(text);

    if (result.ok) {
      setCurrentRun(result.run);
      setSelectedHead("all");
      setSelection({
        layer: Math.min(8, result.run.layers.length - 1),
        token: Math.max(0, result.run.tokens.length - 1)
      });
      setRunMessage(null);
    } else {
      setRunMessage(result.error);
    }
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
              <SquareSigma className="size-5 text-primary-foreground" />
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

      <section className="order-2 grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)_auto_auto] bg-background max-[1024px]:order-1 max-[760px]:grid-rows-[54px_minmax(0,1fr)_auto_auto]">
        <header className={cn(sophonChromeSurface, "relative flex items-center justify-between gap-4 border-b px-4 py-2.5 max-[760px]:px-3 max-[760px]:py-2")}>
          <div className="min-w-0">
            <h2 className="truncate font-serif text-xl font-semibold max-[760px]:text-lg">{run?.title ?? "Run a prompt"}</h2>
          </div>
          <div className="flex shrink-0 gap-2">
            <input
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
              ref={fileInputRef}
              type="file"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              size="icon"
              title="Import run"
              type="button"
              variant="sophon"
            >
              <Upload className="size-4" />
            </Button>
            <Button
              disabled={!run}
              onClick={exportRun}
              size="icon"
              title="Export run"
              type="button"
              variant="sophon"
            >
              <Download className="size-4" />
            </Button>
            <Button
              disabled={!run}
              onClick={() => setSelection({ layer: 0, token: 0 })}
              size="icon"
              title="Reset selection"
              type="button"
              variant="sophon"
            >
              <LocateFixed className="size-4" />
            </Button>
            <Button className="max-[520px]:px-3" disabled={!canRun} onClick={executeRun} type="button" variant="sophon-primary">
              <Play className="size-4" />
              <span className="max-[520px]:sr-only">{isRunning ? "Running" : "Run"}</span>
            </Button>
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
            <div className={cn(sophonGridSurface, "flex h-full flex-col items-center justify-center overflow-hidden px-7 text-center text-muted-foreground")}>
              <div className="flex flex-col items-center rounded-lg border border-[#d5d9dd] bg-white/95 px-8 py-7 shadow-[0_12px_36px_rgb(166_172_178/.16)]">
                <div className={cn(sophonBrandMark, "grid size-16 place-items-center rounded-md border")}>
                  <SquareSigma className="size-9 text-primary-foreground" />
                </div>
                <h2 className="mt-4 font-serif text-xl font-semibold text-foreground">No model run loaded</h2>
                <p className="mt-2 max-w-sm text-sm leading-6">
                  Enter a short prompt and run the local or hosted TransformerLens service.
                </p>
              </div>
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
