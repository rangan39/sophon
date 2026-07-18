# Sophon runtime architecture

Sophon is a browser-only local chat and compatibility tool for small causal language models in ONNX format. Its support claims are intentionally narrower than its model catalog.

## Runtime flow

```text
Model manifest
  → persistent model worker
  → Transformers.js pipeline
  → ONNX Runtime provider
  → token telemetry / generation result
```

The browser owns one long-lived worker. Requests are queued inside that worker so model loading and inference cannot race. Loaded sessions remain available across prompts until the user changes models, explicitly unloads a model, or closes the page. Generation cancellation is request-scoped so stopping a response preserves the loaded model cache. A shared discriminated protocol validates requests, events, and completed results at the worker boundary. Operations have recovery timeouts; a timed-out or malformed worker is terminated so the UI cannot remain pending forever.

## Repository boundary

Sophon has no inference server or server fallback. Next.js delivers the application shell and versioned static model files; the Web Worker owns tokenization, model sessions, generation, and telemetry. Remote experimental artifacts are fetched directly by Transformers.js from their pinned Hugging Face revisions. Prompts are never routed through a repository-owned API.

## Model support levels

- `verified`: Sophon has a known graph contract and has validated the model against its own runtime.
- `experimental`: a compatible repository is known, but Sophon has not certified the graph, tokenizer, provider support, and generation behavior together.

Only verified entries should be treated as supported. Experimental entries are available for compatibility work and may fail on a particular browser or device.

## Unified model adapter

Bundled and remote models use the Transformers.js text-generation pipeline. The pipeline owns architecture-specific ONNX sessions, KV-cache tensors, sampling, browser caching, and provider integration. A `TextStreamer` timestamps generated token IDs before the completed result returns, while request-scoped stopping criteria cancel generation without destroying the loaded pipeline.

The bundled Tiny GPT-2 graph exposes explicit past-key/value inputs and present-key/value outputs. It supports a 1,024-position context and runs through the same adapter as remote models. Sophon reserves output-token capacity, removes the oldest complete conversation turns when necessary, and left-truncates only when one remaining turn still exceeds the budget.

The tracked bundle totals 4,051,176 bytes. Its ONNX graph is 491,629 bytes, its tokenizer is 3,558,232 bytes, and the configuration files total 1,315 bytes. The public URL includes the aggregate content-hash prefix `v-196cb8befc7d`; Next.js rewrites that URL to the single tracked copy and serves it with a one-year immutable cache policy.

Instruction-model conversations remain structured until they reach the pipeline, allowing each tokenizer to apply its native chat template. GPT-2 uses a completion-style role transcript with an assistant cue.

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

## Cross-origin isolation

COOP/COEP headers are intentionally deferred. The experimental model path can follow Hugging Face redirects to multiple signed artifact and CDN origins, and the repository does not yet run a conformance check proving that every response in that chain satisfies COEP. Enabling cross-origin isolation before that check could block otherwise valid remote model downloads. Add the headers only alongside an end-to-end delivery test for every supported remote source.

## Token display

Generation results include exact tokenizer IDs and individually decoded text for the latest user turn and generated output. Messages render as clean text by default; the opt-in token and word modes expose boundaries, token indexes, vocabulary IDs, and active-context state on hover, click, or keyboard focus. Input tokens removed by context truncation remain visible but are marked as windowed out.

## Next technical milestones

1. Record remote artifact sizes/checksums and define a review process for updating pinned revisions.
2. Add model conformance fixtures that validate tokenizer, graph inputs/outputs, EOS behavior, chat templates, and provider compatibility.
3. Add a cross-origin delivery test before enabling threaded-WASM isolation headers.
