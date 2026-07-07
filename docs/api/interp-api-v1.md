# Sophon Interpretability API v1

This document is the contract between the Next.js frontend and the TransformerLens/FastAPI backend.

The current implementation lives in `services/interp-api`. The frontend must treat the backend as an HTTP service and should not depend on backend source files at runtime.

## Local Topology

Docker Compose runs two services:

- `frontend`: Next.js app, exposed on `FRONTEND_PORT`, default `3000`.
- `interp-api`: FastAPI/TransformerLens backend, exposed on `BACKEND_PORT`, default `8000`.

Inside Docker, the frontend calls the backend at `http://interp-api:8000`.

From the browser, requests go to the Next.js app. The browser does not call the backend directly.

## Environment Variables

Frontend:

- `INTERP_API_URL`: backend base URL used by `src/app/api/runs/route.ts`.
- `INTERP_API_TOKEN`: optional bearer token sent from the Next.js proxy to the backend.
- `FRONTEND_PORT`: Docker Compose host port for the Next.js app.

Backend:

- `AUTH_TOKEN`: optional bearer token required by `POST /runs`.
- `ALLOWED_ORIGINS`: comma-separated CORS origins for direct backend access.
- `BACKEND_PORT`: Docker Compose host port for the FastAPI app.
- `HF_HOME`, `TRANSFORMERS_CACHE`, `TORCH_HOME`: model and torch cache locations.

## Authentication

`POST /runs` accepts unauthenticated requests when `AUTH_TOKEN` is empty.

When `AUTH_TOKEN` is set, callers must send:

```txt
Authorization: Bearer <token>
```

The Next.js proxy reads `INTERP_API_TOKEN` and forwards it as the bearer token.

## Endpoints

### `GET /health`

Returns backend health.

```json
{ "ok": true }
```

### `GET /models`

Returns supported model IDs.

```json
{ "models": ["gpt2-small"] }
```

### `POST /runs`

Runs a prompt through the backend and returns a compact transformer trace.

Request body:

```json
{
  "prompt": "The proof is",
  "model": "gpt2-small",
  "maxTokens": 64,
  "topKPredictions": 5,
  "topKAttentionEdges": 8
}
```

Success response:

Returns a `PromptRun`. The canonical JSON Schema is `docs/api/prompt-run.schema.json`.

Important fields:

- `tokens`: tokenizer output with display labels and token kinds.
- `layers`: per-layer scalar arrays and attention edges.
- `finalPredictions`: top next-token predictions.
- `featuresAvailable`: whether `topFeature` values should be treated as real feature data.

Error response:

```json
{
  "code": "PROMPT_TOO_LONG",
  "message": "Prompt exceeds the model token cap.",
  "tokenCount": 72,
  "maxTokens": 64
}
```

Known error codes:

- `PROMPT_TOO_LONG`: prompt exceeds backend model token limit.
- `REQUEST_FAILED`: request was syntactically valid JSON but could not be processed.
- `SERVICE_UNAVAILABLE`: frontend proxy could not reach the backend service.

## Versioning Rules

Additive fields are allowed if existing fields keep their meaning.

Breaking changes require a new schema version or a compatibility adapter in the Next.js proxy.

The frontend should continue to validate returned payloads through `parsePromptRun` before rendering.

