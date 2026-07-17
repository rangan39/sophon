export default function Loading() {
  return (
    <main aria-busy="true" className="relative flex h-svh items-center justify-center overflow-hidden bg-sophon-canvas p-6 text-foreground" role="status">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative flex flex-col items-center border border-white/[.1] bg-sophon-panel/90 px-8 py-7 shadow-[0_24px_80px_rgb(0_0_0/.45)]">
        <div aria-hidden="true" className="grid size-14 place-items-center rounded-md border border-sophon-signal-bright/50 bg-sophon-signal font-serif text-2xl font-semibold text-[#210b07] shadow-[0_0_30px_rgb(255_77_46/.16)]">Σ</div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">Loading inference console</p>
      </div>
    </main>
  );
}
