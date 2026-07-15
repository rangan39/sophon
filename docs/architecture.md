# Sophon runtime architecture

Sophon is a browser-side compatibility and benchmark tool for small causal language models in ONNX format. Its support claims are intentionally narrower than its model catalog.

## Runtime flow

```text
Model manifest
  → persistent model worker
  → model adapter
  → ONNX Runtime provider
  → generation result / benchmark result
```

The browser owns one long-lived worker. Requests are queued inside that worker so model loading and inference cannot race. Loaded sessions remain available across prompts until the user changes models, explicitly unloads a model, or closes the page.

## Model support levels

- `verified`: Sophon has a known graph contract and has validated the model against its own runtime.
- `experimental`: a compatible repository is known, but Sophon has not certified the graph, tokenizer, provider support, and benchmark behavior together.

Only verified entries should be treated as supported. Experimental entries are available for compatibility work and may fail on a particular browser or device.

## Adapters

### Full-context ONNX

The bundled Tiny GPT-2 model uses `input_ids` and `attention_mask` and returns `logits`. It recomputes the active context for each generated token. This is a useful correctness baseline but is not suitable for scaling to larger models.

The UI accepts prompts of arbitrary length. Because the bundled graph has a fixed 64-token context, the adapter applies a sliding window and sends the most recent 64 tokens. Results report the original prompt token count, active context count, and number of omitted earlier tokens.

### Transformers.js

Experimental remote models use the Transformers.js text-generation pipeline. The pipeline owns architecture-specific generation and KV-cache handling. Sophon requires access to the pipeline tokenizer so input and output token counts are real tokenizer counts rather than whitespace estimates.

### With-past ONNX

A native generic KV-cache adapter is deliberately deferred. It requires model exports with explicit past-key/value inputs and present-key/value outputs, plus architecture-specific tensor naming and dimensions. It should be added only alongside a verified model artifact and conformance fixture.

## Metrics

Sophon currently reports:

- model load/reuse time
- generation time
- first-token latency for the native full-context adapter
- tokenizer-derived input and output token counts
- output tokens per second
- provider used for the run

Remote pipeline first-token latency remains `null` until token streaming is wired to a supported streamer callback. Sophon does not estimate browser GPU memory because browsers do not expose a reliable cross-platform value.

## Benchmarks

The quick benchmark uses fixed prompts, one warm-up run per prompt, deterministic greedy decoding, and three measured runs per prompt. The UI reports medians and the number of successful runs. This is intended for comparing models on one device, not for claiming results across machines.

## Next technical milestones

1. Add a verified `with-past` model export and native KV-cache adapter.
2. Pin verified remote repositories to immutable revisions and record artifact sizes/checksums.
3. Stream tokens and measure first-token latency for remote pipelines.
4. Cache fetched model artifacts with revision-aware keys and expose storage controls.
5. Add model conformance fixtures that validate tokenizer, graph inputs/outputs, EOS behavior, and provider compatibility.
6. Add a larger benchmark mode with enough measured samples for percentile reporting.
