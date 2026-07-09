"use client";

import {
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  LocateFixed,
  Play,
  SquareSigma,
  SlidersHorizontal,
  Terminal
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailMode, SophonControlPanel } from "@/components/sophon-control-panel";
import { PromptDock } from "@/components/prompt-dock";
import { TokenFooter } from "@/components/token-footer";
import { MAX_PROMPT_CHARS, MAX_PROMPT_TOKENS, RuntimeLogEvent, runPrompt } from "@/lib/interp-client";
import { MetricMode, PromptRun, metricValue } from "@/lib/prompt-run";
import type { Selection } from "@/lib/selection";
import { sophonBrandMark, sophonChromeSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

const SophonScene = dynamic(
  () => import("@/components/sophon-scene").then((module) => module.SophonScene),
  {
    loading: () => (
      <div className={cn(sophonGridSurface, "flex h-full items-center justify-center bg-background text-sm text-muted-foreground")}>
        Loading 3D trace...
      </div>
    ),
    ssr: false
  }
);

const metricLabels: Record<MetricMode, string> = {
  residual: "Residual",
  attribution: "Attribution",
  logit: "Logit lens"
};

type RuntimeLog = RuntimeLogEvent & {
  id: number;
  time: string;
};

export function SophonWorkbench() {
  const [currentRun, setCurrentRun] = useState<PromptRun | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [lockedPrompt, setLockedPrompt] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricMode>("residual");
  const [showAttention, setShowAttention] = useState(true);
  const [selectedHead, setSelectedHead] = useState<number | "all">("all");
  const [selection, setSelection] = useState<Selection>({ layer: 0, token: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLog[]>([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>("prediction");
  const runJobId = useRef(0);
  const runtimeLogId = useRef(0);

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

  function appendRuntimeLog(event: RuntimeLogEvent) {
    const id = runtimeLogId.current + 1;
    runtimeLogId.current = id;
    setRuntimeLogs((logs) => [
      ...logs.slice(-49),
      {
        ...event,
        id,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      }
    ]);
  }

  function executeRun() {
    if (!canRun) return;

    const jobId = runJobId.current + 1;
    const prompt = promptInput.trim();
    runJobId.current = jobId;
    setPromptInput(prompt);
    setIsRunning(true);
    setLockedPrompt(prompt);
    setRunMessage(null);
    setRuntimeLogs([]);

    void runPrompt(prompt, {
      onLog: appendRuntimeLog
    })
      .then((result) => {
        if (jobId !== runJobId.current) return;

        if (result.ok) {
          setCurrentRun(result.run);
          setSelectedHead("all");
          setSelection({
            layer: Math.min(8, result.run.layers.length - 1),
            token: Math.max(0, result.run.tokens.length - 1)
          });
          return;
        }

        if (result.code === "PROMPT_TOO_LONG" && result.tokenCount && result.maxTokens) {
          setRunMessage(`This prompt is ${result.tokenCount} tokens. Keep it under ${result.maxTokens} tokens.`);
          return;
        }

        setRunMessage(result.message);
      })
      .catch(() => {
        if (jobId !== runJobId.current) return;
        setRunMessage("Browser WebGPU trace failed.");
      })
      .finally(() => {
        if (jobId !== runJobId.current) return;
        setIsRunning(false);
        setLockedPrompt(null);
      });
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
            <div className="relative h-full">
              <SophonScene
                run={run}
                metric={metric}
                selection={selection}
                setSelection={setSelection}
                showAttention={showAttention}
                selectedHead={selectedHead}
                isRunning={isRunning}
              />
              {isRunning ? <RunJobOverlay logs={runtimeLogs} prompt={lockedPrompt} /> : null}
            </div>
          ) : isRunning ? (
            <RunJobEmptyState logs={runtimeLogs} prompt={lockedPrompt} />
          ) : (
            <div className={cn(sophonGridSurface, "flex h-full flex-col items-center justify-center overflow-hidden px-7 text-center text-muted-foreground")}>
              <div className="flex w-full max-w-xl flex-col items-center rounded-lg border border-[#d5d9dd] bg-white/95 px-8 py-7 shadow-[0_12px_36px_rgb(166_172_178/.16)]">
                <div className={cn(sophonBrandMark, "grid size-16 place-items-center rounded-md border")}>
                  <SquareSigma className="size-9 text-primary-foreground" />
                </div>
                <h2 className="mt-4 font-serif text-xl font-semibold text-foreground">No model run loaded</h2>
                <p className="mt-2 max-w-sm text-sm leading-6">
                  Enter a short prompt and run the browser ONNX WebGPU model.
                </p>
                {runtimeLogs.length > 0 ? <RuntimeLogPanel className="mt-5 w-full" logs={runtimeLogs} /> : null}
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
          isPromptLocked={Boolean(lockedPrompt)}
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

function RunJobEmptyState({ logs, prompt }: { logs: RuntimeLog[]; prompt: string | null }) {
  return (
    <div className={cn(sophonGridSurface, "flex h-full flex-col items-center justify-center overflow-hidden px-7 text-center text-muted-foreground")}>
      <div className="flex w-full max-w-md flex-col items-center rounded-lg border border-[#d5d9dd] bg-white/95 px-8 py-7 shadow-[0_12px_36px_rgb(166_172_178/.16)]">
        <div className="relative grid size-16 place-items-center">
          <div className="absolute inset-0 rounded-md border border-primary/35 bg-primary/10" />
          <div className="absolute inset-1 rounded-md border border-primary/45 animate-ping" />
          <LoaderCircle className="relative size-8 animate-spin text-primary" />
        </div>
        <h2 className="mt-4 font-serif text-xl font-semibold text-foreground">Running trace job</h2>
        <p className="mt-2 max-w-sm text-sm leading-6">
          The prompt is locked while Sophon runs the ONNX WebGPU trace on this browser.
        </p>
        {prompt ? (
          <p className="mt-4 max-w-full truncate rounded-md border border-[#d5d9dd] bg-white px-3 py-2 font-mono text-xs text-foreground">
            {prompt}
          </p>
        ) : null}
        <div className="mt-5 grid w-full grid-cols-3 gap-2">
          <div className="h-1.5 animate-pulse rounded-full bg-primary/80" />
          <div className="h-1.5 animate-pulse rounded-full bg-[#a6acb2]/60 [animation-delay:150ms]" />
          <div className="h-1.5 animate-pulse rounded-full bg-primary/50 [animation-delay:300ms]" />
        </div>
        <RuntimeLogPanel className="mt-5 w-full" logs={logs} />
      </div>
    </div>
  );
}

function RunJobOverlay({ logs, prompt }: { logs: RuntimeLog[]; prompt: string | null }) {
  const latestLog = logs.at(-1);

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex justify-center">
      <div className="flex max-w-[min(620px,100%)] items-center gap-3 rounded-lg border border-[#d5d9dd] bg-white/92 px-4 py-3 text-sm shadow-[0_12px_32px_rgb(166_172_178/.18)] backdrop-blur-xl">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 text-left">
          <p className="font-medium text-foreground">Running trace job</p>
          <p className="truncate text-xs text-muted-foreground">{latestLog ? `${latestLog.message}${latestLog.detail ? ` · ${latestLog.detail}` : ""}` : prompt ?? "Prompt locked until the run completes."}</p>
        </div>
      </div>
    </div>
  );
}

function RuntimeLogPanel({
  className,
  logs
}: {
  className?: string;
  logs: RuntimeLog[];
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-[#d5d9dd] bg-[#fbfbfb] text-left shadow-[inset_0_1px_0_rgb(255_255_255/.85)]", className)}>
      <div className="flex items-center justify-between border-b border-[#d5d9dd] px-3 py-2">
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
          <Terminal className="size-3.5 text-primary" />
          WebGPU logs
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{logs.length}</span>
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div className="grid grid-cols-[62px_64px_minmax(0,1fr)] gap-2" key={log.id}>
              <span className="text-muted-foreground">{log.time}</span>
              <span className={cn(
                "uppercase",
                log.level === "error" && "text-primary",
                log.level === "warning" && "text-[#8a5a00]",
                log.level === "success" && "text-[#47705a]",
                log.level === "info" && "text-muted-foreground"
              )}>
                {log.level}
              </span>
              <span className="min-w-0 truncate text-foreground">
                {log.message}
                {log.detail ? <span className="text-muted-foreground"> · {log.detail}</span> : null}
              </span>
            </div>
          ))
        ) : (
          <div className="text-muted-foreground">Logs will appear when a browser WebGPU trace starts.</div>
        )}
      </div>
    </div>
  );
}
