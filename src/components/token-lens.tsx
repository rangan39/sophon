"use client";

import { type CSSProperties, type KeyboardEvent, lazy, memo, Suspense, useMemo, useRef, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InfoHint } from "@/components/ui/info-hint";
import { groupTokenPieces, type ContextTokenPiece, type TokenWord } from "@/lib/token-display";
import { cn } from "@/lib/utils";

const MarkdownContent = lazy(() => import("@/components/markdown-content"));
const markdownSyntax = /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$))|(?:\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)|(?:^|\n)\s*\|.+\|\s*(?:\n|$)/m;
const tokenLineStyles: Record<InspectableMessageProps["role"], CSSProperties> = {
  assistant: { borderLeftColor: "var(--sophon-signal-bright)" },
  user: { borderLeftColor: "rgb(255 255 255 / 0.9)" }
};

export type InspectableToken = ContextTokenPiece;

type TokenMode = "text" | "tokens" | "words";
type TokenSelection =
  | { kind: "token"; index: number; token: InspectableToken }
  | { kind: "word"; index: number; word: TokenWord }
  | null;

type InspectableSegment = {
  active: boolean;
  ariaLabel: string;
  key: string;
  selection: Exclude<TokenSelection, null>;
  text: string;
  tokenId?: number;
};

type InspectableMessageProps = {
  content: string;
  meta?: string;
  role: "user" | "assistant";
  tokens?: InspectableToken[];
};

export const InspectableMessage = memo(function InspectableMessage({ content, meta, role, tokens = [] }: InspectableMessageProps) {
  const [mode, setMode] = useState<TokenMode>("text");
  const [selection, setSelection] = useState<TokenSelection>(null);
  const words = useMemo(() => mode === "words" ? groupTokenPieces(tokens) : [], [mode, tokens]);
  const segments = useMemo<InspectableSegment[]>(() => {
    if (mode === "tokens") {
      return tokens.map((token, index) => ({
        active: token.inContext !== false,
        ariaLabel: `Token ${index + 1}, ID ${token.id}: ${describeToken(token.text)}${token.inContext === false ? ", outside context" : ""}`,
        key: `${index}-${token.id}`,
        selection: { kind: "token", index, token },
        text: token.text,
        tokenId: token.id
      }));
    }
    if (mode === "words") {
      return words.map((word, index) => ({
        active: word.inContext,
        ariaLabel: `Word segment ${index + 1}, ${describeTokenRange(word.tokenIndexes)}: ${describeToken(word.text)}${word.inContext ? "" : ", outside context"}`,
        key: `${index}-${word.tokenIds.join("-")}`,
        selection: { kind: "word", index, word },
        text: word.text
      }));
    }
    return [];
  }, [mode, tokens, words]);
  const hasTokens = tokens.length > 0;

  function changeMode(nextMode: TokenMode) {
    setMode(nextMode);
    setSelection(null);
  }

  return (
    <div className={cn("flex max-w-full flex-col gap-2", role === "user" ? "items-end" : "items-start")} data-message-role={role}>
      <Bubble align={role === "user" ? "end" : "start"} variant={role === "user" ? "default" : "muted"}>
        <BubbleContent className={cn("break-words rounded-xl shadow-[inset_0_1px_0_rgb(255_255_255/.08),0_14px_36px_rgb(0_0_0/.22)]", role === "user" ? "border-sophon-signal-bright/45 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal font-medium text-[#210b07]" : "border-white/[.14] bg-[rgb(24_34_53/.72)] text-[#e6edf7]")}>
          {mode !== "text" && hasTokens ? (
            <SegmentSequence key={mode} kind={mode} role={role} segments={segments} selection={selection} setSelection={setSelection} />
          ) : (
            <MarkdownMessage content={content} role={role} />
          )}
        </BubbleContent>
      </Bubble>

      {(meta || hasTokens) ? (
        <div className={cn("flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 px-1", role === "user" && "flex-row-reverse")}>
          {meta ? <span className={cn("min-w-0 max-w-full break-words text-xs text-[#aab4c3]", role === "user" && "text-right")}>{meta}</span> : null}
          {role === "assistant" && meta && hasTokens ? <InfoHint concept="generationMetrics" /> : null}
          {hasTokens ? <TokenModeControl mode={mode} onChange={changeMode} /> : null}
        </div>
      ) : null}

      {mode !== "text" && hasTokens ? (
        <TokenInspector role={role} selection={selection} tokenCount={tokens.length} />
      ) : null}
    </div>
  );
});

function MarkdownMessage({ content, role }: Pick<InspectableMessageProps, "content" | "role">) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-auto text-[15px] leading-6",
        "[&_a]:break-words [&_a]:font-semibold [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4 [&_a:focus-visible]:rounded-sm [&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-sophon-warning",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic",
        "[&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-semibold",
        "[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t",
        "[&_li]:pl-1 [&_li]:marker:font-mono [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
        "[&_p]:my-3 [&_p]:whitespace-pre-wrap [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
        "[&_table]:my-3 [&_table]:min-w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:font-semibold",
        role === "user"
          ? "[&_a]:text-[#150907] [&_blockquote]:border-[#210b07]/45 [&_code]:bg-[#210b07]/10 [&_code]:text-[#150907] [&_hr]:border-[#210b07]/30 [&_li]:marker:text-[#210b07]/70 [&_pre]:border-[#210b07]/35 [&_pre]:bg-[#150907]/95 [&_pre]:text-[#f8fafc] [&_td]:border-[#210b07]/25 [&_th]:border-[#210b07]/35 [&_th]:bg-[#210b07]/10"
          : "[&_a]:text-[#ff9d87] [&_blockquote]:border-sophon-signal-soft/60 [&_code]:bg-black/35 [&_code]:text-[#ffd4ca] [&_hr]:border-white/15 [&_li]:marker:text-sophon-signal-soft [&_pre]:border-white/15 [&_pre]:bg-[#070b13]/95 [&_pre]:text-[#e6edf7] [&_td]:border-white/15 [&_th]:border-white/20 [&_th]:bg-white/[.06]"
      )}
    >
      {markdownSyntax.test(content) ? (
        <Suspense fallback={<p>{content}</p>}>
          <MarkdownContent content={content} />
        </Suspense>
      ) : <p>{content}</p>}
    </div>
  );
}

