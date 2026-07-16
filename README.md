# Sophon

Sophon is a browser-based local AI chat tool. It runs ONNX language models in a Web Worker with WebGPU, so prompts can stay on the device instead of traveling to a server.

Production app: [sophon-coral.vercel.app](https://sophon-coral.vercel.app)

## What it does

- Chats with a local ONNX model directly in the browser
- Uses WebGPU through ONNX Runtime Web
- Keeps model loading and inference off the main UI thread
- Loads additional models lazily through a strict model registry
- Shows model, runtime, and generation status in a compact HUD-style interface
- Supports local Tiny GPT-2 assets and remote Transformers.js-compatible ONNX models
- Measures normal chat generations live with tokenizer-derived TTFT, decode throughput, TPOT, and end-to-end latency; telemetry is on by default
- Highlights exact input and output token boundaries with inspectable token IDs and context-window status

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
npm test
```

WebGPU works best in a recent Chromium-based browser. The first run may download and cache the selected model.

## Model architecture

Models are defined in [`src/lib/onnx-models.ts`](src/lib/onnx-models.ts). The registry records graph strategy, provider support, quantization, source revision, and verification status:

```text
Model manifest → persistent Web Worker → model adapter → ONNX Runtime provider → token telemetry → chat UI
```

The current registry includes:

- Tiny GPT-2 — bundled local starter model
- SmolLM2 135M and 360M — small instruction models
- Qwen2.5 Coder 0.5B — coding-focused model
- Llama 3.2 1B — general-purpose model
- Qwen3 1.7B — larger chat model

Tiny GPT-2 is currently the only `verified` entry. Remote entries are explicitly marked `experimental`; they require compatible ONNX weights hosted in a Transformers.js-compatible repository and may fail on a particular browser or device.

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
src/lib/generation-metrics.ts          Standardized token timing calculations
src/lib/onnx-runner.ts                 Local and remote adapters
src/workers/onnx-worker.ts             Background inference worker
public/models/                         Bundled model assets
```

## Limitations

WebGPU support and ONNX operator coverage vary by browser and device. Model downloads are client-side, and the app currently reports runtime failures rather than falling back to a server inference provider.

The native Tiny GPT-2 adapter is a full-context correctness baseline and does not use a KV cache. Remote pipelines may use architecture-specific caching internally. See [`docs/architecture.md`](docs/architecture.md) for support semantics, metric definitions, and the next implementation milestones.

Long prompts are accepted, but each model can only receive its own context window. For the bundled 64-token graph, Sophon keeps the most recent 64 tokens and reports how many earlier tokens were omitted.
