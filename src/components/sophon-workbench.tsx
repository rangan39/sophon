"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Check, CircleUserRound, Copy, LoaderCircle, Pencil, Plus, RotateCcw, SendHorizontal, Square } from "lucide-react";
import { SophonModelSelector } from "@/components/sophon-model-selector";
import { InspectableMessage, type InspectableToken } from "@/components/token-lens";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { cancelGeneration, getCapabilities, preloadModel, runPrompt, terminateRuntimeWorker } from "@/lib/interp-client";
import { DEFAULT_ONNX_MODEL, MODEL_REGISTRY, resolveModelProvider, type ModelManifest } from "@/lib/onnx-models";
import type { GenerationTelemetryEvent, OnnxLogEvent, RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
  tokens?: InspectableToken[];
};

type RuntimeActivity = {
  detail?: string;
  label: string;
  phase: "download" | "runtime" | "tokenize" | "prefill" | "decode" | "complete";
};

type FailedTurn = {
  messageId: string;
  reason: string;
  text: string;
};

type GenerationState =
  | { status: "idle" }
  | { status: "loading"; activity: RuntimeActivity }
  | { status: "running"; activity: RuntimeActivity; turn: Omit<FailedTurn, "reason"> };
type BrowserStorage = StorageEstimate & { persistent: boolean };

const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "Hi — I’m Sophon. Your prompts run in this browser. Tiny GPT-2 is a verified completion baseline; choose an instruct model for conversational tasks.",
    meta: "Local by design · no server inference"
  }
];

