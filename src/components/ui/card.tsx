import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-lg border text-card-foreground", {
  variants: {
    variant: {
      default: "bg-card shadow-sm",
      glass:
        "border-[#a6acb2]/70 bg-[linear-gradient(135deg,rgb(255_106_0/.16),transparent_34%),linear-gradient(155deg,rgb(215_25_42/.14),transparent_58%),rgb(255_255_255/.92)] shadow-[inset_0_1px_0_rgb(255_255_255/1),0_0_0_1px_rgb(215_25_42/.11),0_18px_52px_rgb(166_172_178/.20),0_8px_28px_rgb(255_106_0/.14)] backdrop-blur-[18px]",
      chrome:
        "border-[#a6acb2]/65 bg-[linear-gradient(135deg,rgb(255_106_0/.08),transparent_42%),rgb(250_250_250/.74)] backdrop-blur-2xl",
      tile: "border-[#a6acb2]/55 bg-white/65 shadow-[inset_0_1px_0_rgb(255_255_255/.75)]"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }: CardProps, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-serif text-sm font-semibold leading-none tracking-normal", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, cardVariants };
