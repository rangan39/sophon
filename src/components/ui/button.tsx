import * as React from "react";
import { cn } from "@/lib/utils";

const BASE = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const VARIANTS = {
  default: "bg-primary text-primary-foreground shadow-[0_0_22px_rgb(255_77_46/.28)] hover:bg-primary/90 hover:shadow-[0_0_28px_rgb(255_77_46/.24)]",
  sophon: "border border-sophon-glass-border bg-sophon-glass-strong text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/.09)] hover:border-sophon-signal-bright/45 hover:bg-white/[.09]"
} as const;
const SIZES = { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", icon: "size-9" } as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button };
