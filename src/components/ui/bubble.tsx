import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const bubbleVariants = cva("group/bubble relative flex w-fit max-w-[92%] min-w-0 flex-col gap-1 data-[align=end]:self-end", {
  variants: {
    variant: {
      default: "*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground",
      secondary: "*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground",
      muted: "*:data-[slot=bubble-content]:bg-muted",
      outline: "*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background",
      ghost: "max-w-full *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Bubble({ variant = "default", align = "start", className, ...props }: React.ComponentProps<"div"> & VariantProps<typeof bubbleVariants> & { align?: "start" | "end" }) {
  return <div data-slot="bubble" data-variant={variant} data-align={align} className={cn(bubbleVariants({ variant }), className)} {...props} />;
}

export function BubbleContent({ asChild = false, className, ...props }: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return <Comp data-slot="bubble-content" className={cn("w-fit max-w-full min-w-0 overflow-hidden rounded-2xl border border-transparent px-4 py-2.5 text-sm leading-relaxed", className)} {...props} />;
}

export function BubbleReactions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-reactions" className={cn("flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs", className)} {...props} />;
}
