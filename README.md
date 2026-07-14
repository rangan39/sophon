# Sophon

Sophon is a browser-based local AI chat tool. It runs ONNX language models in a Web Worker with WebGPU, so prompts can stay on the device instead of traveling to a server.

Production app: [sophon-coral.vercel.app](https://sophon-coral.vercel.app)

## What it does

- Chats with a local ONNX model directly in the browser
- Uses WebGPU through ONNX Runtime Web
- Keeps model loading and inference off the main UI thread
- Loads additional models lazily through the model registry
- Shows model, runtime, and generation status in a compact HUD-style interface
- Supports local Tiny GPT-2 assets and remote Transformers.js-compatible ONNX models

## Stack

- Next.js 14 App Router
- React 18 and TypeScript
- shadcn-style UI primitives
- ONNX Runtime Web
- Transformers.js
- WebGPU
- Vercel

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build and validate the production bundle:

```bash
npm run build
npm run lint
```

WebGPU works best in a recent Chromium-based browser. The first run may download and cache the selected model.

## Model architecture

Models are defined in [`src/lib/onnx-models.ts`](src/lib/onnx-models.ts). The registry keeps model metadata separate from the chat UI and supports lazy selection:

```text
Model registry → model adapter → Web Worker → ONNX Runtime/WebGPU → chat UI
```

The current registry includes:

- Tiny GPT-2 — bundled local starter model
- SmolLM2 135M and 360M — small instruction models
- Qwen2.5 Coder 0.5B — coding-focused model
- Llama 3.2 1B — general-purpose model
- Qwen3 1.7B — larger chat model

Remote entries require compatible ONNX weights hosted in a Transformers.js-compatible repository. Larger models need more GPU memory and can take longer to download.

## Local model assets

The bundled preset lives under:

```text
public/models/sshleifer-tiny-gpt2-trace/
  onnx/model.onnx
  tokenizer.json
  tokenizer_config.json
  sophon-trace.json
```

The local adapter expects causal language model inputs named `input_ids` and `attention_mask`, with a `logits` output. Remote models are loaded through the Transformers.js adapter instead.

## Project layout

```text
src/components/sophon-workbench.tsx  Chat/HUD interface
src/components/ui/                    shadcn-style primitives
src/lib/onnx-models.ts                 Model registry
src/lib/onnx-runner.ts                 Local and remote adapters
src/workers/onnx-worker.ts             Background inference worker
public/models/                         Bundled model assets
```

## Limitations

WebGPU support and ONNX operator coverage vary by browser and device. Model downloads are client-side, and the app currently reports runtime failures rather than falling back to a server inference provider.
