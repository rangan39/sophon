import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative flex h-svh items-center justify-center overflow-hidden bg-sophon-canvas p-6 text-foreground">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <section className="sophon-glass-strong relative w-full max-w-md rounded-2xl p-6 text-center">
        <p aria-hidden="true" className="font-serif text-3xl text-sophon-signal-soft">∅</p>
        <h1 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-white">Channel not found</h1>
        <p className="mt-2 text-sm leading-6 text-white/70">This Sophon route does not exist.</p>
        <Link className="mt-5 inline-flex h-9 items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_22px_rgb(255_77_46/.28)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/">Return to console</Link>
      </section>
    </main>
  );
}
