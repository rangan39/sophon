# Sophon runtime architecture

Sophon is a browser-side compatibility and benchmark tool for small causal language models in ONNX format. Its support claims are intentionally narrower than its model catalog.

## Runtime flow

```text
Model manifest
  → persistent model worker
  → model adapter
  → ONNX Runtime provider
  → token telemetry / generation result / benchmark result
```

The browser owns one long-lived worker. Requests are queued inside that worker so model loading and inference cannot race. Loaded sessions remain available across prompts until the user changes models, explicitly unloads a model, or closes the page. A shared discriminated protocol validates requests, events, and completed results at the worker boundary. Operations have recovery timeouts; a timed-out or malformed worker is terminated so the UI cannot remain pending forever.

## Model support levels

- `verified`: Sophon has a known graph contract and has validated the model against its own runtime.
- `experimental`: a compatible repository is known, but Sophon has not certified the graph, tokenizer, provider support, and benchmark behavior together.

Only verified entries should be treated as supported. Experimental entries are available for compatibility work and may fail on a particular browser or device.

## Adapters

### Full-context ONNX

The bundled Tiny GPT-2 model uses `input_ids` and `attention_mask` and returns `logits`. It recomputes the active context for each generated token. This is a useful correctness baseline but is not suitable for scaling to larger models.

The UI accepts prompts of arbitrary length. Because the bundled graph has a fixed 64-token context, the adapter applies a sliding window and sends the most recent 64 tokens. Results report the original prompt token count, active context count, and number of omitted earlier tokens.

### Transformers.js

Experimental remote models use the Transformers.js text-generation pipeline. The pipeline owns architecture-specific generation and KV-cache handling. Sophon requires access to the pipeline tokenizer so input and output token counts are real tokenizer counts rather than whitespace estimates. A Transformers.js `TextStreamer` timestamps generated token IDs before the completed pipeline result returns.

### With-past ONNX

A native generic KV-cache adapter is deliberately deferred. It requires model exports with explicit past-key/value inputs and present-key/value outputs, plus architecture-specific tensor naming and dimensions. It should be added only alongside a verified model artifact and conformance fixture.

## Metrics

Sophon timestamps tokens inside the worker, on the same monotonic clock as inference. Timing begins after model loading and before prompt tokenization, so model download/load time is reported separately. It reports:

- model load/reuse time
- time to first token (TTFT)
- end-to-end generation latency
- decode tokens per second, excluding the first output token
- time per output token (TPOT)
- p95 inter-token latency in the completed result
- tokenizer-derived input and output token counts
- provider used for the run

For output token timestamps `t[0..n-1]` and request start `s`, the core calculations are:

```text
TTFT       = t[0] - s
E2E        = t[n-1] - s
Decode TPS = 1000 × (n - 1) / (t[n-1] - t[0])
TPOT       = (t[n-1] - t[0]) / (n - 1)
```

Decode TPS and TPOT remain unavailable until at least two output tokens exist. Sophon does not estimate browser GPU memory because browsers do not expose a reliable cross-platform value.

Request-scoped worker events expose the same measurements during decoding without launching extra inference or blocking chat. Completed metrics are attached to the generation result, and the compact chat metadata surfaces the most useful values without a permanent telemetry panel.

## Token display

Generation results include exact tokenizer IDs and individually decoded text for both the original input and generated output. Messages render as clean text by default; the opt-in token and word modes expose boundaries, token indexes, vocabulary IDs, and active-context state on hover, click, or keyboard focus. Input tokens removed by the sliding context window remain visible but are marked as windowed out.

## Benchmarks

The separate quick benchmark API uses fixed prompts, one warm-up run per prompt, deterministic greedy decoding, and three measured runs per prompt. It reports median TTFT, end-to-end latency, decode throughput, and TPOT. It does not auto-run or feed the live HUD. This is intended for controlled comparisons on one device, not for claiming results across machines.

## Next technical milestones

1. Add a verified `with-past` model export and native KV-cache adapter.
2. Record remote artifact sizes/checksums and define a review process for updating pinned revisions.
3. Cache fetched model artifacts with revision-aware keys and expose storage controls.
4. Add model conformance fixtures that validate tokenizer, graph inputs/outputs, EOS behavior, and provider compatibility.
5. Add a larger benchmark mode with enough measured samples for percentile reporting and browser/GPU metadata.
