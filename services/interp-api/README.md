# Sophon Interpretability API

Modal-hosted TransformerLens service for producing compact `PromptRun` JSON from real model activations.

## Local Development

```bash
cd services/interp-api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn sophon_interp.api:create_app --factory --reload
```

## Modal Development

```bash
cd services/interp-api
modal serve modal_app.py
```

Deploy:

```bash
modal deploy modal_app.py
```

Configure the frontend with the deployed Modal URL:

```txt
INTERP_API_URL=https://your-workspace--sophon-interp-fastapi-app.modal.run
INTERP_API_TOKEN=optional-shared-token
```

If you want bearer-token protection, set `AUTH_TOKEN` in the Modal environment and set the same value as `INTERP_API_TOKEN` for the Next.js deployment. With no `AUTH_TOKEN`, the service accepts requests without authentication.

The v1 service is intentionally compact: prompts are capped at 64 model tokens, dense activations are reduced to scalar summaries, and attention is returned as top-k edges only.

## API Contract

The frontend/backend contract is documented from the repository root:

- `docs/api/interp-api-v1.md`
- `docs/api/prompt-run.schema.json`

Keep those files in sync when changing request fields, response fields, error codes, or authentication behavior.

The backend remains in this monorepo for now. The repository split decision is recorded in `docs/architecture/0001-backend-repository-split.md`.
