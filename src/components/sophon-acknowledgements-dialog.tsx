"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACKNOWLEDGEMENT_SECTIONS = [
  {
    id: "technical",
    title: "Technical",
    description: "Open model and local inference stack.",
    items: [
      {
        label: "Models",
        name: "Cohere Labs · Tiny Aya",
        description: "Multilingual Global, Earth, Fire, and Water model family.",
        href: "https://huggingface.co/CohereLabs"
      },
      {
        label: "Model format",
        name: "ONNX Community",
        description: "Browser-ready ONNX conversions for local inference.",
        href: "https://huggingface.co/onnx-community"
      },
      {
        label: "Browser runtime",
        name: "Transformers.js",
        description: "Model loading, tokenization, and generation in the browser.",
        href: "https://github.com/huggingface/transformers.js"
      },
      {
        label: "Inference engine",
        name: "ONNX Runtime Web",
        description: "Hardware-accelerated local inference through WebGPU.",
        href: "https://onnxruntime.ai/"
      }
    ]
  },
  {
    id: "community",
    title: "Community",
    description: "With appreciation for Toronto’s AI community.",
    items: [
      {
        label: "AI ecosystem",
        name: "Radical Ventures",
        description: "Backing ambitious teams building the future of AI.",
        href: "https://radical.vc/"
      },
      {
        label: "Founder network",
        name: "NEXT Canada",
        description: "Growing Canada’s next generation of entrepreneurs.",
        href: "https://www.nextcanada.com/"
      },
      {
        label: "AI safety",
        name: "Trajectory Labs",
        description: "A Toronto home for AI safety research and community.",
        href: "https://www.trajectorylabs.org/"
      }
    ]
  }
] as const;

interface SophonAcknowledgementsDialogProps {
  onDismiss: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export default function SophonAcknowledgementsDialog({ onDismiss, triggerRef }: SophonAcknowledgementsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (!dialog?.open || closingRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => dialog.close(), 100);
  }

  function handleClose() {
    triggerRef.current?.focus();
    onDismiss();
  }

  return (
    <dialog
      aria-labelledby="acknowledgements-title"
      className="fixed inset-0 z-50 m-0 h-svh max-h-none w-full max-w-none items-center justify-center bg-transparent p-4 backdrop:bg-black/75 backdrop:backdrop-blur-sm open:flex sm:p-8"
      data-state={closing ? "closing" : "open"}
      id="sophon-acknowledgements"
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}
      onClose={handleClose}
      ref={dialogRef}
    >
      <section className="sophon-glass-strong flex max-h-[min(84svh,44rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-white/15 shadow-[0_28px_100px_rgb(0_0_0/.55)]" data-testid="acknowledgements-panel">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/10 p-4 sm:p-5">
          <span aria-hidden="true" className="sophon-glass-tile hidden size-10 shrink-0 place-items-center rounded-xl font-serif text-lg text-sophon-signal-soft min-[400px]:grid">Σ</span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-sophon-signal-soft">With appreciation</span>
            <h2 className="mt-1 text-base font-semibold text-white sm:text-lg" id="acknowledgements-title">Acknowledgements</h2>
          </span>
          <Button aria-label="Close acknowledgements" className="size-11 shrink-0 rounded-xl sm:size-9" onClick={closeDialog} size="icon" type="button" variant="sophon"><X aria-hidden="true" /></Button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="space-y-5">
            {ACKNOWLEDGEMENT_SECTIONS.map((section) => (
              <section aria-labelledby={`acknowledgements-${section.id}-title`} key={section.id}>
                <div className="mb-2 flex items-end justify-between gap-4 px-1">
                  <span>
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-sophon-signal-soft" id={`acknowledgements-${section.id}-title`}>{section.title}</h3>
                    <span className="mt-0.5 block text-[11px] leading-4 text-white/45">{section.description}</span>
                  </span>
                  <span aria-hidden="true" className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">{section.items.length} credits</span>
                </div>

                <ul className="space-y-2" data-testid={`acknowledgements-${section.id}`}>
                  {section.items.map((credit) => (
                    <li className="sophon-glass-tile rounded-xl px-3.5 py-3 transition-colors hover:border-white/15 hover:bg-white/[0.045]" key={credit.name}>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <a className="break-words text-sm font-medium text-white/90 transition-colors hover:text-sophon-signal-bright focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href={credit.href} rel="noreferrer" target="_blank">
                          {credit.name}<span aria-hidden="true" className="ml-1.5 text-[11px] text-white/45">↗</span>
                        </a>
                        <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 font-mono text-[9px] uppercase leading-none tracking-[0.08em] text-white/50">{credit.label}</span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-4 text-white/50">{credit.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-white/50">
            <p>Tiny Aya weights use CC BY-NC 4.0 and the Cohere Labs Acceptable Use Policy. Sophon is independent.</p>
            <p className="mt-3 text-white/65">Designed and built in Toronto, Canada by <a className="text-white underline decoration-white/25 underline-offset-4 transition-colors hover:text-sophon-signal-bright focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning" href="https://github.com/rangan39" rel="noreferrer" target="_blank">rangan39</a>.</p>
          </div>
        </div>
      </section>
    </dialog>
  );
}
