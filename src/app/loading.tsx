export default function Loading() {
  return (
    <main aria-busy="true" className="relative flex h-svh items-center justify-center overflow-hidden bg-sophon-canvas p-6 text-foreground" role="status">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className="sophon-glass-strong relative flex flex-col items-center rounded-2xl px-8 py-7">
        <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl border border-sophon-signal-bright/60 bg-gradient-to-br from-sophon-signal-bright to-sophon-signal font-serif text-2xl font-semibold text-[#210b07] shadow-[0_0_30px_rgb(255_77_46/.24)]">Σ</div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">Loading inference console</p>
      </div>
    </main>
  );
}
