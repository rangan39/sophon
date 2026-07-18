"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_18%_0%,rgb(255_77_46/.14),transparent_34rem),linear-gradient(145deg,#090a0d,#0e1017_52%,#08090c)] p-6 text-[#f4f0e9]">
          <section className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0d0f15]/85 p-6 shadow-[inset_0_1px_0_rgb(255_255_255/.08),0_24px_70px_rgb(0_0_0/.4)] backdrop-blur-2xl" role="alert">
            <p aria-hidden="true" className="font-serif text-3xl text-[#ff795d]">Δ</p>
            <h1 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.12em]">Sophon encountered a critical error</h1>
            <p className="mt-2 text-sm leading-6 text-white/70">Reload the application shell to reconnect to the local runtime.</p>
            <button className="mt-5 h-10 rounded-xl bg-[#ff4d2e] px-4 text-sm font-medium text-[#210b07] shadow-[0_0_22px_rgb(255_77_46/.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc857]" onClick={reset} type="button">Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
