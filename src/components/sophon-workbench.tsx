"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { CircleUserRound, LoaderCircle, MessageSquareText, SendHorizontal } from "lucide-react";
import { SophonModelSelector } from "@/components/sophon-model-selector";
import { SophonMobileSidebar, SophonSidebar } from "@/components/sophon-sidebar";
import { InspectableMessage, type InspectableToken } from "@/components/token-lens";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { getCapabilities, runPrompt, unloadModel } from "@/lib/interp-client";
import { DEFAULT_ONNX_MODEL, MODEL_REGISTRY, type ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
  tokens?: InspectableToken[];
};

const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "Hi — I’m Sophon. Ask me something and I’ll run it through the local model in your browser.",
    meta: "Ready locally"
  }
];

export function SophonWorkbench() {
  const [messages, setMessages] = useState(STARTER_MESSAGES);
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_ONNX_MODEL.id);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const generationIdRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const selectedModel = MODEL_REGISTRY.find((model) => model.id === modelId) ?? DEFAULT_ONNX_MODEL;
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel);
  const canSend = prompt.trim().length > 0 && !isRunning;

  useEffect(() => {
    let active = true;
    void getCapabilities()
      .then((nextCapabilities) => {
        if (active) setCapabilities(nextCapabilities);
      })
      .catch(() => {
        if (active) setCapabilities({ webgpu: false, wasm: false, crossOriginIsolated: false });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messageEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [isRunning, messages]);

  function resetChat() {
    generationIdRef.current += 1;
    setMessages(STARTER_MESSAGES);
    setPrompt("");
    setError(null);
    setIsRunning(false);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function selectModel(nextModelId: string) {
    if (nextModelId === modelId) return;
    const previousModelId = modelId;
    setModelId(nextModelId);
    setError(null);
    void unloadModel(previousModelId).catch(() => {
      setError("The previous model could not be released. You can continue with the selected model.");
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }

  async function submitPrompt(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || isRunning) return;

    const generationId = generationIdRef.current += 1;
    const userMessageId = `user-${generationId}`;
    setPrompt("");
    setError(null);
    setIsRunning(true);
    setMessages((current) => [...current, { id: userMessageId, role: "user", content: text }]);

    try {
      const response = await runPrompt(text, {
        modelId,
        maxNewTokens: 48,
        temperature: 0.8
      });
      if (generationIdRef.current !== generationId) return;
      if (!response.ok) {
        setError(response.message);
        return;
      }

      const metrics = response.result.metrics;
      setMessages((current) => [
        ...current.map((message) => message.id === userMessageId
          ? { ...message, tokens: response.result.inputTokens }
          : message),
        {
          id: `assistant-${generationId}`,
          role: "assistant",
          content: response.result.generatedText || "The model returned an empty response.",
          tokens: response.result.generatedTokens,
          meta: `${metrics.provider} · ${metrics.contextTokenCount}${metrics.truncatedInputTokens ? `/${metrics.promptTokenCount}` : ""}→${response.result.outputTokenCount} tok · ${formatRate(metrics.decodeTokensPerSecond)} · ${formatDuration(metrics.ttftMs)} TTFT${metrics.truncatedInputTokens ? ` · ${metrics.truncatedInputTokens} earlier tok omitted` : ""}`
        }
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The local model could not run.");
    } finally {
      if (generationIdRef.current === generationId) setIsRunning(false);
    }
  }

  const sidebarProps = {
    capabilities,
    disabled: isRunning,
    model: selectedModel,
    onNewSession: resetChat
  };

  return (
    <main className="relative h-svh w-full overflow-hidden bg-sophon-canvas text-foreground">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative flex h-svh w-full flex-col bg-sophon-panel/80 backdrop-blur-sm">
        <header className="flex h-[74px] shrink-0 items-center justify-between border-b border-white/[.08] bg-sophon-panel/90 px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <SophonMobileSidebar {...sidebarProps} />
            <div className="relative grid size-9 shrink-0 place-items-center rounded-md border border-sophon-signal-bright/50 bg-sophon-signal text-[#210b07] shadow-[0_0_30px_rgb(255_77_46/.16)]">
              <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>
              <span aria-hidden="true" className="absolute -right-1 -top-1 size-2 rounded-full bg-sophon-warning shadow-[0_0_12px_var(--sophon-warning)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-white">SOPHON</h1>
                <Badge className="border-sophon-signal-bright/30 bg-sophon-signal/10 font-mono text-[9px] uppercase tracking-widest text-[#ff9d87]" variant="outline">Local AI</Badge>
              </div>
              <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 sm:block">Private inference console</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div aria-live="polite" className={cn("hidden items-center gap-2 font-mono text-[10px] uppercase tracking-widest sm:flex", runtimeStatus.className)} role="status">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", runtimeStatus.dotClassName)} />
              {runtimeStatus.label}
            </div>
            <SophonModelSelector disabled={isRunning} modelId={modelId} onSelect={selectModel} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 min-[701px]:grid-cols-[250px_minmax(0,1fr)]">
          <SophonSidebar {...sidebarProps} />

          <section aria-labelledby="conversation-title" className="relative flex min-h-0 min-w-0 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-4 sm:px-12 sm:py-7">
                <div>
                  <div className="mb-3 flex items-center justify-between border-b border-white/[.08] pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    <span>Transmission log</span><span className="text-sophon-verified">Channel open</span>
                  </div>
                  <div className="flex items-center justify-between gap-5">
                    <div className="min-w-0">
                      <h2 className="font-mono text-xs font-medium uppercase tracking-[0.22em] text-white/70" id="conversation-title">Conversation buffer</h2>
                      <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-wider text-white/25">{selectedModel.family} / {selectedModel.label} / {selectedModel.verification}</p>
                    </div>
                    <div aria-hidden="true" className="hidden size-12 shrink-0 items-center justify-center rounded-md border border-sophon-signal-bright/20 bg-sophon-signal/[.04] text-sophon-signal-soft sm:flex">
                      <MessageSquareText className="size-5" />
                    </div>
                  </div>
                </div>

                <div aria-busy={isRunning} aria-live="polite" aria-relevant="additions text" className="mt-3 space-y-6" role="log">
                  {messages.map((message) => (
                    <Message align={message.role === "user" ? "end" : "start"} key={message.id}>
                      <MessageAvatar className={message.role === "user" ? "rounded-md border border-sophon-signal-bright/40 bg-sophon-signal text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.12)]" : "rounded-md border border-white/[.12] bg-white/[.06] text-sophon-signal-soft"}>
                        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>}
                      </MessageAvatar>
                      <MessageContent className="max-w-[min(920px,calc(100%-3rem))]">
                        <InspectableMessage content={message.content} meta={message.meta} role={message.role} tokens={message.tokens} />
                      </MessageContent>
                    </Message>
                  ))}
                  {isRunning ? (
                    <Message>
                      <MessageAvatar><GreekGlyph className="animate-pulse text-lg font-semibold motion-reduce:animate-none">Σ</GreekGlyph></MessageAvatar>
                      <MessageContent>
                        <Bubble variant="muted"><BubbleContent><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /><span className="sr-only">Generating response</span></BubbleContent></Bubble>
                      </MessageContent>
                    </Message>
                  ) : null}
                  <div aria-hidden="true" ref={messageEndRef} />
                </div>
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-white/[.08] bg-sophon-panel/90 p-4 backdrop-blur-xl sm:p-6">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {error ? <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-[#ff9a9d]" id="prompt-error" role="alert">{error}</div> : null}
                <label className="sr-only" htmlFor="sophon-prompt">Message Sophon</label>
                <div className="relative rounded-md border border-white/[.14] bg-sophon-field shadow-[0_15px_60px_rgb(0_0_0/.28)] transition-colors focus-within:border-sophon-signal-bright/60 focus-within:shadow-[0_0_0_3px_rgb(255_77_46/.1),0_15px_60px_rgb(0_0_0/.28)]">
                  <Textarea
                    aria-describedby={error ? "prompt-error prompt-help" : "prompt-help"}
                    aria-invalid={Boolean(error)}
                    className="min-h-24 resize-none border-0 bg-transparent pr-14 text-[15px] leading-6 text-white shadow-none placeholder:text-white/25 focus-visible:ring-0"
                    id="sophon-prompt"
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask the local model anything..."
                    ref={promptRef}
                    value={prompt}
                  />
                  <div className="flex items-center justify-between border-t border-white/[.07] px-3 py-2">
                    <span className="truncate pr-3 font-mono text-[10px] uppercase tracking-widest text-white/25">{selectedModel.family} · {selectedModel.format.quantization} · {selectedModel.format.sizeLabel}</span>
                    <Button aria-label="Send message" className="relative size-8 shrink-0 rounded-lg bg-sophon-signal text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.2)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-sophon-signal-bright" disabled={!canSend} size="icon" type="submit">
                      <SendHorizontal aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex justify-between gap-4 px-1 font-mono text-[10px] uppercase tracking-wider text-white/25" id="prompt-help">
                  <span>Enter to send · Shift+Enter for a new line</span><span className="shrink-0 tabular-nums">{prompt.length} chars</span>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function GreekGlyph({ children, className }: { children: string; className?: string }) {
  return <span aria-hidden="true" className={cn("font-serif text-base leading-none", className)}>{children}</span>;
}

function getRuntimeStatus(capabilities: RuntimeCapabilities | null, model: ModelManifest) {
  if (!capabilities) {
    return { label: "Probing runtime", className: "text-white/45", dotClassName: "bg-white/35" };
  }
  if (capabilities.webgpu && model.providers.includes("webgpu")) {
    return { label: "WebGPU online", className: "text-sophon-verified", dotClassName: "bg-sophon-verified shadow-[0_0_10px_var(--sophon-verified)]" };
  }
  if (capabilities.wasm && model.providers.includes("wasm")) {
    return { label: "WASM fallback", className: "text-sophon-warning", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
  }
  return { label: "Provider unavailable", className: "text-destructive", dotClassName: "bg-destructive" };
}

function formatRate(value: number | null) {
  return value === null ? "decode rate pending" : `${value.toFixed(1)} decode tok/s`;
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}
