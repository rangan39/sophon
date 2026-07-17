from __future__ import annotations

from functools import lru_cache
from threading import Lock

import torch
from transformer_lens import HookedTransformer

from sophon_interp.schemas import AttentionEdge, Feature, LayerState, Prediction, PromptRun, RunRequest, Token, TokenKind

ALLOWED_MODELS = {"gpt2-small"}
MODEL_RUN_LOCK = Lock()


def get_torch_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class PromptTooLongError(ValueError):
    def __init__(self, token_count: int, max_tokens: int):
        super().__init__("Prompt exceeds the token cap.")
        self.token_count = token_count
        self.max_tokens = max_tokens


@lru_cache(maxsize=1)
def get_model(model_name: str) -> HookedTransformer:
    if model_name not in ALLOWED_MODELS:
        raise ValueError(f"Unsupported model: {model_name}")

    device = get_torch_device()
    model = HookedTransformer.from_pretrained(model_name, device=device)
    model.eval()
    return model


def normalize(values: torch.Tensor) -> list[float]:
    values = values.detach().float().cpu()
    min_value = values.min()
    max_value = values.max()
    span = max_value - min_value
    if span.abs().item() < 1e-8:
        return [0.0 for _ in values.reshape(-1)]
    scaled = (values - min_value) / span
    return [round(float(item), 6) for item in scaled.reshape(-1)]


def positive_normalize(values: torch.Tensor) -> list[float]:
    values = values.detach().float().cpu().clamp_min(0)
    max_value = values.max()
    if max_value.item() < 1e-8:
        return [0.0 for _ in values.reshape(-1)]
    scaled = values / max_value
    return [round(float(item), 6) for item in scaled.reshape(-1)]


def special_token_kind(model: HookedTransformer, token_id: int, role: str = "token") -> TokenKind:
    tokenizer = model.tokenizer
    if tokenizer is None:
        return "normal"
    if role == "prompt_bos" and token_id == tokenizer.bos_token_id:
        return "bos"
    if token_id == tokenizer.eos_token_id:
        return "eos"
    if token_id == tokenizer.bos_token_id:
        return "bos"
    if token_id in set(tokenizer.all_special_ids):
        return "special"
    return "normal"


def token_display_text(kind: TokenKind, text: str) -> str | None:
    if kind == "bos":
        return "BOS"
    if kind == "eos":
        return "End"
    if kind == "special":
        return text.strip("<|>") or "Special"
    return None


def build_token(model: HookedTransformer, index: int, token_id: int, text: str) -> Token:
    kind = special_token_kind(model, token_id, role="prompt_bos" if index == 0 else "token")
    return Token(
        index=index,
        id=token_id,
        text=text,
        displayText=token_display_text(kind, text),
        kind=kind,
    )


def top_predictions(model: HookedTransformer, logits: torch.Tensor, top_k: int) -> list[Prediction]:
    probs = logits[0, -1].softmax(dim=-1)
    values, indices = probs.topk(min(probs.shape[-1], max(top_k * 5, top_k)))
    normal_predictions: list[Prediction] = []
    special_predictions: list[Prediction] = []

    for prob, token_id_tensor in zip(values.detach().cpu(), indices.detach().cpu(), strict=True):
        token_id = int(token_id_tensor)
        text = model.to_string(token_id)
        kind = special_token_kind(model, token_id, role="prediction")
        prediction = Prediction(
            token=text,
            displayToken=token_display_text(kind, text),
            kind="normal" if kind == "normal" else "special",
            probability=round(float(prob), 6),
        )
        if kind == "normal":
            normal_predictions.append(prediction)
        else:
            special_predictions.append(prediction)
        if len(normal_predictions) >= top_k:
            break

    if normal_predictions:
        return normal_predictions[:top_k]
    return special_predictions[:1]


def attention_edges(pattern: torch.Tensor, layer: int, top_k: int) -> list[AttentionEdge]:
    # pattern shape: [batch, head, destination token, source token]
    layer_pattern = pattern[0].detach().float().cpu()
    head_count, dest_count, source_count = layer_pattern.shape
    edges: list[AttentionEdge] = []

    for head in range(head_count):
        weights = layer_pattern[head].clone()
        weights.fill_diagonal_(0)
        flat_values, flat_indices = weights.reshape(-1).topk(min(top_k, dest_count * source_count))
        for weight, flat_index in zip(flat_values, flat_indices, strict=True):
            if weight <= 0:
                continue
            destination = int(flat_index // source_count)
            source = int(flat_index % source_count)
            edges.append(
                AttentionEdge(
                    from_=destination,
                    to=source,
                    query=destination,
                    key=source,
                    head=head,
                    weight=round(float(weight), 6),
                )
            )

    edges.sort(key=lambda edge: edge.weight, reverse=True)
    return edges[:top_k]


def logit_lens_confidence(model: HookedTransformer, residual: torch.Tensor) -> list[float]:
    with torch.no_grad():
        normalized = model.ln_final(residual.unsqueeze(0))[0]
        logits = model.unembed(normalized)
        confidence = logits.softmax(dim=-1).max(dim=-1).values
    return positive_normalize(confidence)


def direct_logit_attribution(model: HookedTransformer, residual: torch.Tensor, target_token_id: int) -> list[float]:
    direction = model.W_U[:, target_token_id]
    attribution = residual @ direction
    return normalize(attribution)


def extract_prompt_run(request: RunRequest) -> PromptRun:
    with MODEL_RUN_LOCK:
        return _extract_prompt_run(request)


def _extract_prompt_run(request: RunRequest) -> PromptRun:
    model = get_model(request.model)

    with torch.no_grad():
        tokens_tensor = model.to_tokens(request.prompt, prepend_bos=True)
        token_ids = tokens_tensor[0].detach().cpu().tolist()
        if len(token_ids) > request.maxTokens:
            raise PromptTooLongError(len(token_ids), request.maxTokens)

        string_tokens = model.to_str_tokens(tokens_tensor[0])
        logits, cache = model.run_with_cache(tokens_tensor)
        predictions = top_predictions(model, logits, request.topKPredictions)
        target_token_id = int(logits[0, -1].argmax(dim=-1).item())

        tokens = [
            build_token(model, index, int(token_id), text)
            for index, (token_id, text) in enumerate(zip(token_ids, string_tokens, strict=True))
        ]

        layers: list[LayerState] = []
        for layer_index in range(model.cfg.n_layers):
            residual = cache["resid_post", layer_index][0]
            residual_norm = positive_normalize(residual.norm(dim=-1))
            logit_confidence = logit_lens_confidence(model, residual)
            attribution = direct_logit_attribution(model, residual, target_token_id)
            pattern = cache["pattern", layer_index]

            layers.append(
                LayerState(
                    layer=layer_index,
                    residualNorm=residual_norm,
                    attribution=attribution,
                    logitConfidence=logit_confidence,
                    attention=attention_edges(pattern, layer_index, request.topKAttentionEdges),
                    topFeature=[
                        Feature(id=f"sae-unavailable-{layer_index}-{token.index}", activation=0, label="SAE unavailable")
                        for token in tokens
                    ],
                )
            )

    return PromptRun(
        id="live",
        title="Live Prompt",
        prompt=request.prompt,
        model=f"{request.model} / TransformerLens",
        source="transformer-lens",
        featuresAvailable=False,
        expectedNextToken=predictions[0].token if predictions else None,
        tokens=tokens,
        layers=layers,
        finalPredictions=predictions,
    )
