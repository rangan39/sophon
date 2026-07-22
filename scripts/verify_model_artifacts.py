#!/usr/bin/env python3
"""Verify a generated Sophon model artifact and its deterministic manifest."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from reshard_onnx import (
    ArtifactError,
    INCOMPLETE_MARKER,
    MANIFEST_FILENAME,
    OUTPUT_MANIFEST_SCHEMA_VERSION,
    PIPELINE_VERSION,
    SHA256_RE,
    default_seed_path,
    find_seed_model,
    load_json,
    load_seed,
    local_path,
    output_runtime_paths,
    tensor_set_sha256,
    validate_file_records,
    verify_output_layout,
    verify_recorded_files,
    verify_tensor_identity,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", required=True, type=Path, help="Generated artifact directory.")
    parser.add_argument("--seed", type=Path, default=default_seed_path(), help="Artifact seed manifest.")
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Optional source snapshot; when supplied, verify source hashes and tensor identity.",
    )
    return parser.parse_args(argv)


def verify_manifest_contract(
    manifest: Any,
    model_seed: dict[str, Any],
    pipeline: dict[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != OUTPUT_MANIFEST_SCHEMA_VERSION:
        raise ArtifactError("Unsupported output manifest schema.")
    if manifest.get("pipelineVersion") != PIPELINE_VERSION:
        raise ArtifactError("Output manifest pipeline version does not match this verifier.")
    if manifest.get("modelId") != model_seed["id"] or manifest.get("source") != model_seed["source"]:
        raise ArtifactError("Output provenance does not match the checked-in source seed.")
    artifact = manifest.get("artifact")
    if not isinstance(artifact, dict):
        raise ArtifactError("Output manifest is missing artifact metadata.")
    expected_artifact = {
        "externalTensorCount": pipeline["externalTensorCount"],
        "graphPath": pipeline["graphPath"],
        "initializerCount": pipeline["initializerCount"],
        "maxShardSizeBytes": pipeline["maxShardSizeBytes"],
        "normalizedShardPaths": pipeline["normalizedShardPaths"],
        "quantization": pipeline["quantization"],
        "shardCount": pipeline["shardCount"],
        "topologicallySortGraph": pipeline["topologicallySortGraph"],
    }
    for key, expected in expected_artifact.items():
        if artifact.get(key) != expected:
            raise ArtifactError(f"Output artifact metadata mismatch for {key}.")
    tensor_digest = artifact.get("tensorSetSha256")
    if not isinstance(tensor_digest, str) or not SHA256_RE.fullmatch(tensor_digest):
        raise ArtifactError("Output manifest is missing tensorSetSha256.")
    output = manifest.get("output")
    if not isinstance(output, dict):
        raise ArtifactError("Output manifest is missing output metadata.")
    records = validate_file_records(output.get("files"), "output.files")
    if [record["path"] for record in records] != output_runtime_paths(pipeline):
        raise ArtifactError("Output manifest file list does not match the runtime artifact contract.")
    if output.get("totalSizeBytes") != sum(record["sizeBytes"] for record in records):
        raise ArtifactError("Output totalSizeBytes does not equal the file-record sum.")
    tools = manifest.get("tools")
    if not isinstance(tools, dict) or tools.get("onnxIrCommit") != pipeline["onnxIrCommit"]:
        raise ArtifactError("Output manifest does not record the pinned onnx-ir commit.")
    versions = tools.get("versions")
    if not isinstance(versions, dict) or set(versions) != {"onnx", "onnx-ir", "python"}:
        raise ArtifactError("Output manifest does not record tool versions.")
    if not all(isinstance(version, str) and version for version in versions.values()):
        raise ArtifactError("Output manifest contains an invalid tool version.")
    return records


def verify_artifact(artifact_dir: Path, seed_path: Path, source_dir: Path | None) -> None:
    artifact_root = artifact_dir.resolve(strict=True)
    if not artifact_root.is_dir():
        raise ArtifactError(f"Artifact path is not a directory: {artifact_root}")
    if (artifact_root / INCOMPLETE_MARKER).exists():
        raise ArtifactError("Artifact directory is marked incomplete.")
    manifest_path = artifact_root / MANIFEST_FILENAME
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("modelId"), str):
        raise ArtifactError("Output manifest is missing modelId.")

    seed = load_seed(seed_path)
    pipeline = seed["pipeline"]
    model_seed = find_seed_model(seed, manifest["modelId"])
    records = verify_manifest_contract(manifest, model_seed, pipeline)
    verify_recorded_files(artifact_root, records, "output")
    verify_output_layout(artifact_root, pipeline)

    output_graph = local_path(artifact_root, pipeline["graphPath"])
    output_tensor_digest = tensor_set_sha256(output_graph)
    if output_tensor_digest != manifest["artifact"]["tensorSetSha256"]:
        raise ArtifactError("Output tensor-set digest does not match the manifest.")

    if source_dir is not None:
        source_root = source_dir.resolve(strict=True)
        verify_recorded_files(source_root, model_seed["source"]["files"], "source")
        source_graph = local_path(source_root, pipeline["graphPath"])
        identity_digest = verify_tensor_identity(source_graph, output_graph)
        if identity_digest != output_tensor_digest:
            raise ArtifactError("Source/output tensor identity digest does not match the output manifest.")


def main(argv: list[str] | None = None) -> int:
    arguments = parse_args(argv)
    try:
        verify_artifact(arguments.artifact_dir, arguments.seed, arguments.source_dir)
    except (ArtifactError, OSError) as error:
        print(f"artifact verification failed: {error}", file=sys.stderr)
        return 2
    print(arguments.artifact_dir.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
