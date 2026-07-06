import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_22px_rgb(215_25_42/.28)] hover:bg-primary/90 hover:shadow-[0_0_28px_rgb(255_106_0/.28)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background/80 hover:bg-accent hover:text-accent-foreground hover:shadow-[0_0_18px_rgb(255_106_0/.18)]",
        secondary: "bg-secondary text-secondary-foreground shadow-[0_0_18px_rgb(166_172_178/.18)] hover:bg-secondary/80",
        sophon:
          "border border-[#a6acb2]/60 bg-white/65 text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/.75)] hover:border-[#ff6a00]/55 hover:bg-[#fff0e4]/80 hover:text-accent-foreground data-[active=true]:border-[#d7192a]/70 data-[active=true]:bg-[linear-gradient(135deg,rgb(255_106_0/.26),rgb(215_25_42/.14)),rgb(255_255_255/.72)] data-[active=true]:text-primary data-[active=true]:shadow-[inset_0_1px_0_rgb(255_255_255/.8),0_0_18px_rgb(255_106_0/.24)]",
        "sophon-primary": "bg-primary text-primary-foreground shadow-[0_0_22px_rgb(215_25_42/.28)] hover:bg-primary/90 hover:shadow-[0_0_28px_rgb(255_106_0/.28)]",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
