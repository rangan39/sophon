import * as React from "react";
import { cn } from "@/lib/utils";

export function Message({ className, align = "start", ...props }: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return <div data-slot="message" data-align={align} className={cn("group/message relative flex w-full min-w-0 gap-3 text-sm data-[align=end]:flex-row-reverse", className)} {...props} />;
}

export function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-avatar" className={cn("flex size-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted", className)} {...props} />;
}

export function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-content" className={cn("flex w-full min-w-0 flex-col gap-2.5", className)} {...props} />;
}

export function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-header" className={cn("flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-footer" className={cn("flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground", className)} {...props} />;
}
