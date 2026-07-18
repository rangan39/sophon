"use client";

import { ChevronDown } from "lucide-react";
import { MODEL_REGISTRY, getModelDefinition, type ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";

type SophonModelSelectorProps = {
  capabilities: RuntimeCapabilities | null;
  disabled?: boolean;
  loading?: boolean;
  modelId: string;
  onSelect: (modelId: string) => void;
};

export function SophonModelSelector({ capabilities, disabled = false, loading = false, modelId, onSelect }: SophonModelSelectorProps) {
  const selectedModel = getModelDefinition(modelId);
  const selectedAvailability = loading ? "downloading" : modelAvailability(capabilities, selectedModel);

  return (
    <div className="relative flex h-full w-[132px] shrink-0 items-center border-x border-white/[.1] transition-colors hover:bg-white/[.04] focus-within:bg-white/[.05] sm:w-fit sm:min-w-[10.5rem] sm:max-w-60">
      <select
        aria-describedby="sophon-model-availability"
        aria-label={`Choose model. Current model: ${selectedModel.label}, ${selectedAvailability}.`}
        className="h-full min-w-0 max-w-full flex-auto cursor-pointer appearance-none truncate rounded-none border-0 bg-transparent pl-3 pr-7 font-mono !text-[9px] uppercase tracking-widest text-sophon-signal-soft [field-sizing:content] [font-stretch:normal] [text-shadow:0_0_10px_rgb(255_105_75/.55)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sophon-warning disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        value={modelId}
      >
        {MODEL_REGISTRY.map((model) => {
          const availability = loading && model.id === modelId ? "downloading" : modelAvailability(capabilities, model);
          return (
            <option className="bg-[#0d0f15] text-[#f4f0e9]" disabled={availability === "unavailable"} key={model.id} value={model.id}>
              {model.label} · {availability}
            </option>
          );
        })}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 size-3 text-white/60" />
      <span className="sr-only" id="sophon-model-availability">Selected model availability: {selectedAvailability}.</span>
    </div>
  );
}

function modelAvailability(capabilities: RuntimeCapabilities | null, model: ModelManifest) {
  if (!capabilities) return "checking compatibility";
  const supported = (capabilities.webgpu && model.providers.includes("webgpu"))
    || (capabilities.wasm && model.providers.includes("wasm"));
  return supported ? model.verification : "unavailable";
}
