"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="relative flex h-svh items-center justify-center overflow-hidden bg-sophon-canvas p-6 text-foreground">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-70" />
      <section className="relative w-full max-w-md border border-destructive/30 bg-sophon-panel/95 p-6 shadow-[0_24px_80px_rgb(0_0_0/.5)]" role="alert">
        <div aria-hidden="true" className="grid size-12 place-items-center rounded-md border border-destructive/40 bg-destructive/15 font-serif text-xl text-destructive">Δ</div>
        <h1 className="mt-4 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-white">Sophon failed to render</h1>
        <p className="mt-2 text-sm leading-6 text-white/55">The inference console hit an unexpected interface error. Retry the view; your local model data has not been sent anywhere.</p>
        <Button className="mt-5" onClick={reset} type="button">
          <RotateCcw aria-hidden="true" className="size-4" />Retry
        </Button>
      </section>
    </main>
  );
}
