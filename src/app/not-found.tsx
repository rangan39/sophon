import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative flex h-svh items-center justify-center overflow-hidden bg-sophon-canvas p-6 text-foreground">
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-70" />
      <section className="relative w-full max-w-md border border-white/[.1] bg-sophon-panel/95 p-6 text-center shadow-[0_24px_80px_rgb(0_0_0/.5)]">
        <p aria-hidden="true" className="font-serif text-3xl text-sophon-signal-soft">∅</p>
        <h1 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-white">Channel not found</h1>
        <p className="mt-2 text-sm leading-6 text-white/55">This Sophon route does not exist.</p>
        <Button asChild className="mt-5">
          <Link href="/">Return to console</Link>
        </Button>
      </section>
    </main>
  );
}
