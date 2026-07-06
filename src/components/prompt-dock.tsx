"use client";

import { Play, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { sophonChromeSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

export function PromptDock({
  promptInput,
  setPromptInput,
  promptCharsRemaining,
  canRun,
  isRunning,
  runMessage,
  executeRun,
  maxPromptChars,
  maxPromptTokens
}: {
  promptInput: string;
  setPromptInput: (value: string) => void;
  promptCharsRemaining: number;
  canRun: boolean;
  isRunning: boolean;
  runMessage: string | null;
  executeRun: () => void;
  maxPromptChars: number;
  maxPromptTokens: number;
}) {
  return (
    <div className={cn(sophonChromeSurface, "border-t p-3 max-[760px]:p-2")}>
      <Card className="w-full rounded-lg p-2" variant="glass">
        <div className="flex items-end gap-2">
          <Terminal className="mb-3 ml-2 size-4 shrink-0 text-primary max-[520px]:hidden" />
          <Textarea
            className="min-h-12 resize-none border-0 bg-transparent px-2 py-3 shadow-none placeholder:text-muted-foreground/80 focus-visible:ring-0 max-[520px]:min-h-10 max-[520px]:py-2"
            maxLength={maxPromptChars}
            onChange={(event) => setPromptInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                executeRun();
              }
            }}
            placeholder="Enter a prompt"
            rows={1}
            value={promptInput}
          />
          <Button className="mb-1 size-10 shrink-0 rounded-md" disabled={!canRun} onClick={executeRun} size="icon" type="button" variant="sophon-primary">
            <Play className="size-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 pb-1 text-[11px] text-muted-foreground max-[520px]:pt-1 max-[520px]:text-[10px]">
          <span className="truncate">{isRunning ? "Reconstructing activations" : "Enter to run"}</span>
          <span className="shrink-0">
            {promptCharsRemaining} chars left · {maxPromptTokens} token cap
          </span>
        </div>
        {runMessage ? (
          <div className="border-t border-primary/20 px-3 py-2 text-xs leading-5 text-primary">{runMessage}</div>
        ) : null}
      </Card>
    </div>
  );
}
