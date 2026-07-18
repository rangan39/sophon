"use client";

import { ChevronDown } from "lucide-react";
import { MODEL_REGISTRY, getModelDefinition, type ModelManifest } from "@/lib/onnx-models";
import type { RuntimeCapabilities } from "@/lib/onnx-types";

type SophonModelSelectorProps = {
  capabilities: RuntimeCapabilities | null;
  disabled?: boolean;
  modelId: string;
  onSelect: (modelId: string) => void;
};

export function SophonModelSelector({ capabilities, disabled = false, modelId, onSelect }: SophonModelSelectorProps) {
  const selectedModel = getModelDefinition(modelId);
  const selectedAvailability = modelAvailability(capabilities, selectedModel);

  return (
    <div className="sophon-glass-tile sophon-glass-interactive relative flex h-11 w-[clamp(108px,28vw,160px)] shrink-0 items-center rounded-xl sm:h-9">
      <span aria-hidden="true" className="pointer-events-none absolute left-2.5 font-serif text-[11px] text-sophon-signal-soft">μ</span>
      <select
        aria-describedby="sophon-model-availability"
        aria-label={`Choose model. Current model: ${selectedModel.label}, ${selectedAvailability}.`}
        className="h-full min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-xl border-0 bg-transparent pl-7 pr-7 font-mono text-[10px] uppercase tracking-[0.06em] text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-sophon-warning disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        value={modelId}
      >
        {MODEL_REGISTRY.map((model) => {
          const availability = modelAvailability(capabilities, model);
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