function TokenModeControl({ mode, onChange }: { mode: TokenMode; onChange: (mode: TokenMode) => void }) {
  return (
    <div aria-label="Message display granularity" className="flex max-w-full shrink-0 flex-wrap items-center rounded-md border border-white/[.16] bg-black/25 p-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#aab4c3]" role="group">
      <InfoHint className="text-sophon-signal-soft" concept="tokenLens" />
      {(["text", "tokens", "words"] as const).map((option) => (
        <button
          aria-pressed={mode === option}
          className={cn("min-h-11 min-w-11 rounded px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning sm:min-h-9 sm:min-w-12", mode === option ? "bg-white/[.12] text-[#f8fafc]" : "hover:bg-white/[.07] hover:text-[#f8fafc]")}
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

function SegmentSequence({ kind, role, segments, selection, setSelection }: {
  kind: Exclude<TokenMode, "text">;
  role: InspectableMessageProps["role"];
  segments: InspectableSegment[];
  selection: TokenSelection;
  setSelection: (selection: TokenSelection) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectSegment(index: number) {
    const segment = segments[index];
    if (!segment) return;
    setSelection(segment.selection);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = rovingIndex(event.key, index, segments.length);
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    selectSegment(nextIndex);
    segmentRefs.current[nextIndex]?.focus();
  }

  return (
    <span aria-label={`${segments.length} inspectable ${kind === "tokens" ? "token" : "word"} segments. Use arrow keys, Home, and End to navigate.`} aria-orientation="horizontal" className="whitespace-pre-wrap break-words" role="toolbar">
      {segments.map((segment, index) => {
        const selected = selection?.kind === segment.selection.kind && selection.index === index;
        return (
          <button
            aria-label={segment.ariaLabel}
            aria-pressed={selected}
            className={cn("inline-flex min-h-6 cursor-crosshair items-center whitespace-pre-wrap rounded-sm border-l border-dotted px-px py-0 font-inherit text-inherit transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning", segmentClass(role, selected), !segment.active && "opacity-75")}
            data-context={segment.active ? "active" : "omitted"}
            data-token-id={segment.tokenId}
            key={segment.key}
            onClick={() => { setActiveIndex(index); selectSegment(index); }}
            onFocus={() => { setActiveIndex(index); selectSegment(index); }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onMouseEnter={() => setSelection(segment.selection)}
            ref={(node) => { segmentRefs.current[index] = node; }}
            style={tokenLineStyles[role]}
            tabIndex={activeIndex === index ? 0 : -1}
            type="button"
          >
            {segment.text || <span aria-hidden="true">∅</span>}
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
    <div className="flex max-w-full flex-wrap items-center gap-2 rounded-md border border-white/[.14] bg-sophon-panel-deep/90 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[#aab4c3]">
      {details ? (
        <>
          <span className="text-sophon-signal-soft">{details.index}</span>
          <span aria-hidden="true" className="text-[#64748b]">/</span>
          <span className="text-[#cbd5e1]">{details.ids}</span>
          <span aria-hidden="true" className="text-[#64748b]">/</span>
          <span className="max-w-52 truncate normal-case tracking-normal text-[#d7dde8]">“{details.text}”</span>
          <span aria-hidden="true" className="text-[#64748b]">/</span>
          <span className={details.active ? "text-sophon-verified" : "text-sophon-warning"}>{details.active ? "within context" : "outside context"}</span>
        </>
      ) : (
        <><span className="font-serif text-sm normal-case text-sophon-signal-soft">τ</span><span>Select a segment</span><span className="ml-auto tabular-nums text-[#94a3b8]">{tokenCount} tokens</span></>
      )}
    </div>
  );
}

function selectionDetails(selection: TokenSelection, role: InspectableMessageProps["role"]) {
  if (!selection) return null;
  if (selection.kind === "token") {
    return {
      index: `Token ${selection.index + 1}`,
      ids: `ID ${selection.token.id}`,
      text: describeToken(selection.token.text),
      active: role === "assistant" || selection.token.inContext !== false
    };
  }
  return {
    index: `Word ${selection.index + 1}`,
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

function rovingIndex(key: string, index: number, count: number) {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  return null;
}

function describeTokenRange(indexes: number[]) {
  const firstIndex = indexes[0];
  if (firstIndex === undefined) return "no tokens";
  const lastIndex = indexes[indexes.length - 1] ?? firstIndex;
  const first = firstIndex + 1;
  const last = lastIndex + 1;
  return first === last ? `token ${first}` : `tokens ${first} through ${last}`;
}

function describeToken(text: string) {
  if (!text) return "empty token";
  return text.replaceAll(" ", "·").replaceAll("\n", "↵").replaceAll("\t", "⇥");
}
