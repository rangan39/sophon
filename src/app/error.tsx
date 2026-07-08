"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sophonBrandMark, sophonChromeSurface, sophonGridSurface } from "@/lib/sophon-tailwind";
import { cn } from "@/lib/utils";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={cn(sophonGridSurface, "flex h-svh items-center justify-center bg-background p-6 text-foreground")}>
      <section className={cn(sophonChromeSurface, "w-full max-w-md rounded-lg border p-6 shadow-[0_18px_52px_rgb(166_172_178/.20)]")}>
        <div className={cn(sophonBrandMark, "grid size-12 place-items-center rounded-md border")}>
          <AlertTriangle className="size-6 text-primary-foreground" />
        </div>
        <h1 className="mt-4 font-serif text-2xl font-semibold">Sophon failed to render</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error.message || "The interface hit an unexpected Next.js render error."}
        </p>
        <Button className="mt-5" onClick={reset} type="button" variant="sophon-primary">
          <RotateCcw className="size-4" />
          Retry
        </Button>
      </section>
    </main>
  );
}
