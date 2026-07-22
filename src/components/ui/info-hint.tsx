"use client";

import { useId, type RefObject } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { INFO_HINTS, type InfoHintId } from "@/lib/info-hints";
import { cn } from "@/lib/utils";

type InfoHintProps = {
  className?: string;
  concept: InfoHintId;
  portalContainer?: RefObject<HTMLElement | null>;
};

export function InfoHint({ className, concept, portalContainer }: InfoHintProps) {
  const hint = INFO_HINTS[concept];
  const tooltipId = useId();
  return (
    <TooltipProvider closeDelay={0} delay={0} timeout={0}>
      <Tooltip>
        <TooltipTrigger
          aria-label={hint.label}
          aria-describedby={tooltipId}
          className={cn(
            "inline-grid size-7 shrink-0 place-items-center rounded-md text-white/35 transition-colors hover:bg-white/[.07] hover:text-sophon-signal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning data-[popup-open]:bg-white/[.07] data-[popup-open]:text-sophon-signal-bright",
            className
          )}
          closeDelay={0}
          closeOnClick
          data-help-id={concept}
          data-info-hint-trigger=""
          delay={0}
          render={<span />}
          tabIndex={0}
        >
          <Info aria-hidden="true" className="size-3.5 stroke-[1.75]" />
        </TooltipTrigger>
        <TooltipContent container={portalContainer} data-help-id={concept} id={tooltipId}>
          <span className="sr-only">{hint.title}. </span>{hint.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
