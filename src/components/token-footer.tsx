"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { displayTokenText, PromptRun } from "@/lib/prompt-run";
import { Selection } from "@/components/sophon-scene";
import { sophonChromeSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

function tokenHelpText(token: PromptRun["tokens"][number]) {
  if (token.kind === "bos") return "Beginning-of-sequence token inserted by the model tokenizer, not text typed by the user.";
  if (token.kind === "eos") return "End-of-sequence token used by the model tokenizer to mark a boundary.";
  if (token.kind === "special") return "Special tokenizer token used by the model, not ordinary prompt text.";
  return null;
}

export function TokenFooter({
  run,
  selection,
  setSelection
}: {
  run: PromptRun | null;
  selection: Selection;
  setSelection: (selection: Selection) => void;
}) {
  if (!run) return null;

  return (
    <footer className={cn(sophonChromeSurface, "flex items-center gap-2 overflow-x-auto border-t px-5 py-3 max-[760px]:px-3 max-[760px]:py-2")}>
      {run.tokens.map((token) => {
        const helpText = tokenHelpText(token);
        const button = (
          <Button
            className="min-w-14 shrink-0"
            data-active={selection.token === token.index}
            onClick={() => setSelection({ ...selection, token: token.index })}
            type="button"
            variant="sophon"
          >
            {displayTokenText(token)}
          </Button>
        );

        if (!helpText) return <span className="shrink-0" key={token.index}>{button}</span>;

        return (
          <Tooltip key={token.index}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top">{helpText}</TooltipContent>
          </Tooltip>
        );
      })}
    </footer>
  );
}
