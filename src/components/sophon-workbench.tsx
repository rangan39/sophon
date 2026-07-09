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

const runtimePhaseLabels: Record<NonNullable<RuntimeLogEvent["phase"]>, string> = {
  download: "download",
  gpu: "gpu",
  inference: "infer",
  postprocess: "measure",
  runtime: "runtime",
  tokenize: "tokens"
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
          {isRunning ? (
            <RuntimeConsole logs={runtimeLogs} prompt={lockedPrompt} />
          ) : run ? (
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
            </div>
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

function RuntimeConsole({ logs, prompt }: { logs: RuntimeLog[]; prompt: string | null }) {
  const latestLog = logs.at(-1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0e1114] text-[#f6f7f8]">
      <div className="flex min-h-0 flex-1 flex-col border-b border-white/10">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 max-[640px]:px-4 max-[640px]:py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/50 bg-primary text-primary-foreground shadow-[0_0_24px_rgb(255_31_61/.25)]">
              <Terminal className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-serif text-lg font-semibold text-white max-[640px]:text-base">WebGPU trace console</h2>
              <p className="truncate font-mono text-xs text-white/55">
                {prompt ?? "Prompt locked until the run completes."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/[.04] px-3 py-2 font-mono text-[11px] uppercase text-white/70">
            <LoaderCircle className="size-3.5 animate-spin text-primary" />
            running
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-0 overflow-hidden max-[900px]:grid-cols-1">
          <RuntimeLogStream logs={logs} />
          <aside className="border-l border-white/10 bg-white/[.035] p-4 max-[900px]:hidden">
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-normal text-white/45">Current phase</p>
                <p className="mt-1 truncate font-mono text-sm text-white">
                  {latestLog?.phase ? runtimePhaseLabels[latestLog.phase] : "initializing"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-normal text-white/45">Latest event</p>
                <p className="mt-1 text-sm leading-5 text-white/80">{latestLog?.message ?? "Waiting for runtime logs."}</p>
                {latestLog?.detail ? <p className="mt-1 break-words font-mono text-xs leading-5 text-white/45">{latestLog.detail}</p> : null}
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-normal text-white/45">Events</p>
                <p className="mt-1 font-mono text-2xl text-white">{logs.length}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden bg-white/10">
        <div className="h-full w-1/2 animate-pulse bg-primary shadow-[0_0_26px_rgb(255_31_61/.65)]" />
      </div>
    </div>
  );
}

function RuntimeLogStream({ logs }: { logs: RuntimeLog[] }) {
  return (
    <div className="min-h-0 overflow-y-auto px-5 py-4 font-mono text-xs leading-6 max-[640px]:px-4">
      {logs.length > 0 ? (
        logs.map((log) => (
          <div className="grid grid-cols-[76px_78px_84px_minmax(0,1fr)] gap-3 border-b border-white/[.045] py-1.5 max-[760px]:grid-cols-[70px_70px_minmax(0,1fr)]" key={log.id}>
            <span className="text-white/40">{log.time}</span>
            <span className={cn(
              "uppercase",
              log.level === "error" && "text-primary",
              log.level === "warning" && "text-[#f6c95c]",
              log.level === "success" && "text-[#81d39c]",
              log.level === "info" && "text-white/55"
            )}>
              {log.level}
            </span>
            <span className="uppercase text-white/40 max-[760px]:hidden">
              {log.phase ? runtimePhaseLabels[log.phase] : "event"}
            </span>
            <span className="min-w-0 break-words text-white/82">
              {log.message}
              {typeof log.durationMs === "number" ? <span className="text-white/40"> [{log.durationMs}ms]</span> : null}
              {log.detail ? <span className="text-white/45"> · {log.detail}</span> : null}
            </span>
          </div>
        ))
      ) : (
        <div className="flex h-full min-h-[260px] flex-col justify-center text-white/45">
          <p className="font-serif text-xl text-white">Awaiting WebGPU runtime</p>
          <p className="mt-2 max-w-lg leading-6">
            Runtime logs will stream here while the browser initializes WebGPU, loads model assets, tokenizes the prompt, runs ONNX inference, and prepares measurement tensors.
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-white/45">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        <span>stream open</span>
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
