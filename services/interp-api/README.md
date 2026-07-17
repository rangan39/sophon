# Sophon Interpretability API

Optional legacy TransformerLens service for producing compact `PromptRun` JSON from real model activations. The current Sophon browser UI does not require this service.

## Local Development

```bash
cd services/interp-api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn sophon_interp.api:create_app --factory --reload
```

On Apple Silicon, run the service directly instead of through Docker if you want PyTorch to use the system GPU through Metal/MPS. Docker on macOS generally will not expose the Apple GPU to PyTorch.

## Modal Development

```bash
cd services/interp-api
modal serve modal_app.py
```

Deploy:

```bash
modal deploy modal_app.py
```

Configure allowed browser origins and an optional bearer token on the API deployment:

```txt
ALLOWED_ORIGINS=https://your-sophon.example
AUTH_TOKEN=replace-with-a-long-random-value
```

With no `AUTH_TOKEN`, the service accepts run requests without authentication. The secure default CORS policy only allows local development origins; set `ALLOWED_ORIGINS` explicitly before exposing a deployment. Inference requests are serialized because the process shares one cached model/GPU runtime.

The Compose service is opt-in:

```bash
docker compose --profile legacy-interpretability up interp-api
```

The v1 service is intentionally compact: prompts are capped at 64 model tokens, dense activations are reduced to scalar summaries, and attention is returned as top-k edges only.
