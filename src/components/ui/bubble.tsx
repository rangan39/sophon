import * as React from "react";
import { cn } from "@/lib/utils";

export function Bubble({ variant = "default", align = "start", className, ...props }: React.ComponentProps<"div"> & { variant?: "default" | "muted"; align?: "start" | "end" }) {
  return <div data-slot="bubble" data-variant={variant} data-align={align} className={cn("group/bubble relative flex w-fit max-w-[92%] min-w-0 flex-col gap-1 data-[align=end]:self-end", variant === "default" ? "*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground" : "*:data-[slot=bubble-content]:bg-muted", className)} {...props} />;
}

export function BubbleContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-content" className={cn("w-fit max-w-full min-w-0 overflow-hidden rounded-2xl border border-transparent px-4 py-2.5 text-sm leading-relaxed", className)} {...props} />;
}
