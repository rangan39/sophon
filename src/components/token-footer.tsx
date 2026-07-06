"use client";

import { Button } from "@/components/ui/button";
import { PromptRun } from "@/lib/prompt-run";
import { Selection } from "@/components/sophon-scene";
import { sophonChromeSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

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
      {run.tokens.map((token) => (
        <Button
          className="min-w-14 shrink-0"
          data-active={selection.token === token.index}
          key={token.index}
          onClick={() => setSelection({ ...selection, token: token.index })}
          type="button"
          variant="sophon"
        >
          {token.text.trim() || "space"}
        </Button>
      ))}
    </footer>
  );
}
