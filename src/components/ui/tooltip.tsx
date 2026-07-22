"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, "children"> & {
  children?: React.ReactNode;
  collisionBoundary?: TooltipPrimitive.Positioner.Props["collisionBoundary"];
  collisionPadding?: TooltipPrimitive.Positioner.Props["collisionPadding"];
  container?: TooltipPrimitive.Portal.Props["container"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
};

function TooltipContent({
  children,
  className,
  collisionBoundary,
  collisionPadding = 10,
  container,
  sideOffset = 7,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        align="center"
        className="z-[70]"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        positionMethod="fixed"
        side="top"
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "max-w-[min(17.5rem,calc(100vw-2rem))] rounded-lg border border-white/15 bg-[#111319]/95 px-3 py-2.5 text-left text-[11px] font-normal leading-[1.45] tracking-normal text-white/70 shadow-[0_18px_52px_rgb(0_0_0/.48),inset_0_1px_0_rgb(255_255_255/.08)] outline-none backdrop-blur-xl",
            className
          )}
          data-slot="tooltip-content"
          role="tooltip"
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
