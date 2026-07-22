# Sophon

Sophon is a browser-only local AI chat tool. It runs ONNX language models in a Web Worker with WebGPU, so prompts stay on the device instead of traveling to an inference server.

Production app: [sophon-coral.vercel.app](https://sophon-coral.vercel.app)

## What it does

- Chats with a local ONNX model directly in the browser
- Uses WebGPU through Transformers.js and ONNX Runtime Web
- Keeps model loading and inference off the main UI thread
- Downloads a model only after the user selects it from a strict registry
- Resumes interrupted weight downloads from verified browser-private storage
- Shows model, runtime, and generation status in a compact HUD-style interface
- Offers Cohere Labs' Tiny Aya Global, Earth, Fire, and Water variants
- Measures normal chat generations with tokenizer-derived TTFT, decode throughput, TPOT, and end-to-end latency
- Provides an opt-in text/token/word lens with exact token IDs and context-window status

## Stack

- Next.js App Router
- React 19 and strict TypeScript
- Tailwind CSS and native platform controls
- Transformers.js
- ONNX Runtime Web and WebGPU
- OPFS, IndexedDB, and streaming SHA-256 verification
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
```

WebGPU works best in a recent Chromium-based browser. Opening Sophon does not download model weights; the first explicit model selection downloads and caches about 2.35 GB.

Probe the pinned model CDN across repeated concurrency trials (defaults: three trials, 64 MiB per trial, concurrency 1/2/4):

```bash
npm run benchmark:download
```

Override the matrix when comparing a particular connection:

```bash
SOPHON_BENCHMARK_TRIALS=5 \
SOPHON_BENCHMARK_BYTES=134217728 \
SOPHON_BENCHMARK_CONCURRENCY=2,4,6,8,12 \
npm run benchmark:download
```

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

- Tiny Aya Global — balanced multilingual coverage
- Tiny Aya Earth — optimized for West Asian and African languages
- Tiny Aya Fire — optimized for South Asian languages
- Tiny Aya Water — optimized for European and Asia-Pacific languages

All four entries are 3.35B-parameter, q4f16 ONNX conversions with an 8K context window. They are WebGPU-only, pinned to immutable repository revisions, and marked `experimental` until Sophon certifies each tokenizer, graph, and browser combination.

Tiny Aya is an open-weights research release governed by CC BY-NC 4.0 and the Cohere Labs Acceptable Use Policy. Commercial use is not permitted under that license. Each variant has a separate browser cache key, so caching all four can consume roughly 9.4 GB.

## Model delivery and caching

Selecting a model starts a pinned Hugging Face download inside the browser worker. When supported, Sophon downloads 64 MiB ranges through a bounded adaptive queue that starts at four requests, probes up to twelve only when measured goodput improves, and backs off on transient failures. Every range is streamed directly into the Origin Private File System and simultaneously checked against a pinned segment SHA-256 digest. A corrupt response retries only its range, and a fresh download does not need a final OPFS reread. Resumed downloads retain the complete ordered SHA-256 path as a compatibility fallback and overlap it with remaining network work.

Completed ranges become resumable in batches of four or after one second, whichever comes first. Every checkpoint flushes OPFS before its strict IndexedDB commit, so a crash can cause bounded redundant downloading but cannot authorize bytes that were not durably written. A reload or model switch can therefore reuse durable ranges instead of restarting a multi-gigabyte file. Set `NEXT_PUBLIC_SOPHON_ADAPTIVE_DOWNLOADS=0` before building to retain the fixed four-request fallback.

Verified OPFS `File` objects are handed to Transformers.js as ONNX external data, so weights are not duplicated in CacheStorage. The graph, configuration, generation settings, and tokenizer files are also pinned by exact size and SHA-256, verified by Sophon, and then stored under Transformers.js-compatible CacheStorage keys. A cached artifact is rehashed once per browser-worker session before runtime use.

Delivery fails closed when OPFS, synchronous worker access, CacheStorage, strong validators, or HTTP ranges are unavailable; there is no unverified multi-gigabyte fallback. Sophon checks the browser's available storage before starting and surfaces quota failures explicitly. Model selection also makes a best-effort persistent-storage request, while the browser retains final control over quota and eviction.

Switching models terminates the active worker and releases its runtime resources while verified files remain under browser-managed site storage. The UI reports approximate usage and quota through the Storage API and distinguishes downloading, resuming, verification, and cached initialization.

## Repacking model artifacts

The checked-in artifact seed records the exact upstream files, immutable revisions, sizes, and hashes for all four models. Build-only tooling can repack the current imbalanced two-file q4f16 layout into five approximately 448 MiB ONNX sidecars without changing tensor bytes or node definitions. It also topologically orders the upstream nodes so the derivative passes the ONNX checker:

```bash
python3.12 -m venv artifacts/model-build-venv
artifacts/model-build-venv/bin/pip install -r scripts/model-build-requirements.txt
artifacts/model-build-venv/bin/python scripts/reshard_onnx.py \
  --model-id tiny-aya-global \
  --input-dir artifacts/models/tiny-aya-global-source \
  --output-dir artifacts/models/tiny-aya-global-five-shard
artifacts/model-build-venv/bin/python scripts/verify_model_artifacts.py \
  --artifact-dir artifacts/models/tiny-aya-global-five-shard \
  --source-dir artifacts/models/tiny-aya-global-source
```

The source snapshot must contain every pinned file recorded in `models/model-artifacts.seed.json`; unrelated files are ignored. Process one model at a time and publish verified derivatives to immutable Hugging Face revisions; model weights do not belong in the Next.js or Vercel build.

## Project layout

```text
src/components/sophon-workbench.tsx  Chat/HUD interface
src/components/ui/                    Small shared message/button primitives
src/lib/onnx-models.ts                 Model registry
src/lib/model-delivery/                Resumable OPFS model transport
src/lib/generation-metrics.ts          Standardized token timing calculations
src/lib/onnx-worker-protocol.ts         Validated worker message boundary
src/lib/onnx-runner.ts                 Unified generation pipeline
src/workers/onnx-worker.ts             Background inference worker
```

## Limitations

WebGPU support and ONNX operator coverage vary by browser and device. Model downloads are client-side, and the app currently reports runtime failures rather than falling back to a server inference provider.

OPFS removes repeated network work and bounds download buffers, but ONNX Runtime still materializes the complete external data while creating a WebGPU session. Browser storage is not GPU or unified memory.

All models use architecture-specific KV caching through Transformers.js. See [`docs/architecture.md`](docs/architecture.md) for support semantics and metric definitions.

Long prompts are accepted, but each model can only receive its 8K context window. Sophon reserves space for the response, removes the oldest complete turns first, then left-truncates an oversized remaining turn and reports how many earlier tokens were omitted.
