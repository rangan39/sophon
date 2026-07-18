# Sophon

Sophon is a browser-only local AI chat tool. It runs ONNX language models in a Web Worker with WebGPU or WASM, so prompts stay on the device instead of traveling to an inference server.

Production app: [sophon-coral.vercel.app](https://sophon-coral.vercel.app)

## What it does

- Chats with a local ONNX model directly in the browser
- Uses WebGPU or WASM through Transformers.js and ONNX Runtime Web
- Keeps model loading and inference off the main UI thread
- Loads additional models lazily through a strict model registry
- Shows model, runtime, and generation status in a compact HUD-style interface
- Supports local Tiny GPT-2 assets and remote Transformers.js-compatible ONNX models
- Measures normal chat generations with tokenizer-derived TTFT, decode throughput, TPOT, and end-to-end latency
- Provides an opt-in text/token/word lens with exact token IDs and context-window status

## Stack

- Next.js App Router
- React 19 and strict TypeScript
- Tailwind CSS and native platform controls
- Transformers.js
- ONNX Runtime Web, WebGPU, and WASM
- Vercel

## Run locally

Use Node.js 22 (the repository includes an `.nvmrc`), then install exactly from the lockfile:

```bash
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build and validate the production bundle:

```bash
npm run build
npm run budget:bundle
npm run check
npm run benchmark:runtime
```

WebGPU works best in a recent Chromium-based browser. The first run may download and cache the selected model.

Build and run the production container:

```bash
docker build -f Dockerfile.frontend -t sophon .
docker run --rm -p 3000:3000 sophon
```

`docker compose up frontend` uses the Dockerfile's development target with source mounts and hot reload.

The repository has no inference backend. The browser worker owns model loading, tokenization, generation, and telemetry in both development and production.

## Model architecture

Models are defined in [`src/lib/onnx-models.ts`](src/lib/onnx-models.ts). The registry records provider preference, quantization, context, source revision, and verification status:

```text
Model manifest → persistent browser Web Worker → Transformers.js pipeline → ONNX Runtime provider → token telemetry → chat UI
```

The current registry includes:

- Tiny GPT-2 — bundled local starter model
- SmolLM2 135M and 360M — small instruction models
- Qwen2.5 Coder 0.5B — coding-focused model
- Llama 3.2 1B — general-purpose model
- Qwen3 1.7B — larger chat model

Tiny GPT-2 is currently the only `verified` entry. Remote entries are explicitly marked `experimental`; their known ONNX repositories are pinned to immutable revisions, but they may still fail on a particular browser or device until Sophon certifies the complete tokenizer, graph, and provider combination.

## Local model assets

The bundled preset is tracked under:

```text
public/models/sshleifer-tiny-gpt2-trace/
  config.json
  generation_config.json
  onnx/model.onnx
  tokenizer.json
  tokenizer_config.json
```

Those five files total 4,051,176 bytes: the cached-decoder ONNX graph is 491,629 bytes and the tokenizer is 3,558,232 bytes. The application serves them through the content-addressed URL prefix `/models/v-196cb8befc7d/sshleifer-tiny-gpt2-trace/`, which rewrites to the tracked directory and can therefore use immutable browser caching without duplicating the assets.

The graph uses explicit past-key/value inputs and present-key/value outputs. Bundled and remote models therefore share one Transformers.js generation path, including streaming, cancellation, caching, and token metrics. Instruction models receive structured chat turns and apply their tokenizer-native chat templates; Tiny GPT-2 remains a completion model.

To regenerate the bundled graph with the standard exporter:

```bash
python -m pip install "optimum-onnx==0.1.0"
optimum-cli export onnx --model sshleifer/tiny-gpt2 --task text-generation-with-past --opset 18 artifacts/tiny-gpt2
```

Copy the generated `config.json`, `generation_config.json`, and `model.onnx` into the tracked preset, then update the content hash and size in the registry and Next configuration. The registry tests fail when those values drift.

## Project layout

```text
src/components/sophon-workbench.tsx  Chat/HUD interface
src/components/ui/                    Small shared message/button primitives
src/lib/onnx-models.ts                 Model registry
src/lib/generation-metrics.ts          Standardized token timing calculations
src/lib/onnx-worker-protocol.ts         Validated worker message boundary
src/lib/onnx-runner.ts                 Unified generation pipeline
src/workers/onnx-worker.ts             Background inference worker
public/models/                         Bundled model assets
```

## Limitations

WebGPU support and ONNX operator coverage vary by browser and device. Model downloads are client-side, and the app currently reports runtime failures rather than falling back to a server inference provider.

All models use architecture-specific KV caching through Transformers.js. See [`docs/architecture.md`](docs/architecture.md) for support semantics and metric definitions.

Long prompts are accepted, but each model can only receive its own context window. Sophon reserves space for the response, removes the oldest complete turns first, then left-truncates an oversized remaining turn. The bundled model supports 1,024 positions and reports how many earlier tokens were omitted.
