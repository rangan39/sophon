# Sophon runtime architecture

Sophon is a browser-only local chat and compatibility tool for Cohere Labs' Tiny Aya language models in ONNX format. Its support claims are intentionally narrower than its model catalog.

## Runtime flow

```text
Model manifest
  → persistent model worker
  → resumable OPFS delivery / verified File objects
  → Transformers.js pipeline
  → ONNX Runtime provider
  → token telemetry / generation result
```

The browser owns one long-lived worker. Requests are queued inside that worker so model loading and inference cannot race. Loaded sessions remain available across prompts until the user changes models, explicitly unloads a model, or closes the page. Generation cancellation is request-scoped so stopping a response preserves the loaded model cache. A shared discriminated protocol validates requests, events, and completed results at the worker boundary. Operations have recovery timeouts; a timed-out or malformed worker is terminated so the UI cannot remain pending forever.

## Repository boundary

Sophon has no inference server or server fallback. Next.js delivers the application shell; the Web Worker owns model delivery, tokenization, sessions, generation, and telemetry. Model artifacts are fetched from pinned Hugging Face revisions only after an explicit user selection. Prompts are never routed through a repository-owned API.

## Model support levels

- `verified`: Sophon has a known graph contract and has validated the model against its own runtime.
- `experimental`: a compatible repository is known, but Sophon has not certified the graph, tokenizer, provider support, and generation behavior together.

The current four-model catalog is experimental. Each entry may fail on a particular browser or device until its graph and tokenizer combination completes the conformance suite.

## Unified model adapter

The Tiny Aya models use the Transformers.js text-generation pipeline. The pipeline owns architecture-specific ONNX sessions, KV-cache tensors, sampling, browser caching, and provider integration. A `TextStreamer` timestamps generated token IDs before the completed result returns, while request-scoped stopping criteria cancel generation without destroying the loaded pipeline.

Each Tiny Aya variant is a 3.35B-parameter q4f16 graph with an 8K context window and requires WebGPU. Sophon reserves output-token capacity, removes the oldest complete conversation turns when necessary, and left-truncates only when one remaining turn still exceeds the budget.

The q4f16 graph, tokenizer, and configuration files total about 2.35 GB per variant. Verified weights are retained in browser-private origin storage; selecting another variant releases the active worker but retains completed files and flushed download segments on disk.

Conversations remain structured until they reach the pipeline, allowing the Cohere tokenizer to apply its native chat template.

## Model delivery and integrity

The registry is paired with an allowlisted artifact manifest containing immutable repository revisions, exact paths, byte sizes, and SHA-256 digests. The existing model worker is also the delivery worker, which keeps main-thread work and cross-worker copies out of the hot path.

Supported browsers use one global adaptive queue for HTTP range requests. It starts with four streams, measures completed-range goodput in bounded epochs, probes upward only when throughput improves, caps concurrency at twelve, and backs off multiplicatively after transient failures. A build-time environment flag retains the fixed-four fallback.

Each 64 MiB segment is streamed into an OPFS synchronous access handle at its final byte offset and hashed as its response arrives. Fixed-size segment digests are generated from immutable revisions, checked against the existing whole-file hashes, and pinned with the runtime manifest. A segment becomes eligible for a durable checkpoint only after its exact size and digest match; transient corruption retries only that range. This removes the complete 2.33 GB verification reread from fresh downloads.

Strong ETags and `If-Range` protect resumed files from remote revision drift. Downloads resumed from older partial state use an ordered incremental hasher that reads newly contiguous segments while later requests remain active, preserving whole-file verification without delaying all hashing until the network finishes. Ready files are still rehashed once per worker session before reuse, so a stale metadata record alone cannot authorize runtime bytes.

Completed segments are checkpointed after four completions or one second, whichever comes first. A checkpoint flushes OPFS before committing its completed-segment set through a strict IndexedDB transaction. This order permits bounded redundant work after a crash but never records an unflushed segment as resumable. Graceful completion and cancellation drain the outstanding batch.

The allowlist covers the ONNX graph, both external-data files, configuration, generation settings, and tokenizer resources at immutable repository commits. Large weights use OPFS only, avoiding a duplicate CacheStorage copy. Sophon streams and hashes the smaller resources before placing them under the CacheStorage keys Transformers.js expects, then initializes the pipeline in local-files-only mode. Missing platform APIs, unavailable quota, absent range support, contract violations, and integrity failures all fail closed.

Preload and generation requests share the worker's targeted cancellation protocol. Cancelling a preload aborts probes and response readers but retains every flushed checkpoint; selection can resume it later. Cache inspection combines IndexedDB checkpoints, OPFS file sizes, and auxiliary CacheStorage entries. Where Web Locks are available, deletion takes an exclusive per-model lock; the worker also serializes the operation, disposes the live pipeline, and removes all three storage layers.

The artifact release pipeline lives outside `src`. It converts the current 1.92 GiB + 256 MiB sidecars into five balanced, conventionally named shards, rewrites ONNX external locations, stably topologically orders the upstream node definitions, updates the Transformers.js shard count, and proves tensor identity before publication. It never runs during a Next.js or Vercel build.

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

## Frontend delivery budget

The initial layout/page entry set is capped at 80 KiB gzip. The Base UI tooltip used for immediate hover and keyboard-focus help moved the measured production entry set from 40,914 to 73,113 bytes gzip; the cap leaves about 12% headroom. This gate measures the existing Next.js entry-manifest boundary, not every deferred chunk requested by the route.

## Token display

Generation results include exact tokenizer IDs and individually decoded text for the latest user turn and generated output. Messages render as clean text by default; the opt-in token and word modes expose boundaries, token indexes, vocabulary IDs, and active-context state on hover, click, or keyboard focus. Input tokens removed by context truncation remain visible but are marked as windowed out.

## Next technical milestones

1. Publish and benchmark the verified five-shard derivatives, then pin their immutable revisions.
2. Add explicit per-model cache inspection and deletion controls before automatic eviction is considered.
3. Add model conformance fixtures that validate tokenizer, graph inputs/outputs, EOS behavior, chat templates, and provider compatibility.
4. Add a cross-origin delivery test before enabling threaded-WASM isolation headers.
