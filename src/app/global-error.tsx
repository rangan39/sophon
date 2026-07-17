"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-[#090a0d] p-6 text-[#f4f0e9]">
          <section className="w-full max-w-md border border-white/10 bg-[#0b0c10] p-6" role="alert">
            <p aria-hidden="true" className="font-serif text-3xl text-[#ff795d]">Δ</p>
            <h1 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.12em]">Sophon encountered a critical error</h1>
            <p className="mt-2 text-sm leading-6 text-white/55">Reload the application shell to reconnect to the local runtime.</p>
            <button className="mt-5 h-9 bg-[#ff4d2e] px-4 text-sm font-medium text-[#210b07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d2e]" onClick={reset} type="button">Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
