"use client";

import { lazy, Suspense, useRef, useState } from "react";

const SophonAcknowledgementsDialog = lazy(() => import("@/components/sophon-acknowledgements-dialog"));

export function SophonAcknowledgements() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="-mx-2 inline-flex min-h-9 items-center gap-1.5 px-2 uppercase text-white/65 transition-colors hover:text-sophon-signal-bright focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning"
        onClick={() => setShowDialog(true)}
        ref={triggerRef}
        type="button"
      >
        <span className="whitespace-nowrap underline decoration-sophon-signal-bright underline-offset-2">Made in Toronto by Rangan39</span>
      </button>

      {showDialog ? (
        <Suspense fallback={null}>
          <SophonAcknowledgementsDialog onDismiss={() => setShowDialog(false)} triggerRef={triggerRef} />
        </Suspense>
      ) : null}
    </>
  );
}
