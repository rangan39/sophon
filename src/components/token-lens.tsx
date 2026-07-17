"use client";

import { useMemo, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { groupTokenPieces, type ContextTokenPiece, type TokenWord } from "@/lib/token-display";
import { cn } from "@/lib/utils";

export type InspectableToken = ContextTokenPiece;

type TokenMode = "text" | "tokens" | "words";
type TokenSelection =
  | { kind: "token"; index: number; token: InspectableToken }
  | { kind: "word"; index: number; word: TokenWord }
  | null;

type InspectableMessageProps = {
  content: string;
  meta?: string;
  role: "user" | "assistant";
  tokens?: InspectableToken[];
};

export function InspectableMessage({ content, meta, role, tokens = [] }: InspectableMessageProps) {
  const [mode, setMode] = useState<TokenMode>("text");
  const [selection, setSelection] = useState<TokenSelection>(null);
  const words = useMemo(() => groupTokenPieces(tokens), [tokens]);
  const hasTokens = tokens.length > 0;

  function changeMode(nextMode: TokenMode) {
    setMode(nextMode);
    setSelection(null);
  }

  return (
    <div className={cn("flex max-w-full flex-col gap-2", role === "user" ? "items-end" : "items-start")}>
      <Bubble align={role === "user" ? "end" : "start"} variant={role === "user" ? "default" : "muted"}>
        <BubbleContent className={cn("whitespace-pre-wrap break-words", role === "user" ? "rounded-md border-sophon-signal-bright/30 bg-sophon-signal font-medium text-[#210b07]" : "rounded-md border-white/[.08] bg-white/[.055] text-white/80")}>
          {mode === "tokens" && hasTokens ? (
            <TokenSequence role={role} selection={selection} setSelection={setSelection} tokens={tokens} />
          ) : mode === "words" && hasTokens ? (
            <WordSequence role={role} selection={selection} setSelection={setSelection} words={words} />
          ) : (
            content
          )}
        </BubbleContent>
      </Bubble>

      {(meta || hasTokens) ? (
        <div className={cn("flex max-w-full items-center gap-2 px-1", role === "user" && "flex-row-reverse")}>
          {meta ? <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span> : null}
          {hasTokens ? <TokenModeControl mode={mode} onChange={changeMode} /> : null}
        </div>
      ) : null}

      {mode !== "text" && hasTokens ? (
        <TokenInspector role={role} selection={selection} tokenCount={tokens.length} />
      ) : null}
    </div>
  );
}

function TokenModeControl({ mode, onChange }: { mode: TokenMode; onChange: (mode: TokenMode) => void }) {
  return (
    <div aria-label="Message display granularity" className="flex shrink-0 items-center border border-white/[.09] bg-black/20 p-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-white/35" role="group">
      <span aria-hidden="true" className="px-1.5 font-serif text-[11px] normal-case tracking-normal text-sophon-signal-soft">τ</span>
      {(["text", "tokens", "words"] as const).map((option) => (
        <button
          aria-pressed={mode === option}
          className={cn("min-h-6 px-1.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning", mode === option ? "bg-white/[.09] text-white/80" : "hover:bg-white/[.05] hover:text-white/60")}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function TokenSequence({ role, selection, setSelection, tokens }: {
  role: InspectableMessageProps["role"];
  selection: TokenSelection;
  setSelection: (selection: TokenSelection) => void;
  tokens: InspectableToken[];
}) {
  return (
    <span aria-label={tokens.map((token) => token.text).join("")} className="whitespace-pre-wrap break-words">
      {tokens.map((token, index) => {
        const selected = selection?.kind === "token" && selection.index === index;
        const omitted = token.inContext === false;
        return (
          <button
            aria-label={`Token ${index + 1}, ID ${token.id}: ${describeToken(token.text)}${omitted ? ", omitted from active context" : ""}`}
            aria-pressed={selected}
            className={cn("inline cursor-crosshair whitespace-pre-wrap border-l border-dotted border-sophon-verified p-0 font-inherit text-inherit transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sophon-warning", segmentClass(role, selected), omitted && "opacity-35")}
            data-context={omitted ? "omitted" : "active"}
            data-token-id={token.id}
            key={`${index}-${token.id}`}
            onClick={() => setSelection({ kind: "token", index, token })}
            onFocus={() => setSelection({ kind: "token", index, token })}
            onMouseEnter={() => setSelection({ kind: "token", index, token })}
            type="button"
          >
            {token.text || <span aria-hidden="true">∅</span>}
          </button>
        );
      })}
    </span>
  );
}

function WordSequence({ role, selection, setSelection, words }: {
  role: InspectableMessageProps["role"];
  selection: TokenSelection;
  setSelection: (selection: TokenSelection) => void;
  words: TokenWord[];
}) {
  return (
    <span aria-label={words.map((word) => word.text).join("")} className="whitespace-pre-wrap break-words">
      {words.map((word, index) => {
        const selected = selection?.kind === "word" && selection.index === index;
        return (
          <button
            aria-label={`Word segment ${index + 1}, tokens ${word.tokenIndexes.map((tokenIndex) => tokenIndex + 1).join(" through ")}: ${describeToken(word.text)}`}
            aria-pressed={selected}
            className={cn("inline cursor-crosshair whitespace-pre-wrap border-l border-dotted border-sophon-verified p-0 font-inherit text-inherit transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sophon-warning", segmentClass(role, selected), !word.inContext && "opacity-35")}
            key={`${index}-${word.tokenIds.join("-")}`}
            onClick={() => setSelection({ kind: "word", index, word })}
            onFocus={() => setSelection({ kind: "word", index, word })}
            onMouseEnter={() => setSelection({ kind: "word", index, word })}
            type="button"
          >
            {word.text || <span aria-hidden="true">∅</span>}
          </button>
        );
      })}
    </span>
  );
}

function TokenInspector({ role, selection, tokenCount }: {
  role: InspectableMessageProps["role"];
  selection: TokenSelection;
  tokenCount: number;
}) {
  const details = selectionDetails(selection, role);
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 border border-white/[.08] bg-sophon-panel-deep/90 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
      {details ? (
        <>
          <span className="text-sophon-signal-soft">{details.index}</span>
          <span className="text-white/20">/</span>
          <span>{details.ids}</span>
          <span className="text-white/20">/</span>
          <span className="max-w-52 truncate normal-case tracking-normal text-white/70">“{details.text}”</span>
          <span className="text-white/20">/</span>
          <span className={details.active ? "text-sophon-verified" : "text-sophon-warning"}>{details.active ? "active context" : "windowed out"}</span>
        </>
      ) : (
        <><span className="font-serif text-[11px] normal-case text-sophon-signal-soft">τ</span><span>Select a segment</span><span className="ml-auto tabular-nums text-white/20">{tokenCount} tok</span></>
      )}
    </div>
  );
}

function selectionDetails(selection: TokenSelection, role: InspectableMessageProps["role"]) {
  if (!selection) return null;
  if (selection.kind === "token") {
    return {
      index: `τ${selection.index + 1}`,
      ids: `ID ${selection.token.id}`,
      text: describeToken(selection.token.text),
      active: role === "assistant" || selection.token.inContext !== false
    };
  }
  return {
    index: `ω${selection.index + 1}`,
    ids: selection.word.tokenIds.length === 1 ? `ID ${selection.word.tokenIds[0]}` : `${selection.word.tokenIds.length} IDs`,
    text: describeToken(selection.word.text),
    active: role === "assistant" || selection.word.inContext
  };
}

function segmentClass(role: InspectableMessageProps["role"], selected: boolean) {
  if (role === "user") {
    return selected
      ? "bg-[#210b07]/15"
      : "hover:bg-[#210b07]/[.07]";
  }
  return selected
    ? "bg-sophon-signal-soft/15"
    : "hover:bg-white/[.045]";
}

function describeToken(text: string) {
  if (!text) return "empty token";
  return text.replaceAll(" ", "·").replaceAll("\n", "↵").replaceAll("\t", "⇥");
}
