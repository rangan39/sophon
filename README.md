# Sophon

Sophon is a browser-based mechanistic interpretability visualization workbench.

The current MVP is a Next.js + React Three Fiber app that shows how transformer internals could be explored across prompt types, tokens, layers, attention paths, and feature-like activations.

## What It Shows

- A 3D layer-by-token grid for transformer-style activations
- Prompt input backed by a browser ONNX WebGPU runtime
- Metric modes for hidden-state signal summaries
- Attention-style arcs between tokens
- A side inspector for selected token/layer details
- SAE-style feature labels and activation values

## Important Note

Sophon is configured to hard-fail when browser WebGPU is unavailable. There is no server fallback in the frontend path.

The browser runtime requires an ONNX/WebGPU model export that exposes hidden states. Set `NEXT_PUBLIC_SOPHON_WEBGPU_MODEL` to the Hugging Face model id for that export. If the configured model only exposes logits, Sophon fails instead of fabricating trace measurements.

SAE feature labels are still placeholders. Real SAE integration is a later step.

## Tech Stack

- Next.js
- TypeScript
- React
- Three.js
- React Three Fiber
- Drei
- Lucide icons
- ONNX Runtime WebGPU through Transformers.js

## Getting Started

Install dependencies:

```bash
npm install
```

Run the local dev server:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Build for production:

```bash
npm run build
```

Optional browser model override:

```bash
NEXT_PUBLIC_SOPHON_WEBGPU_MODEL=your-org/your-gpt2-hidden-states-onnx npm run dev
```

## Project Structure

```txt
src/app/
  App routes, layout, and global styles

src/components/
  Sophon workbench and 3D visualization UI

src/lib/
  Shared prompt-run types and frontend API client

services/interp-api/
  Legacy/research TransformerLens API scaffold
```

## Legacy TransformerLens Backend

`services/interp-api/` remains in the repo for research comparison and future export work. The frontend no longer calls it.

## Mechanistic Interpretability Concepts

Sophon visualizes a few core ideas:

- **Tokens**: pieces of the prompt processed by the model
- **Layers**: repeated transformer blocks that update token representations
- **Hidden states**: model representations emitted by the browser ONNX export
- **Attention**: how one token reads information from another token
- **SAE features**: interpretable feature-like directions learned from activations

## Roadmap

- Load real Neuronpedia export files
- Add prompt-run JSON import/export
- Add a custom ONNX export with hidden states and attention tensors
- Add activation patching views
- Add side-by-side clean/corrupt prompt comparison
- Add real attribution data
- Add saved analysis sessions

## Repository

```txt
https://github.com/rangan39/sophon
```
