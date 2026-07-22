#!/usr/bin/env python3
"""Repack one pinned Tiny Aya q4f16 model into browser-sized ONNX shards.

This script deliberately has no batch mode: process, verify, and publish one
model at a time so the multi-gigabyte source and output sets do not accumulate.
The source directory must already contain the files recorded in the checked-in
seed manifest. The output directory must not exist.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator


SEED_SCHEMA_VERSION = 1
OUTPUT_MANIFEST_SCHEMA_VERSION = 1
PIPELINE_VERSION = 1
MANIFEST_FILENAME = "model-artifact.manifest.json"
INCOMPLETE_MARKER = ".model-artifact-build-incomplete"
HASH_CHUNK_BYTES = 8 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REVISION_RE = re.compile(r"^[0-9a-f]{40}$")
GENERATED_SHARD_RE = re.compile(
    r"^model_q4f16-(?P<index>[0-9]{5})-of-(?P<total>[0-9]{5})\.onnx_data$"
)


class ArtifactError(RuntimeError):
    """A deterministic artifact or safety check failed."""


def repository_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_seed_path() -> Path:
    return repository_root() / "models" / "model-artifacts.seed.json"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", required=True, help="Model id from the seed manifest.")
    parser.add_argument("--input-dir", required=True, type=Path, help="Verified source snapshot directory.")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Fresh output directory. It must not already exist.",
    )
    parser.add_argument("--seed", type=Path, default=default_seed_path(), help="Artifact seed manifest.")
    return parser.parse_args(argv)


def load_seed(seed_path: Path) -> dict[str, Any]:
    seed = load_json(seed_path)
    if not isinstance(seed, dict) or seed.get("schemaVersion") != SEED_SCHEMA_VERSION:
        raise ArtifactError(f"Unsupported seed schema in {seed_path}.")
    pipeline = require_mapping(seed, "pipeline")
    if pipeline.get("quantization") != "q4f16":
        raise ArtifactError("The artifact seed must describe q4f16 output.")
    if pipeline.get("maxShardSizeBytes") != 448 * 1024**2:
        raise ArtifactError("The checked-in shard cap must remain exactly 448 MiB.")
    if pipeline.get("sourceShardCount") != 2 or pipeline.get("shardCount") != 5:
        raise ArtifactError("The pipeline must normalize two source shards into five output shards.")
    if pipeline.get("topologicallySortGraph") is not True:
        raise ArtifactError("The pipeline must pin stable topological graph sorting.")
    normalized = pipeline.get("normalizedShardPaths")
    expected_normalized = normalized_shard_paths(5)
    if normalized != expected_normalized:
        raise ArtifactError("normalizedShardPaths does not match the Transformers.js naming contract.")
    for key in ("graphPath", "configPath"):
        require_safe_relative_path(pipeline.get(key), f"pipeline.{key}")
    metadata_paths = pipeline.get("metadataPaths")
    if not isinstance(metadata_paths, list) or not metadata_paths:
        raise ArtifactError("pipeline.metadataPaths must be a non-empty list.")
    for index, relative in enumerate(metadata_paths):
        require_safe_relative_path(relative, f"pipeline.metadataPaths[{index}]")

    models = seed.get("models")
    if not isinstance(models, list) or not models:
        raise ArtifactError("The seed must contain at least one model.")
    seen_ids: set[str] = set()
    for model in models:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str):
            raise ArtifactError("Every seed model must have a string id.")
        model_id = model["id"]
        if model_id in seen_ids:
            raise ArtifactError(f"Duplicate model id in seed: {model_id}")
        seen_ids.add(model_id)
        source = require_mapping(model, "source")
        if not isinstance(source.get("repo"), str) or not source["repo"]:
            raise ArtifactError(f"{model_id} has no source repo.")
        if not isinstance(source.get("revision"), str) or not REVISION_RE.fullmatch(source["revision"]):
            raise ArtifactError(f"{model_id} must use an immutable 40-character source revision.")
        validate_file_records(source.get("files"), f"{model_id}.source.files")
    return seed


def find_seed_model(seed: dict[str, Any], model_id: str) -> dict[str, Any]:
    for model in seed["models"]:
        if model["id"] == model_id:
            return model
    choices = ", ".join(model["id"] for model in seed["models"])
    raise ArtifactError(f"Unknown model id {model_id!r}; expected one of: {choices}")


def normalized_shard_paths(count: int) -> list[str]:
    return [
        "onnx/model_q4f16.onnx_data" + ("" if index == 0 else f"_{index}")
        for index in range(count)
    ]


def validate_file_records(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ArtifactError(f"{label} must be a non-empty list.")
    seen: set[str] = set()
    prior = ""
    for index, record in enumerate(value):
        if not isinstance(record, dict):
            raise ArtifactError(f"{label}[{index}] must be an object.")
        relative = require_safe_relative_path(record.get("path"), f"{label}[{index}].path")
        if relative in seen:
            raise ArtifactError(f"Duplicate path in {label}: {relative}")
        if prior and relative < prior:
            raise ArtifactError(f"{label} must be sorted by path for deterministic manifests.")
        seen.add(relative)
        prior = relative
        size = record.get("sizeBytes")
        digest = record.get("sha256")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ArtifactError(f"{label}[{index}].sizeBytes must be a non-negative integer.")
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise ArtifactError(f"{label}[{index}].sha256 must be a lowercase SHA-256 digest.")
    return value


def require_mapping(value: dict[str, Any], key: str) -> dict[str, Any]:
    child = value.get(key)
    if not isinstance(child, dict):
        raise ArtifactError(f"{key} must be an object.")
    return child


def require_safe_relative_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ArtifactError(f"{label} must be a non-empty POSIX relative path.")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        raise ArtifactError(f"Unsafe relative path in {label}: {value!r}")
    normalized = relative.as_posix()
    if normalized != value:
        raise ArtifactError(f"Non-canonical relative path in {label}: {value!r}")
    return normalized


def local_path(root: Path, relative: str) -> Path:
    safe_relative = require_safe_relative_path(relative, "artifact path")
    root = root.resolve()
    candidate = (root / Path(*PurePosixPath(safe_relative).parts)).resolve()
    if not candidate.is_relative_to(root):
        raise ArtifactError(f"Artifact path escapes its root: {relative}")
    return candidate


def load_json(file_path: Path) -> Any:
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactError(f"Could not read JSON from {file_path}: {error}") from error


def atomic_write_json(file_path: Path, value: Any) -> None:
    temporary = file_path.with_name(f".{file_path.name}.tmp")
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary.write_text(payload, encoding="utf-8")
    os.replace(temporary, file_path)


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        while chunk := stream.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_region(file_path: Path, offset: int, length: int) -> str:
    digest = hashlib.sha256()
    remaining = length
    with file_path.open("rb") as stream:
        stream.seek(offset)
        while remaining:
            chunk = stream.read(min(HASH_CHUNK_BYTES, remaining))
            if not chunk:
                raise ArtifactError(
                    f"Unexpected end of file in {file_path} at byte {offset + length - remaining}."
                )
            digest.update(chunk)
            remaining -= len(chunk)
    return digest.hexdigest()


def verify_recorded_files(root: Path, records: Any, label: str) -> list[dict[str, Any]]:
    checked = validate_file_records(records, label)
    for record in checked:
        file_path = local_path(root, record["path"])
        if not file_path.is_file():
            raise ArtifactError(f"Missing {label} file: {record['path']}")
        actual_size = file_path.stat().st_size
        if actual_size != record["sizeBytes"]:
            raise ArtifactError(
                f"Size mismatch for {record['path']}: expected {record['sizeBytes']}, got {actual_size}."
            )
        actual_digest = sha256_file(file_path)
        if actual_digest != record["sha256"]:
            raise ArtifactError(
                f"SHA-256 mismatch for {record['path']}: expected {record['sha256']}, got {actual_digest}."
            )
    return checked


def prepare_directories(input_dir: Path, output_dir: Path) -> tuple[Path, Path]:
    try:
        source_root = input_dir.resolve(strict=True)
    except OSError as error:
        raise ArtifactError(f"Input directory does not exist: {input_dir}") from error
    if not source_root.is_dir():
        raise ArtifactError(f"Input path is not a directory: {source_root}")
    destination_root = output_dir.resolve(strict=False)
    if destination_root.exists():
        raise ArtifactError(f"Output directory must not already exist: {destination_root}")
    if (
        destination_root == source_root
        or source_root in destination_root.parents
        or destination_root in source_root.parents
    ):
        raise ArtifactError("Input and output directories must not contain one another.")
    destination_root.mkdir(parents=True, exist_ok=False)
    (destination_root / INCOMPLETE_MARKER).write_text(
        "This directory contains an incomplete or unverified model artifact build.\n",
        encoding="utf-8",
    )
    return source_root, destination_root


def copy_metadata(input_dir: Path, output_dir: Path, metadata_paths: Iterable[str]) -> None:
    for relative in metadata_paths:
        source = local_path(input_dir, relative)
        destination = local_path(output_dir, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def reshard_graph(input_graph: Path, output_graph: Path, pipeline: dict[str, Any]) -> None:
    try:
        import onnx_ir as ir
    except ImportError as error:
        raise ArtifactError(
            "onnx-ir is required; install scripts/model-build-requirements.txt in an isolated environment."
        ) from error
    output_graph.parent.mkdir(parents=True, exist_ok=True)
    model = ir.load(input_graph)
    try:
        # The upstream Tiny Aya graphs group nodes by optimization pass rather
        # than dependency order. ONNX Runtime accepts that layout, but the ONNX
        # checker correctly requires producers to precede their consumers.
        # Stable topological sorting changes no node or tensor payload.
        model.graph.sort()
    except ValueError as error:
        raise ArtifactError(f"Could not topologically sort the source graph: {error}") from error
    ir.save(
        model,
        output_graph,
        external_data="model_q4f16.onnx_data",
        size_threshold_bytes=256,
        max_shard_size_bytes=pipeline["maxShardSizeBytes"],
    )


def normalize_generated_shards(output_graph: Path, pipeline: dict[str, Any]) -> dict[str, str]:
    output_onnx_dir = output_graph.parent
    shard_count = pipeline["shardCount"]
    generated: list[tuple[int, Path]] = []
    for candidate in output_onnx_dir.glob("model_q4f16-*-of-*.onnx_data"):
        match = GENERATED_SHARD_RE.fullmatch(candidate.name)
        if not match:
            continue
        index = int(match.group("index"))
        total = int(match.group("total"))
        if total != shard_count:
            raise ArtifactError(f"onnx-ir emitted an unexpected shard total in {candidate.name}.")
        generated.append((index, candidate))
    generated.sort(key=lambda item: item[0])
    if [index for index, _ in generated] != list(range(1, shard_count + 1)):
        names = ", ".join(candidate.name for _, candidate in generated) or "none"
        raise ArtifactError(f"Expected {shard_count} sequential onnx-ir shards; found: {names}")

    normalized_names = [PurePosixPath(value).name for value in pipeline["normalizedShardPaths"]]
    location_mapping: dict[str, str] = {}
    for (_, generated_path), normalized_name in zip(generated, normalized_names, strict=True):
        destination = output_onnx_dir / normalized_name
        if destination.exists():
            raise ArtifactError(f"Refusing to overwrite normalized shard: {destination}")
        location_mapping[generated_path.name] = normalized_name
        generated_path.rename(destination)
    rewrite_external_locations(output_graph, location_mapping, pipeline["externalTensorCount"])
    return location_mapping


def import_onnx() -> Any:
    try:
        import onnx
    except ImportError as error:
        raise ArtifactError(
            "onnx is required; install scripts/model-build-requirements.txt in an isolated environment."
        ) from error
    return onnx


def iter_model_tensors(model: Any, onnx: Any) -> Iterator[tuple[str, Any]]:
    yield from iter_graph_tensors(model.graph, "graph", onnx)


def iter_graph_tensors(graph: Any, scope: str, onnx: Any) -> Iterator[tuple[str, Any]]:
    for index, tensor in enumerate(graph.initializer):
        name = tensor.name or f"#{index}"
        yield f"{scope}/initializer/{name}", tensor
    for index, sparse in enumerate(graph.sparse_initializer):
        yield f"{scope}/sparse_initializer/{index}/values", sparse.values
        yield f"{scope}/sparse_initializer/{index}/indices", sparse.indices
    for node_index, node in enumerate(graph.node):
        node_scope = f"{scope}/node/{node_index}:{node.name or node.op_type}"
        for attribute_index, attribute in enumerate(node.attribute):
            attribute_scope = f"{node_scope}/attribute/{attribute_index}:{attribute.name}"
            if attribute.type == onnx.AttributeProto.TENSOR:
                yield f"{attribute_scope}/tensor", attribute.t
            elif attribute.type == onnx.AttributeProto.TENSORS:
                for tensor_index, tensor in enumerate(attribute.tensors):
                    yield f"{attribute_scope}/tensor/{tensor_index}", tensor
            elif attribute.type == onnx.AttributeProto.SPARSE_TENSOR:
                yield f"{attribute_scope}/sparse/values", attribute.sparse_tensor.values
                yield f"{attribute_scope}/sparse/indices", attribute.sparse_tensor.indices
            elif attribute.type == onnx.AttributeProto.SPARSE_TENSORS:
                for tensor_index, sparse in enumerate(attribute.sparse_tensors):
                    yield f"{attribute_scope}/sparse/{tensor_index}/values", sparse.values
                    yield f"{attribute_scope}/sparse/{tensor_index}/indices", sparse.indices
            elif attribute.type == onnx.AttributeProto.GRAPH:
                yield from iter_graph_tensors(attribute.g, f"{attribute_scope}/graph", onnx)
            elif attribute.type == onnx.AttributeProto.GRAPHS:
                for graph_index, child in enumerate(attribute.graphs):
                    yield from iter_graph_tensors(child, f"{attribute_scope}/graph/{graph_index}", onnx)


def external_metadata(tensor: Any) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for entry in tensor.external_data:
        if entry.key in metadata:
            raise ArtifactError(f"Tensor {tensor.name!r} has duplicate external-data key {entry.key!r}.")
        metadata[entry.key] = entry.value
    return metadata


def is_external_tensor(tensor: Any, onnx: Any) -> bool:
    return tensor.data_location == onnx.TensorProto.EXTERNAL or bool(tensor.external_data)


def rewrite_external_locations(
    graph_path: Path,
    location_mapping: dict[str, str],
    expected_external_tensors: int,
) -> None:
    onnx = import_onnx()
    model = onnx.load(graph_path, load_external_data=False)
    rewritten = 0
    for _, tensor in iter_model_tensors(model, onnx):
        if not is_external_tensor(tensor, onnx):
            continue
        location_entries = [entry for entry in tensor.external_data if entry.key == "location"]
        if len(location_entries) != 1:
            raise ArtifactError(f"External tensor {tensor.name!r} must have exactly one location.")
        old_location = location_entries[0].value
        try:
            location_entries[0].value = location_mapping[old_location]
        except KeyError as error:
            raise ArtifactError(f"Unexpected onnx-ir external-data location: {old_location}") from error
        rewritten += 1
    if rewritten != expected_external_tensors:
        raise ArtifactError(
            f"Expected to rewrite {expected_external_tensors} external tensors, rewrote {rewritten}."
        )
    temporary = graph_path.with_name(f".{graph_path.name}.tmp")
    temporary.write_bytes(model.SerializeToString())
    os.replace(temporary, graph_path)


def update_transformers_config(config_path: Path, pipeline: dict[str, Any]) -> None:
    config = load_json(config_path)
    if not isinstance(config, dict):
        raise ArtifactError("config.json must contain an object.")
    transformers_config = config.get("transformers.js_config")
    if not isinstance(transformers_config, dict):
        raise ArtifactError("config.json is missing transformers.js_config.")
    external_format = transformers_config.get("use_external_data_format")
    if not isinstance(external_format, dict):
        raise ArtifactError("config.json is missing the external-data mapping.")
    current_count = external_format.get("model_q4f16.onnx")
    if current_count != pipeline["sourceShardCount"]:
        raise ArtifactError(
            f"Expected source q4f16 shard count {pipeline['sourceShardCount']}, got {current_count!r}."
        )
    external_format["model_q4f16.onnx"] = pipeline["shardCount"]
    atomic_write_json(config_path, config)


def verify_output_layout(output_dir: Path, pipeline: dict[str, Any]) -> dict[str, Any]:
    onnx = import_onnx()
    graph_path = local_path(output_dir, pipeline["graphPath"])
    expected_shard_paths = pipeline["normalizedShardPaths"]
    expected_shard_names = {PurePosixPath(value).name for value in expected_shard_paths}
    expected_onnx_names = expected_shard_names | {graph_path.name}
    actual_onnx_names = {candidate.name for candidate in graph_path.parent.iterdir() if candidate.is_file()}
    if actual_onnx_names != expected_onnx_names:
        raise ArtifactError(
            "Unexpected ONNX output files: "
            f"expected {sorted(expected_onnx_names)}, got {sorted(actual_onnx_names)}."
        )

    shard_sizes: dict[str, int] = {}
    for relative in expected_shard_paths:
        shard_path = local_path(output_dir, relative)
        if not shard_path.is_file():
            raise ArtifactError(f"Missing normalized shard: {relative}")
        size = shard_path.stat().st_size
        if size > pipeline["maxShardSizeBytes"]:
            raise ArtifactError(f"Shard exceeds 448 MiB cap: {relative} ({size} bytes)")
        shard_sizes[PurePosixPath(relative).name] = size

    model = onnx.load(graph_path, load_external_data=False)
    if len(model.graph.initializer) != pipeline["initializerCount"]:
        raise ArtifactError(
            f"Expected {pipeline['initializerCount']} initializers, got {len(model.graph.initializer)}."
        )
    ranges: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    external_count = 0
    for tensor_key, tensor in iter_model_tensors(model, onnx):
        if not is_external_tensor(tensor, onnx):
            continue
        metadata = external_metadata(tensor)
        location = metadata.get("location")
        if location not in expected_shard_names:
            raise ArtifactError(f"{tensor_key} references unexpected external path {location!r}.")
        try:
            offset = int(metadata["offset"])
            length = int(metadata["length"])
        except (KeyError, ValueError) as error:
            raise ArtifactError(f"{tensor_key} has invalid external offset/length metadata.") from error
        if offset < 0 or length <= 0:
            raise ArtifactError(f"{tensor_key} has non-positive external byte bounds.")
        shard_size = shard_sizes[location]
        if offset + length > shard_size:
            raise ArtifactError(
                f"{tensor_key} ends at {offset + length}, beyond {location} size {shard_size}."
            )
        ranges[location].append((offset, offset + length, tensor_key))
        external_count += 1
    if external_count != pipeline["externalTensorCount"]:
        raise ArtifactError(
            f"Expected {pipeline['externalTensorCount']} external tensors, got {external_count}."
        )
    if set(ranges) != expected_shard_names:
        raise ArtifactError("Every normalized shard must be referenced by at least one tensor.")
    for location, location_ranges in ranges.items():
        previous_end = 0
        for start, end, tensor_key in sorted(location_ranges):
            if start < previous_end:
                raise ArtifactError(f"Overlapping external tensor range in {location}: {tensor_key}")
            previous_end = end

    config = load_json(local_path(output_dir, pipeline["configPath"]))
    try:
        configured_count = config["transformers.js_config"]["use_external_data_format"]["model_q4f16.onnx"]
    except (KeyError, TypeError) as error:
        raise ArtifactError("Output config is missing its q4f16 external-data count.") from error
    if configured_count != pipeline["shardCount"]:
        raise ArtifactError(
            f"Output config declares {configured_count} q4f16 shards; expected {pipeline['shardCount']}."
        )
    try:
        onnx.checker.check_model(str(graph_path), full_check=False)
    except onnx.checker.ValidationError as error:
        raise ArtifactError(f"ONNX checker rejected the re-sharded graph: {error}") from error
    return {
        "externalTensorCount": external_count,
        "initializerCount": len(model.graph.initializer),
        "shards": [
            {"path": relative, "sizeBytes": local_path(output_dir, relative).stat().st_size}
            for relative in expected_shard_paths
        ],
    }


def tensor_set_sha256(graph_path: Path) -> str:
    onnx = import_onnx()
    model = onnx.load(graph_path, load_external_data=False)
    aggregate = hashlib.sha256()
    for tensor_key, tensor in sorted(iter_model_tensors(model, onnx), key=lambda item: item[0]):
        digest = tensor_payload_sha256(tensor, graph_path.parent, onnx)
        aggregate.update(tensor_key.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(str(tensor.data_type).encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(",".join(str(dimension) for dimension in tensor.dims).encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(digest.encode("ascii"))
        aggregate.update(b"\n")
    return aggregate.hexdigest()


def tensor_payload_sha256(tensor: Any, graph_dir: Path, onnx: Any) -> str:
    if not is_external_tensor(tensor, onnx):
        return hashlib.sha256(tensor.SerializeToString()).hexdigest()
    metadata = external_metadata(tensor)
    try:
        location = require_safe_relative_path(metadata["location"], "tensor external-data location")
        offset = int(metadata["offset"])
        length = int(metadata["length"])
    except (KeyError, ValueError) as error:
        raise ArtifactError(f"Tensor {tensor.name!r} has invalid external-data metadata.") from error
    if offset < 0 or length <= 0:
        raise ArtifactError(f"Tensor {tensor.name!r} has invalid external-data byte bounds.")
    return sha256_region(local_path(graph_dir, location), offset, length)


def verify_tensor_identity(source_graph: Path, output_graph: Path) -> str:
    onnx = import_onnx()
    source = onnx.load(source_graph, load_external_data=False)
    output = onnx.load(output_graph, load_external_data=False)
    if source.ir_version != output.ir_version:
        raise ArtifactError("ONNX IR version changed during re-sharding.")
    source_opsets = [(item.domain, item.version) for item in source.opset_import]
    output_opsets = [(item.domain, item.version) for item in output.opset_import]
    if source_opsets != output_opsets:
        raise ArtifactError("ONNX opset imports changed during re-sharding.")
    source_nodes = Counter(node.SerializeToString() for node in source.graph.node)
    output_nodes = Counter(node.SerializeToString() for node in output.graph.node)
    if source_nodes != output_nodes:
        raise ArtifactError("ONNX graph nodes changed beyond topological ordering during re-sharding.")

    source_tensors = dict(iter_model_tensors(source, onnx))
    output_tensors = dict(iter_model_tensors(output, onnx))
    if source_tensors.keys() != output_tensors.keys():
        raise ArtifactError("ONNX tensor set changed during re-sharding.")
    aggregate = hashlib.sha256()
    for tensor_key in sorted(source_tensors):
        source_tensor = source_tensors[tensor_key]
        output_tensor = output_tensors[tensor_key]
        if source_tensor.data_type != output_tensor.data_type or list(source_tensor.dims) != list(output_tensor.dims):
            raise ArtifactError(f"Tensor metadata changed during re-sharding: {tensor_key}")
        source_digest = tensor_payload_sha256(source_tensor, source_graph.parent, onnx)
        output_digest = tensor_payload_sha256(output_tensor, output_graph.parent, onnx)
        if source_digest != output_digest:
            raise ArtifactError(f"Tensor payload changed during re-sharding: {tensor_key}")
        aggregate.update(tensor_key.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(str(source_tensor.data_type).encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(",".join(str(dimension) for dimension in source_tensor.dims).encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(source_digest.encode("ascii"))
        aggregate.update(b"\n")
    return aggregate.hexdigest()


def file_record(root: Path, relative: str) -> dict[str, Any]:
    file_path = local_path(root, relative)
    return {
        "path": relative,
        "sha256": sha256_file(file_path),
        "sizeBytes": file_path.stat().st_size,
    }


def output_runtime_paths(pipeline: dict[str, Any]) -> list[str]:
    return sorted(
        [pipeline["graphPath"], *pipeline["metadataPaths"], *pipeline["normalizedShardPaths"]]
    )


def package_versions() -> dict[str, str]:
    result = {"python": platform.python_version()}
    for distribution in ("onnx", "onnx-ir"):
        try:
            result[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError as error:
            raise ArtifactError(f"Required build distribution is not installed: {distribution}") from error
    return dict(sorted(result.items()))


def build_manifest(
    model_seed: dict[str, Any],
    pipeline: dict[str, Any],
    output_dir: Path,
    layout: dict[str, Any],
    tensor_digest: str,
) -> dict[str, Any]:
    output_files = [file_record(output_dir, relative) for relative in output_runtime_paths(pipeline)]
    return {
        "artifact": {
            "externalTensorCount": layout["externalTensorCount"],
            "graphPath": pipeline["graphPath"],
            "initializerCount": layout["initializerCount"],
            "maxShardSizeBytes": pipeline["maxShardSizeBytes"],
            "normalizedShardPaths": pipeline["normalizedShardPaths"],
            "quantization": pipeline["quantization"],
            "shardCount": pipeline["shardCount"],
            "tensorSetSha256": tensor_digest,
            "topologicallySortGraph": pipeline["topologicallySortGraph"],
        },
        "modelId": model_seed["id"],
        "output": {
            "files": output_files,
            "totalSizeBytes": sum(record["sizeBytes"] for record in output_files),
        },
        "pipelineVersion": PIPELINE_VERSION,
        "schemaVersion": OUTPUT_MANIFEST_SCHEMA_VERSION,
        "source": model_seed["source"],
        "tools": {
            "onnxIrCommit": pipeline["onnxIrCommit"],
            "versions": package_versions(),
        },
    }


def build_model_artifact(
    model_id: str,
    input_dir: Path,
    output_dir: Path,
    seed_path: Path,
) -> Path:
    seed = load_seed(seed_path)
    pipeline = seed["pipeline"]
    model_seed = find_seed_model(seed, model_id)
    source_root, destination_root = prepare_directories(input_dir, output_dir)
    verify_recorded_files(source_root, model_seed["source"]["files"], "source")
    copy_metadata(source_root, destination_root, pipeline["metadataPaths"])

    source_graph = local_path(source_root, pipeline["graphPath"])
    output_graph = local_path(destination_root, pipeline["graphPath"])
    reshard_graph(source_graph, output_graph, pipeline)
    normalize_generated_shards(output_graph, pipeline)
    update_transformers_config(local_path(destination_root, pipeline["configPath"]), pipeline)
    layout = verify_output_layout(destination_root, pipeline)
    tensor_digest = verify_tensor_identity(source_graph, output_graph)
    manifest = build_manifest(model_seed, pipeline, destination_root, layout, tensor_digest)
    manifest_path = destination_root / MANIFEST_FILENAME
    atomic_write_json(manifest_path, manifest)
    (destination_root / INCOMPLETE_MARKER).unlink()
    return manifest_path


def main(argv: list[str] | None = None) -> int:
    arguments = parse_args(argv)
    try:
        manifest_path = build_model_artifact(
            arguments.model_id,
            arguments.input_dir,
            arguments.output_dir,
            arguments.seed,
        )
    except ArtifactError as error:
        print(f"artifact build failed: {error}", file=sys.stderr)
        return 2
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
