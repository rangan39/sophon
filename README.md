# Sophon

Sophon is a browser-based mechanistic interpretability visualization workbench.

The current MVP is a Next.js + React Three Fiber app that shows how transformer internals could be explored across prompt types, tokens, layers, attention paths, and feature-like activations.

## What It Shows

- A 3D layer-by-token grid for transformer-style activations
- Prompt presets for factual recall, induction, code, ambiguity, and instruction boundaries
- Metric modes for residual signal, attribution, and logit-lens confidence
- Attention-style arcs between tokens
- A side inspector for selected token/layer details
- SAE-style feature labels and activation values

## Important Note

This MVP ships with generated demo data by default.

The app now also includes a Modal + FastAPI + TransformerLens service scaffold in `services/interp-api/` for live `gpt2-small` runs. When `INTERP_API_URL` is not configured, the frontend stays on the generated demo data. When it is configured, the prompt runner calls the backend and renders real tokenization, residual summaries, logit-lens confidence, and top-k attention arcs.

SAE feature labels are still placeholders in the live path. Real SAE integration is a later step.

## Tech Stack

- Next.js
- TypeScript
- React
- Three.js
- React Three Fiber
- Drei
- Lucide icons

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

## Project Structure

```txt
src/app/
  App routes, layout, and global styles

src/components/
  Sophon workbench and 3D visualization UI

src/lib/
  Demo prompt data and shared types

services/interp-api/
  Modal-hosted TransformerLens API scaffold
```

## Live TransformerLens Backend

The frontend caps prompt input at 280 characters. The backend is still authoritative and rejects prompts over 64 model tokens.

Local backend development:

```bash
cd services/interp-api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn sophon_interp.api:create_app --factory --reload
```

Modal development:

```bash
cd services/interp-api
modal serve modal_app.py
```

Deploy:

```bash
modal deploy services/interp-api/modal_app.py
```

Frontend environment:

```txt
INTERP_API_URL=https://your-modal-app.modal.run
INTERP_API_TOKEN=optional-shared-token
```

## Mechanistic Interpretability Concepts

Sophon visualizes a few core ideas:

- **Tokens**: pieces of the prompt processed by the model
- **Layers**: repeated transformer blocks that update token representations
- **Residual stream**: the model's main internal information channel
- **Attention**: how one token reads information from another token
- **Logit lens**: what token the model appears to be leaning toward at an intermediate layer
- **SAE features**: interpretable feature-like directions learned from activations

## Roadmap

- Load real Neuronpedia export files
- Add prompt-run JSON import/export
- Add TransformerLens or SAELens backend integration
- Add activation patching views
- Add side-by-side clean/corrupt prompt comparison
- Add real logit-lens and attribution data
- Add saved analysis sessions

## Repository

```txt
https://github.com/rangan39/sophon
```
