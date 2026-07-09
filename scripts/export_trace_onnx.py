#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


class TraceCausalLM(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> tuple[torch.Tensor, ...]:
        outputs = self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            output_hidden_states=True,
            use_cache=False,
            return_dict=True,
        )
        return (outputs.logits, *outputs.hidden_states)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export a CausalLM ONNX trace model for Sophon.")
    parser.add_argument("--model", default="sshleifer/tiny-gpt2", help="Hugging Face model id to export.")
    parser.add_argument("--output", default="artifacts/models/sshleifer-tiny-gpt2-trace", help="Output directory.")
    parser.add_argument("--sequence-length", type=int, default=64, help="Fixed token sequence length for the ONNX graph.")
    parser.add_argument("--opset", type=int, default=18, help="ONNX opset version.")
    parser.add_argument("--validate", action="store_true", help="Validate ONNX outputs against PyTorch with ONNX Runtime.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output)
    onnx_dir = output_dir / "onnx"
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_dir.mkdir(parents=True, exist_ok=True)

    torch.set_grad_enabled(False)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model)
    model.eval()

    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
        model.config.pad_token_id = tokenizer.pad_token_id

    wrapped = TraceCausalLM(model).eval()
    encoded = tokenizer(
        "hello world",
        max_length=args.sequence_length,
        padding="max_length",
        truncation=True,
        return_tensors="pt",
    )
    input_ids = encoded["input_ids"].to(torch.long)
    attention_mask = encoded["attention_mask"].to(torch.long)

    with torch.no_grad():
        torch_outputs = wrapped(input_ids, attention_mask)

    hidden_state_count = len(torch_outputs) - 1
    output_names = ["logits", *[f"hidden_state_{index}" for index in range(hidden_state_count)]]
    onnx_path = onnx_dir / "model.onnx"

    torch.onnx.export(
        wrapped,
        (input_ids, attention_mask),
        onnx_path.as_posix(),
        input_names=["input_ids", "attention_mask"],
        output_names=output_names,
        opset_version=args.opset,
        external_data=False,
        do_constant_folding=True,
    )

    tokenizer.save_pretrained(output_dir)
    model.config.output_hidden_states = True
    model.config.output_attentions = False
    model.config.use_cache = False
    model.config.save_pretrained(output_dir)

    metadata = {
        "base_model": args.model,
        "format": "onnx",
        "task": "sophon-trace-causal-lm",
        "sequence_length": args.sequence_length,
        "opset": args.opset,
        "inputs": {
            "input_ids": list(input_ids.shape),
            "attention_mask": list(attention_mask.shape),
        },
        "outputs": {
            "logits": list(torch_outputs[0].shape),
            "hidden_states": [list(output.shape) for output in torch_outputs[1:]],
        },
        "output_names": output_names,
    }

    if args.validate:
        metadata["validation"] = validate_onnx(onnx_path, input_ids, attention_mask, torch_outputs, output_names)

    (output_dir / "sophon-trace.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"output": output_dir.as_posix(), "onnx": onnx_path.as_posix(), **metadata}, indent=2))


def validate_onnx(
    onnx_path: Path,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    torch_outputs: tuple[torch.Tensor, ...],
    output_names: list[str],
) -> dict[str, object]:
    import onnx
    import onnxruntime as ort

    onnx_model = onnx.load(onnx_path.as_posix())
    onnx.checker.check_model(onnx_model)

    session = ort.InferenceSession(onnx_path.as_posix(), providers=["CPUExecutionProvider"])
    ort_outputs = session.run(
        output_names,
        {
            "input_ids": input_ids.numpy(),
            "attention_mask": attention_mask.numpy(),
        },
    )

    max_abs_diff = {}
    for name, torch_output, ort_output in zip(output_names, torch_outputs, ort_outputs, strict=True):
        expected = torch_output.detach().cpu().numpy()
        actual = np.asarray(ort_output)
        max_abs_diff[name] = float(np.max(np.abs(expected - actual)))

    return {
        "onnx_checked": True,
        "provider": "CPUExecutionProvider",
        "max_abs_diff": max_abs_diff,
    }


if __name__ == "__main__":
    main()