export function SophonWorkbench() {
  const [messages, setMessages] = useState(STARTER_MESSAGES);
  const [prompt, setPrompt] = useState("");
  const [generation, setGeneration] = useState<GenerationState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_ONNX_MODEL.id);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorage | null>();
  const generationIdRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = generation.status === "running";
  const isBusy = generation.status !== "idle";
  const runtimeActivity = generation.status === "idle" ? null : generation.activity;
  const selectedModel = MODEL_REGISTRY.find((model) => model.id === modelId) ?? DEFAULT_ONNX_MODEL;
  const modelCompatibility = getModelCompatibility(capabilities, selectedModel);
  const runtimeStatus = getRuntimeStatus(capabilities, selectedModel, loadedModelId, runtimeActivity);
  const storageLabel = browserStorage === undefined ? "Checking…" : browserStorage === null ? "Unavailable" : `${formatStorageBytes(browserStorage.usage)} / ${formatStorageBytes(browserStorage.quota)} · ${browserStorage.persistent ? "Persistent" : "Best effort"}`;
  const canSend = prompt.trim().length > 0 && !isBusy && modelCompatibility === "compatible";

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
    let active = true;
    const manager = navigator.storage;
    const estimate = manager?.estimate ? manager.estimate() : Promise.resolve(null);
    void Promise.all([estimate, manager?.persisted?.() ?? false])
      .then(([storage, persistent]) => { if (active) setBrowserStorage(storage ? { ...storage, persistent } : null); })
      .catch(() => { if (active) setBrowserStorage(null); });
    return () => { active = false; };
  }, [loadedModelId]);

  useEffect(() => {
    if (!capabilities || !resolveModelProvider(selectedModel, capabilities)) return;
    const loadId = generationIdRef.current += 1;
    queueMicrotask(() => {
      if (generationIdRef.current === loadId) setGeneration({ status: "loading", activity: { detail: `${selectedModel.label} · ${selectedModel.format.sizeLabel}`, label: "Preparing local model", phase: "runtime" } });
    });
    void preloadModel(selectedModel.id, (event) => {
      if (generationIdRef.current === loadId) setGeneration((current) => current.status === "loading" ? { ...current, activity: activityFromLog(event) } : current);
    }).then(() => {
      if (generationIdRef.current === loadId) setLoadedModelId(selectedModel.id);
    }).catch((caught) => {
      if (generationIdRef.current === loadId) setError(caught instanceof Error ? caught.message : `${selectedModel.label} could not load.`);
    }).finally(() => {
      if (generationIdRef.current === loadId) setGeneration({ status: "idle" });
    });
    return () => {
      if (generationIdRef.current === loadId) generationIdRef.current += 1;
      terminateRuntimeWorker();
    };
  }, [capabilities, selectedModel]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messageEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [isRunning, messages]);

  useEffect(() => () => {
    generationIdRef.current += 1;
    terminateRuntimeWorker();
  }, []);

  function resetChat() {
    generationIdRef.current += 1;
    if (isRunning) {
      void cancelGeneration().catch(() => terminateRuntimeWorker());
    }
    setMessages(STARTER_MESSAGES);
    setPrompt("");
    setError(null);
    setFailedTurn(null);
    setGeneration({ status: "idle" });
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function selectModel(nextModelId: string) {
    if (nextModelId === modelId) return;
    generationIdRef.current += 1;
    terminateRuntimeWorker();
    setModelId(nextModelId);
    setLoadedModelId(null);
    setError(null);
    setFailedTurn(null);
    setGeneration({ status: "idle" });
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
    if (!text || isBusy) return;

    if (modelCompatibility !== "compatible") {
      setError(modelCompatibility === "probing"
        ? "Sophon is still checking this browser's local runtime."
        : `${selectedModel.label} is not compatible with an available provider in this browser.`);
      return;
    }

    const generationId = generationIdRef.current += 1;
    const userMessageId = `user-${generationId}`;
    const nextMessages = [...messages, { id: userMessageId, role: "user" as const, content: text }];
    setPrompt("");
    setError(null);
    setFailedTurn(null);
    setMessages(nextMessages);
    await runGeneration({ conversation: nextMessages, generationId, text, userMessageId });
  }

  async function runGeneration({ conversation, generationId, text, userMessageId }: {
    conversation: ChatMessage[];
    generationId: number;
    text: string;
    userMessageId: string;
  }) {
    setGeneration({
      status: "running",
      turn: { messageId: userMessageId, text },
      activity: {
        detail: loadedModelId === modelId ? "Preparing the conversation context" : `${selectedModel.label} · ${selectedModel.format.sizeLabel}`,
        label: loadedModelId === modelId ? "Preparing context" : "Preparing local model",
        phase: "runtime"
      }
    });

    const turns = conversation
      .filter((message) => message.id !== "assistant-welcome")
      .map(({ content, role }) => ({ content, role }));

    try {
      const response = await runPrompt(turns, {
        modelId,
        maxNewTokens: 48,
        onLog: (event) => updateRuntimeFromLog(generationId, event),
        onTelemetry: (telemetry) => updateRuntimeFromTelemetry(generationId, telemetry),
        temperature: 0.8
      });
      if (generationIdRef.current !== generationId) return;
      if (!response.ok) {
        setError(response.message);
        setFailedTurn({ messageId: userMessageId, reason: response.message, text });
        return;
      }

      const metrics = response.result.metrics;
      const conversationWithTokens = conversation.map((message) => message.id === userMessageId
        ? { ...message, tokens: response.result.inputTokens }
        : message);
      setLoadedModelId(modelId);
      if (!response.result.generatedText.trim()) {
        const reason = "The model completed without returning visible text.";
        setMessages(conversationWithTokens);
        setError(reason);
        setFailedTurn({ messageId: userMessageId, reason, text });
        return;
      }
      setMessages([
        ...conversationWithTokens,
        {
          id: `assistant-${generationId}`,
          role: "assistant",
          content: response.result.generatedText,
          tokens: response.result.generatedTokens,
          meta: `${metrics.provider} · ${metrics.contextTokenCount}${metrics.truncatedInputTokens ? `/${metrics.promptTokenCount}` : ""}→${response.result.outputTokenCount} tok · ${formatRate(metrics.decodeTokensPerSecond)} · ${formatDuration(metrics.ttftMs)} TTFT${metrics.truncatedInputTokens ? ` · ${metrics.truncatedInputTokens} earlier tok omitted` : ""}`
        }
      ]);
    } catch (caught) {
      if (generationIdRef.current !== generationId) return;
      const reason = caught instanceof Error ? caught.message : "The local model could not run.";
      setError(reason);
      setFailedTurn({ messageId: userMessageId, reason, text });
    } finally {
      if (generationIdRef.current === generationId) {
        setGeneration({ status: "idle" });
      }
    }
  }

  function updateRuntimeFromLog(generationId: number, event: OnnxLogEvent) {
    if (generationIdRef.current !== generationId) return;
    setGeneration((current) => current.status === "running" ? { ...current, activity: activityFromLog(event) } : current);
  }

  function updateRuntimeFromTelemetry(generationId: number, telemetry: GenerationTelemetryEvent) {
    if (generationIdRef.current !== generationId) return;
    setGeneration((current) => current.status === "running" ? { ...current, activity: activityFromTelemetry(telemetry) } : current);
  }

  function stopGeneration() {
    if (generation.status !== "running") return;
    const pendingTurn = generation.turn;

    generationIdRef.current += 1;
    void cancelGeneration().catch(() => {
      terminateRuntimeWorker();
      setLoadedModelId(null);
    });
    setGeneration({ status: "idle" });
    setError("Generation stopped. Your message is ready to retry or edit.");
    setFailedTurn({ ...pendingTurn, reason: "Generation stopped." });
  }

  function retryFailedTurn() {
    if (!failedTurn || isBusy || modelCompatibility !== "compatible") return;
    const generationId = generationIdRef.current += 1;
    setError(null);
    setFailedTurn(null);
    void runGeneration({ conversation: messages, generationId, text: failedTurn.text, userMessageId: failedTurn.messageId });
  }

  function editFailedTurn() {
    if (!failedTurn || isBusy) return;
    const failedIndex = messages.findIndex((message) => message.id === failedTurn.messageId);
    setMessages(failedIndex >= 0 ? messages.slice(0, failedIndex) : messages);
    setPrompt(failedTurn.text);
    setError(null);
    setFailedTurn(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function editMessage(message: ChatMessage, index: number) {
    if (isBusy || message.role !== "user") return;
    setMessages(messages.slice(0, index));
    setPrompt(message.content);
    setError(null);
    setFailedTurn(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function regenerateLatest(assistantIndex: number) {
    if (isBusy || modelCompatibility !== "compatible") return;
    const userIndex = messages.slice(0, assistantIndex).findLastIndex((message) => message.role === "user");
    const userMessage = messages[userIndex];
    if (!userMessage) return;
    const conversation = messages.slice(0, assistantIndex);
    const generationId = generationIdRef.current += 1;
    setMessages(conversation);
    setError(null);
    setFailedTurn(null);
    void runGeneration({ conversation, generationId, text: userMessage.content, userMessageId: userMessage.id });
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setError("The message could not be copied to the clipboard.");
    }
  }

  return (
    <main className="relative h-svh w-full overflow-hidden bg-sophon-canvas text-foreground" data-inference={isBusy ? "active" : "idle"}>
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className="relative flex h-svh w-full flex-col bg-transparent">
        <header className="sophon-glass-strong z-20 flex h-[calc(74px+env(safe-area-inset-top))] shrink-0 items-center justify-between border-x-0 border-t-0 px-4 pt-[env(safe-area-inset-top)] sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-sophon-signal-bright/60 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_34px_rgb(255_77_46/.24)]">
              <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>
              <span aria-hidden="true" className="absolute -right-1 -top-1 size-2 rounded-full bg-sophon-warning shadow-[0_0_12px_var(--sophon-warning)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-white">SOPHON</h1>
                <span className="hidden items-center rounded-md border border-sophon-signal-bright/35 bg-sophon-signal/15 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-widest text-[#ffb4a4] min-[360px]:inline-flex">Local AI</span>
              </div>
              <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-white/60 sm:block">Private inference console</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={cn("sophon-glass-tile hidden items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest sm:flex", runtimeStatus.className)}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", runtimeStatus.dotClassName)} />
              {runtimeStatus.label}
            </div>
            <Button aria-label="New session" className="hidden rounded-xl sm:inline-flex" disabled={isBusy} onClick={resetChat} size="sm" type="button" variant="sophon">
              <Plus aria-hidden="true" /> New session
            </Button>
            <SophonModelSelector capabilities={capabilities} disabled={isRunning} loading={generation.status === "loading"} modelId={modelId} onSelect={selectModel} />
          </div>
        </header>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">{runtimeActivity?.label ?? ""}</div>

        <div className="min-h-0 flex-1">
          <section aria-busy={isBusy} aria-label="Conversation" className="relative flex h-full min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex min-w-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-12 sm:py-9">
                <div aria-live={isRunning ? "off" : "polite"} aria-relevant="additions text" className="min-w-0 space-y-6" role="log">
                  {messages.map((message, index) => (
                    <Message align={message.role === "user" ? "end" : "start"} aria-label={message.role === "user" ? "Message from you" : "Message from Sophon"} key={message.id} role="article">
                      <MessageAvatar className={message.role === "user" ? "!self-start mt-1 rounded-xl border border-sophon-signal-bright/50 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.16)]" : "sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft"}>
                        {message.role === "user" ? <CircleUserRound aria-hidden="true" className="size-4" /> : <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>}
                      </MessageAvatar>
                      <MessageContent className="w-full max-w-[calc(100%_-_2.75rem)] sm:max-w-[min(920px,calc(100%_-_3rem))]">
                        <InspectableMessage content={message.content} meta={message.meta} role={message.role} tokens={message.tokens} />
                        <MessageActions
                          canEdit={!isBusy && message.role === "user" && message.id !== "assistant-welcome"}
                          canRegenerate={!isBusy && message.role === "assistant" && index === messages.length - 1 && index > 0}
                          copied={copiedMessageId === message.id}
                          onCopy={() => void copyMessage(message)}
                          onEdit={() => editMessage(message, index)}
                          onRegenerate={() => regenerateLatest(index)}
                          role={message.role}
                        />
                      </MessageContent>
                    </Message>
                  ))}
                  {isRunning ? (
                    <Message aria-label={`Sophon status: ${runtimeActivity?.label ?? "Generating response"}`} aria-live="off" role="article">
                      <MessageAvatar className="sophon-glass-tile !self-start mt-1 rounded-xl text-sophon-signal-soft"><GreekGlyph className="animate-pulse text-lg font-semibold motion-reduce:animate-none">Σ</GreekGlyph></MessageAvatar>
                      <MessageContent className="w-full max-w-[calc(100%_-_2.75rem)] sm:max-w-xl">
                        <Bubble className="w-full max-w-full" variant="muted">
                          <BubbleContent className="sophon-glass-tile flex w-full items-center gap-3 rounded-xl px-4 py-3">
                            <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-sophon-signal-soft motion-reduce:animate-none" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-white/90">{runtimeActivity?.label ?? "Generating response"}</span>
                              {runtimeActivity?.detail ? <span className="mt-0.5 block truncate text-xs text-white/60">{runtimeActivity.detail}</span> : null}
                            </span>
                            <Button aria-label="Stop generation" className="shrink-0" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                              <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                            </Button>
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  ) : null}
                  <div aria-hidden="true" ref={messageEndRef} />
                </div>
              </div>
            </div>

            <div className="sophon-glass-strong z-10 shrink-0 border-x-0 border-b-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {failedTurn ? (
                  <div className="sophon-glass-tile mb-3 flex flex-col gap-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-[#ffb4b7] sm:flex-row sm:items-center" id="prompt-error" role="alert">
                    <span className="min-w-0 flex-1">{failedTurn.reason}</span>
                    <span className="flex shrink-0 gap-2">
                      <Button disabled={modelCompatibility !== "compatible"} onClick={retryFailedTurn} size="sm" type="button" variant="sophon"><RotateCcw aria-hidden="true" /> Retry</Button>
                      <Button onClick={editFailedTurn} size="sm" type="button" variant="sophon"><Pencil aria-hidden="true" /> Edit</Button>
                    </span>
                  </div>
                ) : error ? <div className="sophon-glass-tile mb-3 rounded-xl border-destructive/35 px-4 py-3 text-sm text-[#ffb4b7]" id="prompt-error" role="alert">{error}</div> : null}
                <label className="sr-only" htmlFor="sophon-prompt">Message Sophon</label>
                <div className="sophon-glass-tile sophon-glass-interactive relative overflow-hidden rounded-2xl">
                  <textarea
                    aria-describedby="prompt-help"
                    className="flex min-h-24 w-full resize-none rounded-md border-0 bg-transparent px-3 py-2 pr-14 text-[15px] leading-6 text-white shadow-none placeholder:text-white/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    id="sophon-prompt"
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask the local model anything..."
                    ref={promptRef}
                    value={prompt}
                  />
                  <div className="flex items-center justify-between border-t border-white/[.1] bg-black/10 px-3 py-2">
                    <span className="truncate pr-3 font-mono text-[10px] uppercase tracking-widest text-white/60">{selectedModel.family} · {selectedModel.format.quantization} · {selectedModel.format.sizeLabel}</span>
                    {isRunning ? (
                      <Button aria-label="Stop generation" className="h-10 shrink-0 rounded-xl" onClick={stopGeneration} size="sm" type="button" variant="sophon">
                        <Square aria-hidden="true" className="size-3 fill-current" /> Stop
                      </Button>
                    ) : (
                      <Button aria-label="Send message" className="relative size-10 shrink-0 rounded-xl bg-gradient-to-br from-sophon-signal-bright to-sophon-signal text-[#210b07] shadow-[0_0_24px_rgb(255_77_46/.28)] after:absolute after:-inset-1 after:content-[''] hover:from-[#ff8068] hover:to-sophon-signal-bright" disabled={!canSend} size="icon" type="submit">
                        <SendHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex justify-between gap-4 px-1 font-mono text-[10px] uppercase tracking-wider text-white/60" id="prompt-help">
                  <span className={cn(modelCompatibility === "incompatible" && "text-destructive")}>
                    {modelCompatibility === "probing" ? "Checking local runtime…" : modelCompatibility === "incompatible" ? "Selected model is unavailable in this browser" : <><span className="min-[360px]:hidden">Enter to send</span><span className="hidden min-[360px]:inline">Enter to send · Shift+Enter for a new line</span></>}
                  </span>
                  <span className="shrink-0 tabular-nums">{prompt.length} chars</span>
                </div>
                <p className="mt-2 truncate px-1 text-right font-mono text-[10px] uppercase tracking-wider text-white/50" data-state={browserStorage === undefined ? "checking" : browserStorage === null ? "unavailable" : "ready"} data-testid="browser-storage" title="Approximate Sophon site usage / browser-managed quota, including cached models.">
                  Browser storage · <span className="tabular-nums text-white/70">{storageLabel}</span>
                </p>
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

function MessageActions({ canEdit, canRegenerate, copied, onCopy, onEdit, onRegenerate, role }: {
  canEdit: boolean;
  canRegenerate: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  role: ChatMessage["role"];
}) {
  return (
    <div className={cn(
      "flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-focus-within/message:opacity-100 sm:group-hover/message:opacity-100",
      role === "user" ? "self-end" : "self-start"
    )}>
      <Button aria-label={copied ? "Copied message" : "Copy message"} className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onCopy} size="icon" type="button" variant="sophon">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {canEdit ? (
        <Button aria-label="Edit message" className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onEdit} size="icon" type="button" variant="sophon">
          <Pencil aria-hidden="true" />
        </Button>
      ) : null}
      {canRegenerate ? (
        <Button aria-label="Regenerate response" className="size-11 rounded-xl text-white/70 sm:size-9" onClick={onRegenerate} size="icon" type="button" variant="sophon">
          <RotateCcw aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function getModelCompatibility(capabilities: RuntimeCapabilities | null, model: ModelManifest) {
  if (!capabilities) return "probing" as const;
  return resolveModelProvider(model, capabilities) ? "compatible" as const : "incompatible" as const;
}

function getRuntimeStatus(
  capabilities: RuntimeCapabilities | null,
  model: ModelManifest,
  loadedModelId: string | null,
  activity: RuntimeActivity | null
) {
  if (activity) {
    return { label: activity.label, className: "text-[#dbe7ff]", dotClassName: "bg-sophon-signal-soft shadow-[0_0_10px_var(--sophon-signal-soft)]" };
  }
  if (!capabilities) {
    return { label: "Checking runtime", className: "text-white/70", dotClassName: "animate-pulse bg-white/60 motion-reduce:animate-none" };
  }
  if (getModelCompatibility(capabilities, model) === "incompatible") {
    return { label: "Model unavailable", className: "text-destructive", dotClassName: "bg-destructive" };
  }
  if (loadedModelId === model.id) {
    return { label: "Model ready", className: "text-sophon-verified", dotClassName: "bg-sophon-verified shadow-[0_0_10px_var(--sophon-verified)]" };
  }
  return { label: "Available · not loaded", className: "text-white/70", dotClassName: "bg-sophon-warning shadow-[0_0_10px_var(--sophon-warning)]" };
}

function activityFromLog(event: OnnxLogEvent): RuntimeActivity {
  const phase = event.phase === "download"
    ? "download"
    : event.phase === "tokenize"
      ? "tokenize"
      : event.phase === "inference" || event.phase === "generate"
        ? "decode"
        : "runtime";
  const label = phase === "download"
    ? "Downloading model"
    : phase === "tokenize"
      ? "Tokenizing context"
      : phase === "decode"
        ? "Running local inference"
        : event.message || "Initializing runtime";
  return { detail: event.detail, label, phase };
}

function activityFromTelemetry(telemetry: GenerationTelemetryEvent): RuntimeActivity {
  if (telemetry.phase === "prefill") {
    return { detail: `${telemetry.contextTokenCount} context tokens`, label: "Prefilling context", phase: "prefill" };
  }
  if (telemetry.phase === "decode") {
    return {
      detail: `${telemetry.outputTokenCount} generated · ${formatRate(telemetry.decodeTokensPerSecond)}`,
      label: "Generating response",
      phase: "decode"
    };
  }
  return {
    detail: `${telemetry.outputTokenCount} tokens generated`,
    label: "Finalizing response",
    phase: "complete"
  };
}

function formatRate(value: number | null) {
  return value === null ? "decode rate pending" : `${value.toFixed(1)} decode tok/s`;
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatStorageBytes(bytes?: number) {
  if (bytes === undefined) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const rank = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** rank;
  return `${value.toFixed(rank > 0 && value < 10 ? 1 : 0)} ${units[rank] ?? "TB"}`;
}
