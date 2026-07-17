"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, PanelLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";
import { cn } from "@/lib/utils";

type SidebarProps = {
  capabilities: RuntimeCapabilities | null;
  disabled: boolean;
  model: ModelManifest;
  onNewSession: () => void;
};

export function SophonSidebar(props: SidebarProps) {
  return (
    <aside aria-label="Sessions and runtime" className="hidden min-h-0 border-r border-white/[.08] bg-sophon-panel-deep/70 min-[701px]:flex">
      <SidebarContent {...props} />
    </aside>
  );
}

export function SophonMobileSidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);

  function startNewSession() {
    props.onNewSession();
    setOpen(false);
  }

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger asChild>
        <Button
          aria-label="Open sessions and runtime panel"
          className="text-white/60 hover:bg-white/[.06] hover:text-white min-[701px]:hidden"
          size="icon"
          variant="ghost"
        >
          <PanelLeft aria-hidden="true" className="size-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sophon-dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] min-[701px]:hidden" />
        <Dialog.Content className="sophon-drawer fixed inset-y-0 left-0 z-50 flex w-[min(310px,calc(100vw-2rem))] flex-col border-r border-white/[.1] bg-sophon-panel-deep shadow-[20px_0_80px_rgb(0_0_0/.55)] outline-none min-[701px]:hidden">
          <div className="flex h-14 items-center justify-between border-b border-white/[.08] px-4">
            <div>
              <Dialog.Title className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/75">Session control</Dialog.Title>
              <Dialog.Description className="sr-only">Start a new session and inspect the active model runtime.</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close sessions panel"
              className="grid size-9 place-items-center border border-white/[.08] font-mono text-sm text-white/45 transition-colors hover:border-sophon-signal-bright/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              ×
            </Dialog.Close>
          </div>
          <SidebarContent {...props} onNewSession={startNewSession} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SidebarContent({ capabilities, disabled, model, onNewSession }: SidebarProps) {
  const provider = !capabilities
    ? "Probing"
    : capabilities.webgpu && model.providers.includes("webgpu")
      ? "WebGPU"
      : capabilities.wasm && model.providers.includes("wasm")
        ? "WASM"
        : "Unavailable";

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <Button
        className="h-11 w-full justify-start gap-2 border-white/[.12] bg-white/[.045] font-mono text-xs text-white hover:border-sophon-signal-bright/50 hover:bg-sophon-signal/10"
        disabled={disabled}
        onClick={onNewSession}
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-4 text-sophon-signal-soft" />
        New session
      </Button>

      <div className="mt-9 flex items-center justify-between px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
        <span>Sessions</span>
        <span aria-label="1 session" className="text-white/20">01</span>
      </div>
      <div aria-current="page" className="mt-3 rounded-md border border-sophon-signal-bright/25 bg-sophon-signal/[.08] px-3 py-3 shadow-[inset_3px_0_0_var(--sophon-signal)]">
        <div className="flex items-center gap-2 text-xs font-medium text-white">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-sophon-signal-bright" />
          Getting started
        </div>
        <p className="mt-1 pl-3.5 text-[11px] text-white/35">Active now</p>
      </div>

      <Card className="mt-auto rounded-md border-white/[.08] bg-white/[.025] p-3 text-xs leading-5 text-white/45">
        <div className="mb-3 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-white/60">
          <span className="flex items-center gap-2"><Activity aria-hidden="true" className="size-3 text-sophon-verified" />Device runtime</span>
          <span className={model.verification === "verified" ? "text-sophon-verified" : "text-sophon-warning"}>{model.verification}</span>
        </div>
        <p className="font-medium text-white/80">{model.label}</p>
        <p className="mt-1">{model.description}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[.08] pt-3 font-mono text-[10px] uppercase text-white/30">
          <dt>Graph</dt><dd className="text-right text-white/50">{model.graph.generation}</dd>
          <dt>Provider</dt><dd className={cn("text-right", provider === "WebGPU" ? "text-sophon-verified" : provider === "WASM" ? "text-sophon-warning" : provider === "Probing" ? "text-white/35" : "text-destructive")}>{provider}</dd>
        </dl>
      </Card>
    </div>
  );
}
