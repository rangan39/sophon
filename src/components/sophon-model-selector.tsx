"use client";

import { useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import { MODEL_REGISTRY, getModelDefinition, type ModelManifest } from "@/lib/onnx-models";

type SophonModelSelectorProps = {
  disabled?: boolean;
  modelId: string;
  onSelect: (modelId: string) => void;
};

export function SophonModelSelector({ disabled = false, modelId, onSelect }: SophonModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedModel = getModelDefinition(modelId);
  const filteredModels = useMemo(() => filterModels(query), [query]);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, MODEL_REGISTRY.findIndex((model) => model.id === modelId)));
  const compactLabel = modelTriggerLabel(selectedModel);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setQuery("");
      setActiveIndex(Math.max(0, MODEL_REGISTRY.findIndex((model) => model.id === modelId)));
    }
  }

  function chooseModel(nextModelId: string) {
    onSelect(nextModelId);
    setOpen(false);
    setQuery("");
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => filteredModels.length === 0 ? 0 : (current + 1) % filteredModels.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => filteredModels.length === 0 ? 0 : (current - 1 + filteredModels.length) % filteredModels.length);
    } else if (event.key === "Enter") {
      const model = filteredModels[activeIndex];
      if (!model) return;
      event.preventDefault();
      chooseModel(model.id);
    }
  }

  return (
    <Dialog.Root onOpenChange={changeOpen} open={open}>
      <Dialog.Trigger asChild>
        <button
          aria-label={`Choose model. Current model: ${selectedModel.label}`}
          className="flex h-7 min-w-[108px] max-w-[148px] items-center gap-1.5 border border-white/[.12] bg-white/[.04] px-2 font-mono uppercase text-white/65 transition-colors hover:border-[#ff694b]/50 hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ffc857] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled}
          type="button"
        >
          <span aria-hidden="true" className="font-serif text-[11px] normal-case text-[#ff795d]">μ</span>
          <span className="truncate text-[10px] leading-none tracking-[0.08em]">{compactLabel.name}</span>
          {compactLabel.variant ? <span className="text-[8px] leading-none tracking-[0.06em] text-white/30">{compactLabel.variant}</span> : null}
          <span aria-hidden="true" className="ml-auto text-[8px] text-white/25">⌄</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(680px,calc(100vh-2rem))] w-[min(540px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col border border-white/[.13] bg-[#0b0c10] shadow-[0_30px_100px_rgb(0_0_0/.65)] focus:outline-none">
          <div className="flex items-start justify-between border-b border-white/[.08] px-4 py-3">
            <div>
              <Dialog.Title className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/75">Model registry</Dialog.Title>
              <Dialog.Description className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">Select a local ONNX execution target</Dialog.Description>
            </div>
            <Dialog.Close className="grid size-7 place-items-center border border-white/[.08] font-mono text-xs text-white/35 hover:border-[#ff694b]/40 hover:text-white/70" aria-label="Close model selector">×</Dialog.Close>
          </div>

          <div className="border-b border-white/[.08] p-3">
            <label className="flex h-9 items-center gap-2 border border-white/[.1] bg-white/[.025] px-3 focus-within:border-[#ff694b]/50">
              <span aria-hidden="true" className="font-serif text-sm text-[#ff795d]">λ</span>
              <span className="sr-only">Search models</span>
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-white/80 outline-none placeholder:uppercase placeholder:tracking-[0.12em] placeholder:text-white/20"
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search models"
                value={query}
              />
              <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-white/20">↑↓ select · ↵ load</span>
            </label>
          </div>

          <div aria-label="Available models" className="min-h-0 overflow-y-auto p-2" role="listbox">
            {filteredModels.length ? filteredModels.map((model, index) => {
              const selected = model.id === modelId;
              const active = index === activeIndex;
              return (
                <button
                  aria-selected={selected}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 border px-3 py-3 text-left transition-colors focus-visible:outline-none ${active ? "border-[#ff694b]/35 bg-[#ff4d2e]/[.07]" : "border-transparent hover:border-white/[.08] hover:bg-white/[.025]"}`}
                  key={model.id}
                  onClick={() => chooseModel(model.id)}
                  onFocus={() => setActiveIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-white/80">{model.label}</span>
                      {selected ? <span className="font-serif text-xs text-[#ff795d]">Δ</span> : null}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-white/35">{model.description}</span>
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/25">
                      <span>{model.family}</span><span>{model.format.quantization}</span><span>{model.format.sizeLabel}</span><span>{model.providers.join(" / ")}</span><span>{model.graph.generation}</span>
                    </span>
                  </span>
                  <span className={`font-mono text-[8px] uppercase tracking-[0.12em] ${model.verification === "verified" ? "text-[#7df0a8]" : "text-[#ffc857]"}`}>{model.verification}</span>
                </button>
              );
            }) : (
              <div className="px-4 py-12 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-white/25">No matching models</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function filterModels(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...MODEL_REGISTRY];
  return MODEL_REGISTRY.filter((model) => [
    model.id,
    model.label,
    model.family,
    model.description,
    model.verification,
    model.format.quantization,
    model.format.sizeLabel,
    ...model.providers
  ].join(" ").toLowerCase().includes(normalized));
}

function modelTriggerLabel(model: ModelManifest) {
  if (model.id === "tiny-gpt2") return { name: "Tiny GPT-2", variant: "" };
  if (model.family === "smollm") return { name: "SmolLM2", variant: model.label.match(/\d+M/i)?.[0] ?? "" };
  if (model.id === "qwen25-coder-0.5b") return { name: "Qwen2.5", variant: "0.5B" };
  if (model.family === "llama") return { name: "Llama3.2", variant: "1B" };
  if (model.id === "qwen3-1.7b") return { name: "Qwen3", variant: "1.7B" };
  return { name: model.label, variant: "" };
}
