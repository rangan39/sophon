"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { CircleUserRound, LoaderCircle, Menu, MessageSquareText, PanelLeft, Plus, SendHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_ONNX_MODEL, MODEL_REGISTRY } from "@/lib/onnx-models";
import { MAX_PROMPT_CHARS, runPrompt } from "@/lib/interp-client";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta?: string;
};

function GreekGlyph({ children, className = "" }: { children: string; className?: string }) {
  return <span aria-hidden="true" className={`font-serif text-base leading-none ${className}`}>{children}</span>;
}

const starterMessages: ChatMessage[] = [
  {
    id: 1,
    role: "assistant",
    content: "Hi — I’m Sophon. Ask me something and I’ll run it through the local model in your browser.",
    meta: "Ready locally",
  },
];

export function SophonWorkbench() {
  const [messages, setMessages] = useState(starterMessages);
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_ONNX_MODEL.id);
  const selectedModel = MODEL_REGISTRY.find((model) => model.id === modelId) ?? DEFAULT_ONNX_MODEL;

  const canSend = prompt.trim().length > 0 && !isRunning;

  function resetChat() {
    setMessages(starterMessages);
    setPrompt("");
    setError(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }

  async function submitPrompt(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || isRunning) return;

    setPrompt("");
    setError(null);
    setIsRunning(true);
    setMessages((current) => [...current, { id: Date.now(), role: "user", content: text }]);

    try {
      const response = await runPrompt(text, { modelId, maxNewTokens: 48, temperature: 0.8 });
      if (!response.ok) {
        setError(response.message);
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: response.result.generatedText || "The model returned an empty response.",
          meta: `${response.result.tokensPerSecond.toFixed(1)} tok/s · ${response.result.elapsedMs} ms`,
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The local model could not run.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="relative h-svh w-full overflow-hidden bg-[#090a0d] text-[#f4f0e9]">
      <div className="sophon-noise pointer-events-none absolute inset-0" />
      <div className="sophon-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative flex h-svh w-full flex-col bg-[#0b0c10]/80 backdrop-blur-sm">
        <header className="flex h-[74px] items-center justify-between border-b border-white/[.08] bg-[#0b0c10]/90 px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <Button aria-label="Open menu" className="text-white/60 hover:bg-white/[.06] hover:text-white sm:hidden" size="icon" variant="ghost"><PanelLeft className="size-4" /></Button>
            <div className="relative grid size-9 place-items-center rounded-md border border-[#ff694b]/50 bg-[#ff4d2e] text-[#210b07] shadow-[0_0_30px_rgb(255_77_46/.16)]"><GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph><span className="absolute -right-1 -top-1 size-2 rounded-full bg-[#ffc857] shadow-[0_0_12px_#ffc857]" /></div>
            <div>
              <div className="flex items-center gap-2"><h1 className="font-mono text-sm font-semibold tracking-[0.12em] text-white">SOPHON</h1><Badge className="border-[#ff694b]/30 bg-[#ff4d2e]/10 font-mono text-[9px] uppercase tracking-widest text-[#ff9d87]" variant="outline">Local AI</Badge></div>
              <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 sm:block">Private inference console</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#7df0a8] sm:flex"><span className="size-1.5 rounded-full bg-[#7df0a8] shadow-[0_0_10px_#7df0a8]" />WebGPU online</div>
            <Select disabled={isRunning} onValueChange={setModelId} value={modelId}>
            <SelectTrigger aria-label="Choose model" className="h-7 w-[132px] border-white/[.12] bg-white/[.045] px-2 font-mono text-[9px] uppercase tracking-wide text-white/75 shadow-none hover:border-[#ff694b]/50 sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODEL_REGISTRY.map((model) => <SelectItem key={model.id} value={model.id}><span className="flex items-center justify-between gap-5"><span>{model.label}</span><span className="text-[10px] text-muted-foreground">{model.sizeLabel}</span></span></SelectItem>)}
            </SelectContent>
            </Select>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] max-[700px]:grid-cols-1">
          <aside className="border-r border-white/[.08] bg-[#0a0b0e]/70 p-4 max-[700px]:hidden">
            <Button className="h-11 w-full justify-start gap-2 border-white/[.12] bg-white/[.045] font-mono text-xs text-white hover:border-[#ff694b]/50 hover:bg-[#ff4d2e]/10" onClick={resetChat} variant="outline"><Plus className="size-4 text-[#ff795d]" />New session <span className="ml-auto text-[10px] text-white/25">⌘ N</span></Button>
            <div className="mt-9 flex items-center justify-between px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35"><span>Sessions</span><span className="text-white/20">01</span></div>
            <div className="mt-3 rounded-md border border-[#ff694b]/25 bg-[#ff4d2e]/[.08] px-3 py-3 shadow-[inset_3px_0_0_#ff4d2e]">
              <div className="flex items-center gap-2 text-xs font-medium text-white"><span className="size-1.5 rounded-full bg-[#ff694b]" />Getting started</div>
              <p className="mt-1 pl-3.5 text-[11px] text-white/35">Active now</p>
            </div>
            <Card className="mt-auto hidden border-white/[.08] bg-white/[.025] p-3 text-xs leading-5 text-white/45 min-[701px]:block">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/60"><span className="size-1.5 rounded-full bg-[#7df0a8]" />Device runtime</div>
              <p className="font-medium text-white/80">{selectedModel.label}</p>
              <p className="mt-1">{selectedModel.description}</p>
              <div className="mt-3 flex justify-between border-t border-white/[.08] pt-3 font-mono text-[10px] uppercase text-white/30"><span>Provider</span><span className="text-[#7df0a8]">WebGPU</span></div>
            </Card>
          </aside>

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-4 sm:px-12 sm:py-7">
                <div>
                  <div className="mb-3 flex items-center justify-between border-b border-white/[.08] pb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35"><span>Transmission log</span><span className="text-[#7df0a8]">Channel open</span></div>
                  <div className="flex items-center justify-between gap-5"><div><h2 className="font-mono text-xs font-medium uppercase tracking-[0.22em] text-white/70">Conversation buffer</h2><p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-white/25">{selectedModel.family} / {selectedModel.label} / WebGPU</p></div><div className="hidden size-12 items-center justify-center rounded-md border border-[#ff694b]/20 bg-[#ff4d2e]/[.04] text-[#ff795d] sm:flex"><MessageSquareText className="size-5" /></div></div>
                </div>

                <div className="mt-3 space-y-6">
                  {messages.map((message) => (
                    <Message align={message.role === "user" ? "end" : "start"} key={message.id}>
                      <MessageAvatar className={message.role === "user" ? "rounded-md border border-[#ff694b]/40 bg-[#ff4d2e] text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.12)]" : "rounded-md border border-white/[.12] bg-white/[.06] text-[#ff795d]"}>
                        {message.role === "user" ? <CircleUserRound className="size-4" /> : <GreekGlyph className="text-lg font-semibold">Σ</GreekGlyph>}
                      </MessageAvatar>
                      <MessageContent className="max-w-[min(920px,calc(100%-3rem))]">
                        <Bubble align={message.role === "user" ? "end" : "start"} variant={message.role === "user" ? "default" : "muted"}>
                          <BubbleContent className={message.role === "user" ? "rounded-md border-[#ff694b]/30 bg-[#ff4d2e] font-medium text-[#210b07]" : "rounded-md border-white/[.08] bg-white/[.055] text-white/80"}>{message.content}</BubbleContent>
                        </Bubble>
                        {message.meta ? <span className="px-1 text-xs text-muted-foreground">{message.meta}</span> : null}
                      </MessageContent>
                    </Message>
                  ))}
                  {isRunning ? <Message><MessageAvatar><GreekGlyph className="animate-pulse text-lg font-semibold">Σ</GreekGlyph></MessageAvatar><MessageContent><Bubble variant="muted"><BubbleContent><LoaderCircle className="size-4 animate-spin" /></BubbleContent></Bubble></MessageContent></Message> : null}
                </div>
              </div>
            </ScrollArea>

            <div className="border-t border-white/[.08] bg-[#0b0c10]/90 p-4 backdrop-blur-xl sm:p-6">
              <form className="mx-auto max-w-6xl" onSubmit={submitPrompt}>
                {error ? <div className="mb-3 rounded-md border border-[#ff5f63]/30 bg-[#ff5f63]/10 px-3 py-2 text-sm text-[#ff9a9d]">{error}</div> : null}
                <div className="relative rounded-md border border-white/[.14] bg-[#111319] shadow-[0_15px_60px_rgb(0_0_0/.28)] transition-colors focus-within:border-[#ff694b]/60 focus-within:shadow-[0_0_0_3px_rgb(255_77_46/.1),0_15px_60px_rgb(0_0_0/.28)]">
                  <Textarea aria-label="Message Sophon" className="min-h-24 resize-none border-0 bg-transparent pr-14 text-[15px] leading-6 text-white shadow-none placeholder:text-white/25 focus-visible:ring-0" maxLength={MAX_PROMPT_CHARS} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask the local model anything..." value={prompt} />
                  <div className="flex items-center justify-between border-t border-white/[.07] px-3 py-2"><span className="font-mono text-[10px] uppercase tracking-widest text-white/25">{selectedModel.family} · {selectedModel.sizeLabel}</span><Button aria-label="Send message" className="size-8 rounded-lg bg-[#ff4d2e] text-[#210b07] shadow-[0_0_20px_rgb(255_77_46/.2)] hover:bg-[#ff694b]" disabled={!canSend} size="icon" type="submit"><SendHorizontal className="size-4" /></Button></div>
                </div>
                <div className="mt-3 flex justify-between px-1 font-mono text-[10px] uppercase tracking-wider text-white/25"><span>Enter to send · Shift + Enter for newline</span><span>{prompt.length}/{MAX_PROMPT_CHARS}</span></div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
